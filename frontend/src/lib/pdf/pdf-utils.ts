/**
 * Pure helpers shared by the PDF source viewer. No pdf.js import at module
 * scope — types only — so this file stays cheap to unit-test in jsdom.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** A flattened outline entry the viewer can render and jump with. */
export interface PdfOutlineEntry {
  title: string
  /** Resolved 1-based page number; null when the dest is external/unresolvable. */
  pageNumber: number | null
  /** External http(s) link carried by the outline entry, if any. */
  url: string | null
  depth: number
}

/**
 * PDF files start with the magic bytes `%PDF-`. The download endpoint always
 * serves `application/octet-stream` (api/routers/sources.py), so the
 * Content-Type cannot discriminate — sniff the bytes instead.
 */
export function isPdfBuffer(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
  if (bytes.length < magic.length) return false
  return magic.every((byte, index) => bytes[index] === byte)
}

/** Raw pdf.js outline node (v6 types the nested `items` as elided any). */
interface RawOutlineNode {
  title: string
  dest: string | unknown[] | null
  url: string | null
  items?: RawOutlineNode[]
}

/**
 * Resolve one outline `dest` to a 1-based page number (getPageIndex is
 * 0-based; the viewer speaks in 1-based page numbers).
 *
 * - `string` dest: a named destination — look it up via getDestination first.
 * - `array` dest: an explicit destination — the first element is the page ref.
 * - `null` dest or an external `url`: not jumpable → null.
 * - Any single lookup failure (broken named dest, dangling ref) → null; one
 *   bad entry must not sink the whole outline.
 */
export async function resolveOutlineDest(
  doc: PDFDocumentProxy,
  dest: string | Array<unknown> | null | undefined
): Promise<number | null> {
  if (dest == null) return null
  try {
    if (typeof dest === 'string') {
      const explicit = await doc.getDestination(dest)
      if (!explicit) return null
      return (await doc.getPageIndex(explicit[0])) + 1
    }
    if (Array.isArray(dest) && dest.length > 0) {
      // Explicit dests lead with the page ref (Ref); pdf.js types it loosely.
      return (await doc.getPageIndex(dest[0] as Parameters<typeof doc.getPageIndex>[0])) + 1
    }
    return null
  } catch {
    return null
  }
}

/**
 * Walk the (possibly nested) pdf.js outline tree into flat, depth-annotated
 * entries with resolved page numbers, preserving document order.
 */
export async function flattenOutline(
  doc: PDFDocumentProxy,
  nodes: RawOutlineNode[],
  depth = 0
): Promise<PdfOutlineEntry[]> {
  const entries: PdfOutlineEntry[] = []
  for (const node of nodes) {
    const pageNumber = node.url ? null : await resolveOutlineDest(doc, node.dest)
    entries.push({
      title: node.title,
      pageNumber,
      url: node.url ?? null,
      depth,
    })
    if (node.items?.length) {
      entries.push(...(await flattenOutline(doc, node.items, depth + 1)))
    }
  }
  return entries
}

/**
 * End page (1-based, inclusive) of the outline entry at `index`: the page
 * before the next entry at the same or shallower depth; the document's last
 * page when the entry is the last of its branch. A next entry on the same
 * page clamps to the entry's own start page.
 */
export function sectionEndPage(
  entries: PdfOutlineEntry[],
  index: number,
  numPages: number
): number {
  const entry = entries[index]
  if (!entry || entry.pageNumber == null) return numPages
  for (let i = index + 1; i < entries.length; i += 1) {
    const next = entries[i]
    if (next.depth <= entry.depth && next.pageNumber != null) {
      return Math.max(entry.pageNumber, next.pageNumber - 1)
    }
  }
  return numPages
}

/**
 * Extract the text layer of pages `start..end` (1-based, inclusive).
 * Items ending a line get '\n', others a single space; a page with an empty
 * text layer (scanned PDF) contributes nothing. Returns '' when no text was
 * found at all. Always cleans up the page objects.
 */
export async function extractPagesText(
  doc: PDFDocumentProxy,
  start: number,
  end: number
): Promise<string> {
  const first = Math.max(1, start)
  const last = Math.min(doc.numPages, end)
  if (first > last) return ''

  let text = ''
  for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
    text += await extractSinglePageText(doc, pageNumber)
  }
  return text.trim()
}

/**
 * Text layer of one page (trailing newline included when the last item ends
 * a line — same joining rules as extractPagesText). Always cleans up.
 */
async function extractSinglePageText(
  doc: PDFDocumentProxy,
  pageNumber: number
): Promise<string> {
  const page = await doc.getPage(pageNumber)
  try {
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      text += item.str
      text += item.hasEOL ? '\n' : ' '
    }
    return text
  } finally {
    await page.cleanup()
  }
}

/* ------------------------------------------------------------------ */
/* Printed-TOC fallback (documents without a PDF outline)              */
/* ------------------------------------------------------------------ */

/** How deep into the document to look for a printed table-of-contents page. */
const TOC_SCAN_PAGES = 10
/** Matching TOC lines a page needs before it counts as a TOC page. */
const TOC_MIN_LINES = 5
/** Printed→physical page offset candidates tried during calibration. */
const TOC_OFFSET_CANDIDATES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
/** Entries used to calibrate the offset (smallest printed pages first). */
const TOC_CALIBRATION_ENTRIES = 3

/** Leader chars between a TOC title and its page number. */
const TOC_LEADER = /[\s.\u2026\u00b7\u2022\u2014\u2013-]+/
/** A TOC line: non-trivial title, leader, trailing page number. */
const TOC_LINE = /^(.+?)[\s.\u2026\u00b7\u2022\u2014\u2013-]{1,}(\d{1,4})$/
/** Titles must contain some CJK or at least 3 word chars to filter noise. */
const TOC_TITLE_VALID = /[\u4e00-\u9fff]|([A-Za-z0-9].*){3}/
/** Leading entry numbers ("1.", "2 ") — listed in the TOC, absent from body headings. */
const TOC_ENTRY_NUMBER = /^\d{1,3}\s*[.\u3001\uff0e:\uff1a]?\s*/

interface TocLine {
  title: string
  printedPage: number
  depth: number
}

/** Whitespace-stripped comparison form (also drops TOC leader dots). */
const normalizeText = (text: string): string =>
  text.replace(/[\s.\u2026\u00b7\u2022\u2014\u2013-]/g, '')

/**
 * Parse the printed table of contents found on the first pages of a
 * document — the WPS-style fallback for PDFs that carry no bookmarks.
 *
 * A page qualifies as the TOC when at least TOC_MIN_LINES of its text-layer
 * lines look like "title …… page-number". Printed page numbers are then
 * calibrated against the document: for each candidate offset the smallest
 * TOC entries must actually appear (near a line start) on their target
 * physical pages; the best-scoring offset wins, ties prefer the offset
 * closest to 0. When no offset scores ≥2 matches, entries are returned with
 * `pageNumber: null` (listed, not jumpable). Heuristic by design — a rough
 * jump target beats no TOC at all.
 */
export async function parseTocFromPages(
  doc: PDFDocumentProxy
): Promise<PdfOutlineEntry[]> {
  const scanEnd = Math.min(doc.numPages, TOC_SCAN_PAGES)
  let best: { page: number; lines: TocLine[] } | null = null

  for (let pageNumber = 1; pageNumber <= scanEnd; pageNumber += 1) {
    const lines = parseTocLines(await extractSinglePageText(doc, pageNumber), doc.numPages)
    if (lines.length >= TOC_MIN_LINES && (!best || lines.length > best.lines.length)) {
      best = { page: pageNumber, lines }
    }
  }
  if (!best) return []

  const offset = await calibrateOffset(doc, best.page, best.lines)
  return best.lines.map((line) => {
    const target = offset == null ? null : line.printedPage + offset
    // Out-of-range targets (bad printed number) stay unjumpable rather than
    // clamping somewhere misleading.
    const pageNumber =
      target != null && target >= 1 && target <= doc.numPages ? target : null
    return { title: line.title, pageNumber, url: null, depth: line.depth }
  })
}

/** Extract "title …… page" lines from one page's text layer. */
function parseTocLines(pageText: string, numPages: number): TocLine[] {
  const lines: TocLine[] = []
  for (const rawLine of pageText.split('\n')) {
    const match = rawLine.trimEnd().match(TOC_LINE)
    if (!match) continue
    let title = match[1].replace(TOC_LEADER, ' ').trim()
    const printedPage = Number(match[2])
    // Reject noise: bare numbers, one-char watermarks, out-of-range pages.
    if (printedPage < 1 || printedPage > numPages + 30) continue
    // Strip the entry number ("1.", "2 ") — the body heading it must match
    // during calibration does not carry it.
    title = title.replace(TOC_ENTRY_NUMBER, '').trim()
    if (title.length < 2 || !TOC_TITLE_VALID.test(title)) continue
    // Leading indentation (kept by the text layer) marks a sub-level.
    const indent = rawLine.length - rawLine.trimStart().length
    lines.push({ title, printedPage, depth: indent >= 2 ? 1 : 0 })
  }
  // TOC pages list monotonically increasing pages; drop the rest as noise.
  const increasing = lines.filter(
    (line, i) => i === 0 || line.printedPage >= lines[i - 1].printedPage
  )
  return increasing.length >= TOC_MIN_LINES ? increasing : []
}

/**
 * Find the printed→physical page offset with the most calibrated hits.
 * Returns null when nothing matches confidently (entries stay unjumpable).
 */
async function calibrateOffset(
  doc: PDFDocumentProxy,
  tocPage: number,
  lines: TocLine[]
): Promise<number | null> {
  // Calibrate on the smallest printed pages (cheapest to verify, usually
  // the front matter); the same offset applies to the whole TOC.
  const probes = [...lines]
    .sort((a, b) => a.printedPage - b.printedPage)
    .slice(0, TOC_CALIBRATION_ENTRIES)

  const targets = [
    ...new Set(
      TOC_OFFSET_CANDIDATES.flatMap((offset) =>
        probes
          .map((probe) => probe.printedPage + offset)
          .filter(
            (page) =>
              page >= 1 && page <= doc.numPages && Math.abs(page - tocPage) > 1
          )
      )
    ),
  ]
  if (targets.length === 0) return null

  const textByPage = new Map<number, string>()
  await Promise.all(
    targets.map(async (page) => {
      textByPage.set(page, await extractSinglePageText(doc, page))
    })
  )

  const normalizedByPage = new Map(
    [...textByPage].map(([page, text]) => [
      page,
      text.split('\n').map((line) => normalizeText(line)),
    ])
  )

  // The probe title should appear as a line (or part of a compound heading
  // line) on its target page — running prose rarely quotes a full TOC title.
  const titleOnPage = (probe: TocLine, page: number): boolean => {
    const key = normalizeText(probe.title).slice(0, 10)
    if (!key) return false
    const pageLines = normalizedByPage.get(page)
    if (!pageLines) return false
    return pageLines.some((line) => line.includes(key))
  }

  let bestOffset: number | null = null
  let bestScore = 0
  for (const offset of TOC_OFFSET_CANDIDATES) {
    const score = probes.filter(
      (probe) =>
        probe.printedPage + offset >= 1 &&
        probe.printedPage + offset <= doc.numPages &&
        Math.abs(probe.printedPage + offset - tocPage) > 1 &&
        titleOnPage(probe, probe.printedPage + offset)
    ).length
    // Ties keep the earlier (closer-to-zero) offset.
    if (score > bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }
  return bestScore >= 2 ? bestOffset : null
}

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
    const page = await doc.getPage(pageNumber)
    try {
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        text += item.hasEOL ? '\n' : ' '
      }
    } finally {
      await page.cleanup()
    }
  }
  return text.trim()
}

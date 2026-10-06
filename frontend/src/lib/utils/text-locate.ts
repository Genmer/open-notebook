/**
 * Normalized-text matching shared by the citation-highlighting views.
 *
 * Source text (full_text, PDF text-layer pages) differs from the quote
 * returned by the locate-passage endpoint by whitespace runs, case and
 * occasional line-break artifacts, so matches happen on a normalized form
 * with an index map back to the original text.
 */

export interface NormMap {
  norm: string
  /** index_map[i] = original-text offset that produced norm char i. */
  map: number[]
}

// Fullwidth ASCII (U+FF01..U+FF5E) → halfwidth, plus curly quotes → straight.
// Extraction pipelines and pdf.js's text layer disagree on which form
// CJK-adjacent punctuation takes, so matching folds both to one side.
const PUNCT_FOLD = new Map<number, number>()
for (let i = 0; i < 0x5e; i += 1) PUNCT_FOLD.set(0xff01 + i, 0x21 + i)
PUNCT_FOLD.set(0x2018, 0x27)
PUNCT_FOLD.set(0x2019, 0x27)
PUNCT_FOLD.set(0x201c, 0x22)
PUNCT_FOLD.set(0x201d, 0x22)

function foldChar(ch: string): string {
  const code = ch.charCodeAt(0)
  const folded = PUNCT_FOLD.get(code)
  return folded !== undefined ? String.fromCharCode(folded) : ch
}

export function buildNormMap(text: string): NormMap {
  const normChars: string[] = []
  const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      pendingSpace = normChars.length > 0
      continue
    }
    if (pendingSpace) {
      normChars.push(' ')
      map.push(i)
      pendingSpace = false
    }
    normChars.push(foldChar(ch).toLowerCase())
    map.push(i)
  }
  return { norm: normChars.join(''), map }
}

export interface NormSpan {
  /** Offsets into the ORIGINAL text. */
  start: number
  end: number
}

/**
 * Find `needle` inside `haystack` under normalization; returns the original-
 * text span of the first hit, or null. `startAtNorm` allows scanning past an
 * earlier hit.
 */
export function findNormalized(
  haystack: string,
  needle: string,
  startAtNorm = 0
): NormSpan | null {
  const h = buildNormMap(haystack)
  const n = buildNormMap(needle).norm
  if (!n) return null
  const idx = h.norm.indexOf(n, startAtNorm)
  if (idx < 0) return null
  return {
    start: h.map[idx],
    end: h.map[Math.min(idx + n.length - 1, h.map.length - 1)] + 1,
  }
}

export interface CiteMatch {
  index: number
  length: number
}

/**
 * Find a citation quote inside already-normalized page text. Quotes come from
 * ingestion-time extraction whose line-break artifacts ("故障概率\n。\n来\n…")
 * can differ from the viewer's text-layer joining, so when the full string
 * doesn't match we retry with the quote's longest normalized line (≥ 8 chars)
 * — good enough to land the reader on the right passage.
 */
export function findCiteMatch(haystackNorm: string, quote: string): CiteMatch | null {
  const needle = buildNormMap(quote).norm
  if (!needle || !haystackNorm) return null
  const direct = haystackNorm.indexOf(needle)
  if (direct >= 0) return { index: direct, length: needle.length }
  const lines = quote
    .split(/\n+/)
    .map((line) => buildNormMap(line).norm)
    .filter((line) => line.length >= 8)
    .sort((a, b) => b.length - a.length)
  for (const line of lines) {
    const idx = haystackNorm.indexOf(line)
    if (idx >= 0) return { index: idx, length: line.length }
  }
  return null
}

/**
 * Index of the paragraph (`\n\n`-split) whose normalized text contains the
 * normalized needle — the anchor for scroll-into-view in the plain-text
 * reader. Falls back to a substring probe of the raw quote prefix so a
 * slightly truncated quote still lands on the right paragraph.
 */
export function findParagraphIndex(paragraphs: string[], quote: string): number {
  const needle = buildNormMap(quote).norm
  if (!needle) return -1
  const probe = needle.slice(0, Math.min(60, needle.length))
  for (let i = 0; i < paragraphs.length; i++) {
    const norm = buildNormMap(paragraphs[i]).norm
    if (norm.includes(needle) || (probe.length >= 20 && norm.includes(probe))) {
      return i
    }
  }
  return -1
}

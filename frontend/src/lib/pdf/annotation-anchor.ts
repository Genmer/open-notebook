/**
 * Selection → anchor conversions for PDF annotations. Pure functions only
 * (DOM in, plain data out) so every coordinate trip can be unit-tested.
 *
 * Three coordinate spaces meet here:
 * - PDF user space — the persisted anchor space (y grows upward, origin at
 *   the page's bottom-left; the only space stored in the DB);
 * - CSS viewport — `page.getViewport({ scale })`, y grows downward, size =
 *   the on-screen page; TextLayer spans are absolutely positioned in it;
 * - render viewport — `getViewport({ scale: scale * dpr })`, the canvas
 *   bitmap. It never appears in these functions by design: DOM math must
 *   always go through the dpr-free viewport (the "dual viewport trap").
 */

export const MAX_QUOTE_CHARS = 5000
/** Context captured around the quote for re-anchoring (Hypothes.is-style). */
export const ANCHOR_CONTEXT_CHARS = 32

export interface Quad {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PdfAnchor {
  page: number
  quads: Quad[]
}

export interface TextAnchor {
  quote: string
  prefix: string
  suffix: string
  start_offset: number | null
  end_offset: number | null
}

export interface ViewportLike {
  /** CSS-pixel height of the page (no devicePixelRatio). */
  height: number
  scale: number
}

export interface DomRectLike {
  left: number
  top: number
  width: number
  height: number
}

/** CSS-viewport rect (relative to the page wrapper) → PDF user-space quad. */
export function domRectToQuad(rect: DomRectLike, viewport: ViewportLike): Quad {
  const s = viewport.scale
  const h = viewport.height
  return {
    x1: rect.left / s,
    y1: (h - rect.top - rect.height) / s,
    x2: (rect.left + rect.width) / s,
    y2: (h - rect.top) / s,
  }
}

/** PDF user-space quad → CSS-viewport rect (relative to the page wrapper). */
export function quadToDomRect(quad: Quad, viewport: ViewportLike): DomRectLike {
  const s = viewport.scale
  return {
    left: quad.x1 * s,
    width: (quad.x2 - quad.x1) * s,
    top: viewport.height - quad.y2 * s,
    height: (quad.y2 - quad.y1) * s,
  }
}

/** Round-trip helper for tests and the zoom-stability guarantee. */
export function quadRoundTrip(quad: Quad, viewport: ViewportLike): Quad {
  return domRectToQuad(quadToDomRect(quad, viewport), viewport)
}

/**
 * Selection/Range client rects → user-space quads, one per text line.
 * Rects already relative to `wrapperRect` (caller subtracts the wrapper's
 * client rect). Fragments sharing a line (multi-span selections) merge on
 * the same baseline so each line yields exactly one quad.
 */
export function rectsToQuads(rects: DomRectLike[], viewport: ViewportLike): Quad[] {
  const byLine = new Map<string, DomRectLike>()
  for (const r of rects) {
    if (r.width < 0.5 || r.height < 0.5) continue
    const key = `${Math.round(r.top)}:${Math.round(r.height)}`
    const prev = byLine.get(key)
    if (!prev) {
      byLine.set(key, { ...r })
    } else {
      const left = Math.min(prev.left, r.left)
      const right = Math.max(prev.left + prev.width, r.left + r.width)
      byLine.set(key, { left, width: right - left, top: prev.top, height: prev.height })
    }
  }
  return Array.from(byLine.values())
    .sort((a, b) => a.top - b.top)
    .map((r) => domRectToQuad(r, viewport))
}

/**
 * Concatenated plain text of the text layer with per-span offsets, so a DOM
 * selection inside one span maps to absolute offsets in the page text.
 * `role="img"` spans (pdf.js marks non-text glyphs) carry no text and are
 * skipped.
 */
export interface TextIndex {
  text: string
  spans: Array<{ start: number; end: number; el: Element }>
}

export function buildTextIndex(container: Element): TextIndex {
  let text = ''
  const spans: TextIndex['spans'] = []
  for (const el of Array.from(container.querySelectorAll('span'))) {
    if (el.getAttribute('role') === 'img') continue
    const str = el.textContent ?? ''
    if (!str) continue
    spans.push({ start: text.length, end: text.length + str.length, el })
    text += str
  }
  return { text, spans }
}

function spanLocalOffset(node: Node, offset: number, span: Element): number {
  // Offset inside the span's own text when the selection boundary is a
  // text node within it (TextLayer spans contain a single text node).
  let prefix = ''
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current && current !== node) {
    prefix += current.textContent ?? ''
    current = walker.nextNode()
  }
  if (!current) return 0
  return prefix.length + offset
}

/**
 * DOM selection inside the text layer → text anchor (quote + context).
 * Returns null when the selection does not live in a text-layer span (e.g.
 * UI text) and `{ error: 'too_long' }` past the persisted-quote cap, so the
 * caller can reject the annotation instead of truncating (quote is the
 * re-anchoring evidence and must stay verbatim).
 */
export function textAnchorFromSelection(
  selection: Selection,
  container: Element
): TextAnchor | { error: 'too_long' } | null {
  const index = buildTextIndex(container)
  const resolve = (node: Node, offset: number): number | null => {
    for (const span of index.spans) {
      if (span.el.contains(node)) {
        return span.start + Math.min(spanLocalOffset(node, offset, span.el), span.end - span.start)
      }
    }
    return null
  }
  const a = resolve(selection.anchorNode as Node, selection.anchorOffset)
  const b = resolve(selection.focusNode as Node, selection.focusOffset)
  if (a == null || b == null) return null
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  if (end <= start) return null
  const quote = index.text.slice(start, end)
  if (quote.length > MAX_QUOTE_CHARS) return { error: 'too_long' }
  return {
    quote,
    prefix: index.text.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    suffix: index.text.slice(end, end + ANCHOR_CONTEXT_CHARS),
    start_offset: start,
    end_offset: end,
  }
}

/** Quote snapshot for a PDF anchor: the selected string, capped verbatim. */
export function quoteFromSelectionText(text: string): string | { error: 'too_long' } {
  if (text.length > MAX_QUOTE_CHARS) return { error: 'too_long' }
  return text
}

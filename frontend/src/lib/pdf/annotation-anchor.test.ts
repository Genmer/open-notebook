import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  ANCHOR_CONTEXT_CHARS,
  MAX_QUOTE_CHARS,
  buildTextIndex,
  domRectToQuad,
  quadToDomRect,
  rectsToQuads,
  textAnchorFromSelection,
  type DomRectLike,
  type ViewportLike,
} from './annotation-anchor'

/**
 * F3 acceptance (source-annotation-mvp-tasks.md:42):
 * ① 7 zoom scales (0.6–2.5) round-trip error ≤1px, 0 for integer pixels;
 * ② dpr=2 conversions go through the dpr-free CSS viewport;
 * ③ mock text-layer selection → quads + quote assembly.
 *
 * Page model: US Letter portrait, 612×792 user-space units. The CSS viewport
 * at zoom `s` is { height: 792*s, scale: s } — never the dpr-multiplied
 * render viewport (annotation-anchor.ts:5-12, the "dual viewport trap").
 */
const PAGE_H = 792
const ZOOM_SCALES = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5] as const
const cssViewport = (scale: number): ViewportLike => ({ height: PAGE_H * scale, scale })

/** Minimal Selection-shaped object — the function only reads the 4 boundary
 * fields, so tests inject boundaries directly instead of depending on jsdom's
 * Selection direction support (backward selections are hard to build there). */
function mockSelection(
  anchorNode: Node,
  anchorOffset: number,
  focusNode: Node,
  focusOffset: number
): Selection {
  return { anchorNode, anchorOffset, focusNode, focusOffset } as unknown as Selection
}

describe('domRectToQuad ↔ quadToDomRect round trip (F3 ①)', () => {
  it.each(ZOOM_SCALES)('round-trips integer pixels exactly at scale %s', (scale) => {
    const viewport = cssViewport(scale)
    const rects: DomRectLike[] = [
      { left: 123, top: 45, width: 200, height: 30 },
      { left: 0, top: 0, width: Math.round(612 * scale), height: Math.round(PAGE_H * scale) },
      { left: 61, top: Math.round(PAGE_H * scale) - 11, width: 11, height: 11 },
    ]
    for (const rect of rects) {
      const back = quadToDomRect(domRectToQuad(rect, viewport), viewport)
      // Measured worst float error at these scales is ~1e-13, so precision 10
      // (threshold 5e-11) asserts the error is 0 for practical purposes.
      expect(back.left).toBeCloseTo(rect.left, 10)
      expect(back.top).toBeCloseTo(rect.top, 10)
      expect(back.width).toBeCloseTo(rect.width, 10)
      expect(back.height).toBeCloseTo(rect.height, 10)
    }
  })

  it.each(ZOOM_SCALES)('round-trips subpixel rects within 1px at scale %s', (scale) => {
    const viewport = cssViewport(scale)
    const rects: DomRectLike[] = [
      { left: 37.3, top: 511.87, width: 203.41, height: 14.66 },
      { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
    ]
    for (const rect of rects) {
      const back = quadToDomRect(domRectToQuad(rect, viewport), viewport)
      for (const key of ['left', 'top', 'width', 'height'] as const) {
        expect(Math.abs(back[key] - rect[key])).toBeLessThanOrEqual(1)
      }
    }
  })

  it('round-trips a persisted quad back to itself across all 7 scales', () => {
    const quad = { x1: 40, y1: 130.5, x2: 240, y2: 160.5 } // user space
    for (const scale of ZOOM_SCALES) {
      const back = domRectToQuad(quadToDomRect(quad, cssViewport(scale)), cssViewport(scale))
      for (const key of ['x1', 'y1', 'x2', 'y2'] as const) {
        expect(Math.abs(back[key] - quad[key])).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('y flip between user space and CSS viewport (F3 ②)', () => {
  it('maps quad edges onto viewport.height - top - height', () => {
    const scale = 1.25
    const viewport = cssViewport(scale)
    const rect = { left: 80, top: 300, width: 150, height: 20 }
    const quad = domRectToQuad(rect, viewport)

    // y grows upward in user space: the rect's top edge (distance
    // `viewport.height - top` from the page bottom) becomes the quad's y2.
    expect(quad.y2 * viewport.scale).toBeCloseTo(viewport.height - rect.top, 10)
    expect(quad.y1 * viewport.scale).toBeCloseTo(viewport.height - rect.top - rect.height, 10)
    expect(quad.y2).toBeGreaterThan(quad.y1)
    // …and the inverse mapping restores the exact DOM rect.
    const back = quadToDomRect(quad, viewport)
    expect(back.top).toBeCloseTo(rect.top, 10)
    expect(back.height).toBeCloseTo(rect.height, 10)
    expect(back.left).toBeCloseTo(rect.left, 10)
  })

  it('is independent of devicePixelRatio: dpr=2 still converts through the CSS viewport', () => {
    const viewport = cssViewport(1.5)
    const rect = { left: 100, top: 300, width: 200, height: 20 }
    const atDpr1 = domRectToQuad(rect, viewport)

    const originalDpr = window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
    try {
      // The functions never read dpr — same CSS viewport in, same quad out.
      const atDpr2 = domRectToQuad(rect, viewport)
      expect(atDpr2).toEqual(atDpr1)

      const roundTripped = quadToDomRect(atDpr2, viewport)
      expect(roundTripped.top).toBeCloseTo(rect.top, 10)
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', {
        value: originalDpr,
        configurable: true,
      })
    }

    // Illustration of the trap the design guards against: the dpr=2 render
    // viewport ({height: 1584, scale: 3}) is the canvas bitmap space. Using it
    // for DOM math would yield different quads — which is exactly why the
    // contract mandates the dpr-free viewport.
    const renderViewport = { height: viewport.height * 2, scale: viewport.scale * 2 }
    expect(domRectToQuad(rect, renderViewport)).not.toEqual(atDpr1)
  })
})

describe('rectsToQuads (F3 ③)', () => {
  const viewport: ViewportLike = { height: 400, scale: 2 }

  it('merges same-line fragments into one quad (min left, max right)', () => {
    const line1a = { left: 10, top: 50, width: 30, height: 20 }
    const line1b = { left: 60, top: 50, width: 25, height: 20 }
    const quads = rectsToQuads([line1a, line1b], viewport)

    expect(quads).toHaveLength(1)
    // Merged span: left=10, right=max(40, 85)=85 → width 75.
    expect(quads[0]).toEqual({ x1: 5, y1: 165, x2: 42.5, y2: 175 })
  })

  it('emits one quad per line, ordered by DOM top (topmost first)', () => {
    const line2 = { left: 20, top: 80, width: 50, height: 20 }
    const line1a = { left: 10, top: 50, width: 30, height: 20 }
    const line1b = { left: 60, top: 50, width: 25, height: 20 }
    // Feed line 2 first: sorting must not follow input order.
    const quads = rectsToQuads([line2, line1b, line1a], viewport)

    expect(quads).toHaveLength(2)
    const tops = quads.map((q) => quadToDomRect(q, viewport).top)
    expect(tops).toEqual([50, 80]) // ascending DOM top
    // Topmost DOM line = largest user-space y.
    expect(quads[0].y2).toBeGreaterThan(quads[1].y2)
    expect(quads[1]).toEqual({ x1: 10, y1: 150, x2: 35, y2: 160 })
  })

  it('drops fragments with width or height below 0.5, keeps exactly 0.5', () => {
    const real = { left: 10, top: 50, width: 30, height: 20 }
    const sliver = { left: 0, top: 50, width: 0.49, height: 20 } // too narrow
    const flat = { left: 0, top: 120, width: 50, height: 0.3 } // too flat
    expect(rectsToQuads([sliver, flat, real], viewport)).toEqual([
      { x1: 5, y1: 165, x2: 20, y2: 175 },
    ])

    // Boundary: 0.5 is the first surviving size ("< 0.5" is the drop test).
    const half = { left: 40, top: 50, width: 0.5, height: 0.5 }
    expect(rectsToQuads([half], viewport)).toHaveLength(1)
  })

  it('returns an empty array for empty input', () => {
    expect(rectsToQuads([], viewport)).toEqual([])
  })
})

describe('buildTextIndex', () => {
  it('concatenates span text with absolute offsets, skipping role="img" and empty spans', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<span>Hello </span><span role="img">✓</span><span>World</span><span></span>'
    document.body.appendChild(container)

    const index = buildTextIndex(container)
    expect(index.text).toBe('Hello World')
    expect(index.spans.map((s) => [s.start, s.end])).toEqual([
      [0, 6],
      [6, 11],
    ])

    container.remove()
  })
})

describe('textAnchorFromSelection (F3 ③)', () => {
  let container: HTMLDivElement
  let helloText: Text
  let worldText: Text

  beforeEach(() => {
    container = document.createElement('div')
    container.innerHTML = '<span>Hello </span><span role="img">✓</span><span>World</span>'
    document.body.appendChild(container)
    helloText = container.querySelectorAll('span')[0].firstChild as Text
    worldText = container.querySelectorAll('span')[2].firstChild as Text
  })

  afterEach(() => {
    container.remove()
  })

  it('builds a forward selection inside one span', () => {
    const anchor = mockSelection(helloText, 0, helloText, 5)
    expect(textAnchorFromSelection(anchor, container)).toEqual({
      quote: 'Hello',
      prefix: '',
      suffix: ' World',
      start_offset: 0,
      end_offset: 5,
    })
  })

  it('takes min/max for a backward selection (focus before anchor)', () => {
    const backward = mockSelection(worldText, 5, helloText, 2)
    expect(textAnchorFromSelection(backward, container)).toEqual({
      quote: 'llo World', // index.text.slice(2, 11)
      prefix: 'He',
      suffix: '',
      start_offset: 2,
      end_offset: 11,
    })
  })

  it('spans selections across spans, skipping role="img" text', () => {
    const across = mockSelection(helloText, 0, worldText, 5)
    // The img span's "✓" is not in the index, so the quote jumps over it.
    expect(textAnchorFromSelection(across, container)).toEqual({
      quote: 'Hello World',
      prefix: '',
      suffix: '',
      start_offset: 0,
      end_offset: 11,
    })
  })

  it('returns null when the selection lives outside the container', () => {
    const outside = document.createElement('span')
    outside.textContent = 'UI label'
    document.body.appendChild(outside)
    try {
      const sel = mockSelection(outside.firstChild as Text, 0, outside.firstChild as Text, 4)
      expect(textAnchorFromSelection(sel, container)).toBeNull()
    } finally {
      outside.remove()
    }
  })

  it('returns null for a collapsed selection', () => {
    const collapsed = mockSelection(helloText, 3, helloText, 3)
    expect(textAnchorFromSelection(collapsed, container)).toBeNull()
  })

  it('clamps a boundary offset past the end of the span text', () => {
    const clamped = mockSelection(helloText, 999, worldText, 5)
    expect(textAnchorFromSelection(clamped, container)).toEqual({
      quote: 'World', // 6..11 — offset 999 clamped to span end 6
      prefix: 'Hello ',
      suffix: '',
      start_offset: 6,
      end_offset: 11,
    })
  })

  it('captures at most ANCHOR_CONTEXT_CHARS chars of prefix/suffix', () => {
    const long = document.createElement('span')
    long.textContent = 'A'.repeat(40) + 'MARK' + 'B'.repeat(40)
    container.appendChild(long)
    // Selection offsets are local to the text node; the returned anchor
    // offsets are absolute in the concatenated index text ("Hello World").
    const localMarkStart = 40
    const absoluteMarkStart = 'Hello World'.length + localMarkStart
    const sel = mockSelection(
      long.firstChild as Text,
      localMarkStart,
      long.firstChild as Text,
      localMarkStart + 4
    )
    expect(textAnchorFromSelection(sel, container)).toEqual({
      quote: 'MARK',
      prefix: 'A'.repeat(ANCHOR_CONTEXT_CHARS),
      suffix: 'B'.repeat(ANCHOR_CONTEXT_CHARS),
      start_offset: absoluteMarkStart,
      end_offset: absoluteMarkStart + 4,
    })
  })

  it('rejects quotes over MAX_QUOTE_CHARS and accepts exactly the cap', () => {
    const long = document.createElement('span')
    long.textContent = 'x'.repeat(MAX_QUOTE_CHARS + 1)
    container.appendChild(long)

    const over = mockSelection(long.firstChild as Text, 0, long.firstChild as Text, MAX_QUOTE_CHARS + 1)
    expect(textAnchorFromSelection(over, container)).toEqual({ error: 'too_long' })

    const atCap = document.createElement('span')
    atCap.textContent = 'y'.repeat(MAX_QUOTE_CHARS)
    container.appendChild(atCap)
    const exact = mockSelection(
      atCap.firstChild as Text,
      0,
      atCap.firstChild as Text,
      MAX_QUOTE_CHARS
    )
    const anchor = textAnchorFromSelection(exact, container)
    expect(anchor).not.toBeNull()
    expect(anchor && 'error' in anchor ? anchor.error : undefined).toBeUndefined()
    expect(anchor && 'quote' in anchor ? anchor.quote.length : 0).toBe(MAX_QUOTE_CHARS)
  })
})

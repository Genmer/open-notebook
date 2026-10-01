import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  extractPagesText,
  flattenOutline,
  isPdfBuffer,
  resolveOutlineDest,
  sectionEndPage,
  type PdfOutlineEntry,
} from './pdf-utils'

// Hoisted mock: the loader test asserts workerSrc wiring without loading the
// real pdf.js; other tests here import types only, so the mock is inert.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}))

// %PDF- magic bytes
const pdfBytes = (rest: number[] = []): Uint8Array => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...rest])

describe('isPdfBuffer', () => {
  it('accepts a buffer starting with %PDF-', () => {
    expect(isPdfBuffer(pdfBytes([0x31, 0x2e, 0x37]))).toBe(true)
  })

  it('rejects other magic numbers', () => {
    expect(isPdfBuffer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x2d]))).toBe(false)
  })

  it('rejects buffers shorter than the magic', () => {
    expect(isPdfBuffer(new Uint8Array([0x25, 0x50]))).toBe(false)
  })
})

describe('resolveOutlineDest', () => {
  const makeDoc = () => ({
    getDestination: vi.fn(),
    getPageIndex: vi.fn(),
  })

  it('resolves a named destination through getDestination (+1: 0-based index → 1-based page)', async () => {
    const doc = makeDoc()
    doc.getDestination.mockResolvedValue(['pageRefA', { name: 'Fit' }])
    doc.getPageIndex.mockResolvedValue(4)

    await expect(resolveOutlineDest(doc as never, 'chap-2')).resolves.toBe(5)
    expect(doc.getDestination).toHaveBeenCalledWith('chap-2')
    expect(doc.getPageIndex).toHaveBeenCalledWith('pageRefA')
  })

  it('resolves an explicit array destination directly', async () => {
    const doc = makeDoc()
    doc.getPageIndex.mockResolvedValue(7)

    await expect(resolveOutlineDest(doc as never, ['pageRefB', { name: 'XYZ' }])).resolves.toBe(8)
    expect(doc.getDestination).not.toHaveBeenCalled()
  })

  it('returns null for a null dest', async () => {
    const doc = makeDoc()
    await expect(resolveOutlineDest(doc as never, null)).resolves.toBeNull()
    await expect(resolveOutlineDest(doc as never, undefined)).resolves.toBeNull()
  })

  it('returns null when the named destination lookup misses', async () => {
    const doc = makeDoc()
    doc.getDestination.mockResolvedValue(null)
    await expect(resolveOutlineDest(doc as never, 'broken-name')).resolves.toBeNull()
  })

  it('returns null when a single lookup throws (one bad entry sinks nothing)', async () => {
    const doc = makeDoc()
    doc.getDestination.mockRejectedValue(new Error('dangling ref'))
    await expect(resolveOutlineDest(doc as never, 'boom')).resolves.toBeNull()
  })
})

describe('flattenOutline', () => {
  it('flattens the nested tree in document order with depth annotations', async () => {
    const doc = {
      getDestination: vi.fn().mockResolvedValue(null),
      getPageIndex: vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(5),
    }

    const entries = await flattenOutline(
      doc as never,
      [
        {
          title: 'Intro',
          dest: ['ref0'],
          url: null,
          items: [
            { title: 'Intro / Setup', dest: ['ref3'], url: null, items: [] },
          ],
        },
        { title: 'Advanced', dest: ['ref5'], url: null, items: [] },
        { title: 'External link', dest: null, url: 'https://example.com', items: [] },
      ] as never
    )

    expect(entries).toEqual([
      { title: 'Intro', pageNumber: 1, url: null, depth: 0 },
      { title: 'Intro / Setup', pageNumber: 4, url: null, depth: 1 },
      { title: 'Advanced', pageNumber: 6, url: null, depth: 0 },
      { title: 'External link', pageNumber: null, url: 'https://example.com', depth: 0 },
    ])
  })
})

describe('sectionEndPage', () => {
  const entry = (pageNumber: number | null, depth: number): PdfOutlineEntry => ({
    title: `p${pageNumber}d${depth}`,
    pageNumber,
    url: null,
    depth,
  })

  it('ends where the next same-or-shallower entry starts (minus one)', () => {
    const entries = [entry(1, 0), entry(4, 1), entry(7, 0), entry(9, 0)]
    // Section at index 1 (depth 1) runs to the page before the depth-0 sibling at page 7
    expect(sectionEndPage(entries, 1, 100)).toBe(6)
    // Section at index 0 (depth 0) is bounded by the next depth-0 at page 7 too
    expect(sectionEndPage(entries, 0, 100)).toBe(6)
  })

  it('runs to the last page for the final entry of its branch', () => {
    const entries = [entry(1, 0), entry(5, 0)]
    expect(sectionEndPage(entries, 1, 42)).toBe(42)
  })

  it('clamps to the start page when the next entry shares that page', () => {
    const entries = [entry(3, 0), entry(3, 0)]
    expect(sectionEndPage(entries, 0, 10)).toBe(3)
  })

  it('falls back to numPages for a non-jumpable entry', () => {
    const entries = [entry(null, 0)]
    expect(sectionEndPage(entries, 0, 20)).toBe(20)
  })
})

describe('extractPagesText', () => {
  const makePage = (items: Array<Record<string, unknown>>) => ({
    getTextContent: vi.fn().mockResolvedValue({ items }),
    cleanup: vi.fn().mockResolvedValue(undefined),
  })

  const makeDoc = (pages: Array<Record<string, unknown>>[]) => {
    const pageMocks = pages.map(makePage)
    return {
      numPages: pages.length,
      getPage: vi.fn((n: number) => Promise.resolve(pageMocks[n - 1])),
      pageMocks,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('joins items with newlines at hasEOL and spaces otherwise', async () => {
    const doc = makeDoc([
      [
        { str: 'Hello', hasEOL: false },
        { str: 'world', hasEOL: true },
        { str: 'Second line', hasEOL: true },
      ],
    ])
    await expect(extractPagesText(doc as never, 1, 1)).resolves.toBe('Hello world\nSecond line')
  })

  it('skips non-text (marked content) items', async () => {
    const doc = makeDoc([[{ type: 'beginMarkedContent' }, { str: 'Text', hasEOL: true }]])
    await expect(extractPagesText(doc as never, 1, 1)).resolves.toBe('Text')
  })

  it('returns an empty string for an empty text layer (scanned page)', async () => {
    const doc = makeDoc([[]])
    await expect(extractPagesText(doc as never, 1, 1)).resolves.toBe('')
  })

  it('concatenates a page range and cleans up every visited page', async () => {
    const doc = makeDoc([
      [{ str: 'Page one.', hasEOL: true }],
      [{ str: 'Page two.', hasEOL: true }],
      [{ str: 'Page three.', hasEOL: true }],
    ])
    await expect(extractPagesText(doc as never, 1, 2)).resolves.toBe('Page one.\nPage two.')
    expect(doc.getPage).toHaveBeenCalledTimes(2)
    expect(doc.pageMocks[0].cleanup).toHaveBeenCalledTimes(1)
    expect(doc.pageMocks[1].cleanup).toHaveBeenCalledTimes(1)
    expect(doc.pageMocks[2].cleanup).not.toHaveBeenCalled()
  })

  it('returns an empty string when the range is empty', async () => {
    const doc = makeDoc([[{ str: 'x', hasEOL: true }]])
    await expect(extractPagesText(doc as never, 5, 2)).resolves.toBe('')
  })
})

describe('getPdfjs worker configuration', () => {
  it('points workerSrc at the static public copy (no CDN, no webpack URL rewriting)', async () => {
    vi.resetModules()
    const { getPdfjs: freshGetPdfjs } = await import('./pdf-loader')
    const pdfjs = await freshGetPdfjs()
    expect((pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc).toBe('/pdf.worker.min.mjs')
  })
})

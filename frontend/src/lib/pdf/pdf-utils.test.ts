import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  extractPagesText,
  flattenOutline,
  isPdfBuffer,
  parseTocFromPages,
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

describe('parseTocFromPages (printed-TOC fallback)', () => {
  /**
   * Doc whose listed pages return the given text (one text item per line);
   * pages beyond the list answer with an empty text layer. numPages may
   * exceed the list so high printed page numbers pass range checks.
   */
  const makeTextDoc = (pages: string[], numPages = pages.length) => {
    const emptyPage = {
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }
    const pageMocks = pages.map((text) => ({
      getTextContent: vi.fn().mockResolvedValue({
        items: text
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => ({ str: line, hasEOL: true })),
      }),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }))
    return {
      numPages,
      getPage: vi.fn((n: number) =>
        Promise.resolve(pageMocks[n - 1] ?? emptyPage)
      ),
      pageMocks,
    }
  }

  it('parses a dot-leader TOC and calibrates a zero offset', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => `filler page ${i + 1}`)
    pages[0] = 'Introduction 3\nChapter One 5\nChapter Two 12\nChapter Three 20\nAppendix 30'
    pages[2] = 'Introduction\nWelcome.'
    pages[4] = 'Chapter One\nThe beginning.'
    pages[11] = 'Chapter Two\nMore.'
    const doc = makeTextDoc(pages)
    const entries = await parseTocFromPages(doc as never)
    expect(entries).toEqual([
      { title: 'Introduction', pageNumber: 3, url: null, depth: 0 },
      { title: 'Chapter One', pageNumber: 5, url: null, depth: 0 },
      { title: 'Chapter Two', pageNumber: 12, url: null, depth: 0 },
      { title: 'Chapter Three', pageNumber: 20, url: null, depth: 0 },
      { title: 'Appendix', pageNumber: 30, url: null, depth: 0 },
    ])
  })

  it('calibrates a printed→physical offset when front matter shifts pages', async () => {
    const pages = Array.from({ length: 21 }, (_, i) => `filler ${i + 1}`)
    pages[0] = '封面'
    pages[1] = '第一章 2\n第二章 10\n第三章 20\n第四章 30\n第五章 40'
    pages[2] = '第一章 开始'
    pages[10] = '第二章 继续'
    pages[20] = '第三章 深入'
    const doc = makeTextDoc(pages, 45)
    const entries = await parseTocFromPages(doc as never)
    // printed 2/10/20 live on physical 3/11/21 → offset +1 applies to all.
    expect(entries).toEqual([
      { title: '第一章', pageNumber: 3, url: null, depth: 0 },
      { title: '第二章', pageNumber: 11, url: null, depth: 0 },
      { title: '第三章', pageNumber: 21, url: null, depth: 0 },
      { title: '第四章', pageNumber: 31, url: null, depth: 0 },
      { title: '第五章', pageNumber: 41, url: null, depth: 0 },
    ])
  })

  it('returns non-jumpable entries when calibration finds no matching body pages', async () => {
    const pages = [
      '操作系统 2\n专业英语 6\n系统架构设计 9\n数据库系统 24\n计算机组成原理 27',
      ...Array.from({ length: 9 }, (_, i) => `unrelated prose ${i}`),
    ]
    const doc = makeTextDoc(pages)
    const entries = await parseTocFromPages(doc as never)
    expect(entries.map((entry) => entry.title)).toEqual([
      '操作系统',
      '专业英语',
      '系统架构设计',
      '数据库系统',
      '计算机组成原理',
    ])
    expect(entries.every((entry) => entry.pageNumber === null)).toBe(true)
  })

  it('ignores watermark noise lines mixed into the TOC page', async () => {
    const pages = [
      '究 必\n盗 版\n操作系统 2\n专业英语 61\n系统架构设计 96\n数据库系统 242\n计算机组成原理 277\n计算机网络 293',
      ...Array.from({ length: 9 }, (_, i) => `noise ${i}`),
    ]
    const doc = makeTextDoc(pages, 300)
    const entries = await parseTocFromPages(doc as never)
    expect(entries.map((entry) => entry.title)).toEqual([
      '操作系统',
      '专业英语',
      '系统架构设计',
      '数据库系统',
      '计算机组成原理',
      '计算机网络',
    ])
  })

  it('marks indented TOC lines as sub-level entries', async () => {
    const pages = ['Part One 3\n  Detail A 4\n  Detail B 5\nPart Two 10\n  Detail C 11']
    const doc = makeTextDoc(pages)
    const entries = await parseTocFromPages(doc as never)
    expect(entries.map((entry) => entry.depth)).toEqual([0, 1, 1, 0, 1])
  })

  it('strips entry numbers and calibrates against compound heading lines (real-book shape)', async () => {
    // Page text layers as pdf.js really yields them for a numbered TOC whose
    // body headings run "book title 第N章——chapter" on one line, printed
    // pages shifted by +1 from physical pages.
    const pages = Array.from({ length: 12 }, () => '版权来源芝士架构 盗版必究')
    pages[0] =
      ' 目录\n 1. 系统架构设计师-按照知识点导出历年真题（选择题）   2\n 2. 操作系统   2\n 3. 专业英语   5\n 4. 系统架构设计   8\n 5. 数据库系统   10\n 第 1 页'
    pages[2] =
      '版权来源芝士架构 盗版必究\n系统架构设计师-按照知识点导出历年真题（选择题） 第1章——操作系统\n 第1章第1小节——磁盘管理'
    pages[5] = '版权来源芝士架构 盗版必究\n第2章——专业英语\n（2025年11月真题）'
    pages[8] = '版权来源芝士架构 盗版必究\n第3章——系统架构设计\n架构风格'
    const doc = makeTextDoc(pages)
    const entries = await parseTocFromPages(doc as never)
    expect(entries).toEqual([
      { title: '系统架构设计师-按照知识点导出历年真题（选择题）', pageNumber: 3, url: null, depth: 0 },
      { title: '操作系统', pageNumber: 3, url: null, depth: 0 },
      { title: '专业英语', pageNumber: 6, url: null, depth: 0 },
      { title: '系统架构设计', pageNumber: 9, url: null, depth: 0 },
      { title: '数据库系统', pageNumber: 11, url: null, depth: 0 },
    ])
  })

  it('returns an empty list when no page looks like a TOC', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => `just prose line ${i} here`)
    const doc = makeTextDoc(pages)
    await expect(parseTocFromPages(doc as never)).resolves.toEqual([])
  })
})

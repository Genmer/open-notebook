import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useAnnotations } from './use-annotations'
import type { SourceAnnotation } from '@/lib/api/source-annotations'

// The hook's only data door is the API module — mock it wholesale (same
// pattern as AnnotationHoverCard.test.tsx). react-query itself runs real.

const mocks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@/lib/api/source-annotations', () => ({
  sourceAnnotationsApi: {
    list: mocks.list,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

function anno(id: string, page: number, startOffset: number | null = null): SourceAnnotation {
  return {
    id: `source_annotation:${id}`,
    source: 'source:s1',
    color: 'gold',
    line_style: 'wavy',
    body: null,
    display_position: null,
    quote: null,
    text_anchor: null,
    pdf_anchor: { page, quads: [{ x1: 1, y1: 2, x2: 30, y2: 4 }] },
    page,
    start_offset: startOffset,
    created: '2026-10-01T00:00:00Z',
    updated: '2026-10-01T00:00:00Z',
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function requestedPages(): number[] {
  return mocks.list.mock.calls.map((call) => call[1] as number)
}

describe('useAnnotations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: empty pages; tests override per page as needed.
    mocks.list.mockImplementation(() => Promise.resolve([]))
  })

  it('fetches only current ± buffer pages, and only the newly entered page when turning', async () => {
    mocks.list.mockImplementation((_sourceId: string, page: number) =>
      Promise.resolve(page === 5 ? [anno('a', 5, 10), anno('b', 5, 2)] : [])
    )

    const { result, rerender } = renderHook(
      (props: { sourceId: string; currentPage: number; totalPages: number }) =>
        useAnnotations(props),
      {
        initialProps: { sourceId: 'source:s1', currentPage: 5, totalPages: 10 },
        wrapper: createWrapper(),
      }
    )

    await waitFor(() => expect(result.current.annotationsByPage[5]).toHaveLength(2))
    expect(new Set(requestedPages())).toEqual(new Set([4, 5, 6]))

    // Turn one page: 5 and 6 are still fresh in cache → only page 7 is asked.
    rerender({ sourceId: 'source:s1', currentPage: 6, totalPages: 10 })
    await waitFor(() => expect(result.current.annotationsByPage[7]).toBeDefined())

    const pages = requestedPages()
    expect(new Set(pages)).toEqual(new Set([4, 5, 6, 7]))
    expect(pages).toHaveLength(4) // no page was requested twice
    expect(result.current.currentPageAnnotations.map((a) => a.id)).toEqual([]) // page 6 empty
  })

  it('returns a sorted current-page list with a stable identity until the data changes', async () => {
    mocks.list.mockImplementation((_sourceId: string, page: number) =>
      Promise.resolve(page === 5 ? [anno('a', 5, 10), anno('b', 5, 2), anno('c', 5, 7)] : [])
    )

    const { result, rerender } = renderHook(
      (props: { sourceId: string; currentPage: number; totalPages: number }) =>
        useAnnotations(props),
      {
        initialProps: { sourceId: 'source:s1', currentPage: 5, totalPages: 10 },
        wrapper: createWrapper(),
      }
    )

    await waitFor(() => expect(result.current.currentPageAnnotations).toHaveLength(3))

    // Derived order (start_offset ascending), not the wire order.
    expect(result.current.currentPageAnnotations.map((a) => a.id)).toEqual([
      'source_annotation:b',
      'source_annotation:c',
      'source_annotation:a',
    ])

    // An unrelated re-render (same props) must NOT recompute the index:
    // sortPageAnnotations always allocates a fresh array, so a broken memo
    // would surface as a new reference here.
    const first = result.current.currentPageAnnotations
    rerender({ sourceId: 'source:s1', currentPage: 5, totalPages: 10 })
    expect(Object.is(first, result.current.currentPageAnnotations)).toBe(true)
  })

  it('exposes over-range rows as orphaned when currentPage exceeds totalPages', async () => {
    // File replaced with a shorter one: the viewer sits on page 5 of a doc
    // that now has 3 pages; the server still returns the old page-5 row.
    mocks.list.mockImplementation((_sourceId: string, page: number) =>
      Promise.resolve(page === 5 ? [anno('over', 5, 1)] : [])
    )

    const { result } = renderHook(
      (props: { sourceId: string; currentPage: number; totalPages: number }) =>
        useAnnotations(props),
      {
        initialProps: { sourceId: 'source:s1', currentPage: 5, totalPages: 3 },
        wrapper: createWrapper(),
      }
    )

    await waitFor(() => expect(result.current.orphanedAnnotations).toHaveLength(1))
    expect(result.current.orphanedAnnotations[0].id).toBe('source_annotation:over')
    expect(result.current.loadedPages.sort()).toEqual([4, 5])
    // The row is still served for rendering (greyed-out by the consumer),
    // just flagged — data is never silently dropped (plan §3.4-C).
    expect(result.current.annotationsByPage[5]).toHaveLength(1)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the options every useQuery call receives so the refetchInterval
// policy can be asserted without a real query client.
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => {
    useQueryMock(options)
    return { data: undefined, isLoading: false }
  },
  useMutation: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    status: vi.fn(),
    list: vi.fn(),
    retry: vi.fn(),
    upload: vi.fn(),
  },
}))

vi.mock('@/lib/api/query-client', () => ({
  QUERY_KEYS: {
    sources: () => ['sources'],
    sourcesInfinite: () => ['sources', 'infinite'],
    source: (id: string) => ['sources', id],
  },
}))

import { useSourceStatus } from './use-sources'

describe('useSourceStatus refetch policy', () => {
  beforeEach(() => {
    useQueryMock.mockClear()
  })

  function useLastStatusOptions(): {
    refetchInterval: (query: { state: { data: unknown } }) => number | false
  } {
    useSourceStatus('source:1')
    return useQueryMock.mock.calls[useQueryMock.mock.calls.length - 1][0]
  }

  it('keeps polling while the source command is processing', () => {
    const options = useLastStatusOptions()
    expect(options.refetchInterval({ state: { data: { status: 'running' } } })).toBe(2000)
    expect(options.refetchInterval({ state: { data: { status: 'queued' } } })).toBe(2000)
    expect(options.refetchInterval({ state: { data: { status: 'new' } } })).toBe(2000)
  })

  it('keeps polling while embedding is queued or running', () => {
    const options = useLastStatusOptions()
    expect(
      options.refetchInterval({ state: { data: { embedding: { status: 'queued' } } } })
    ).toBe(2000)
    expect(
      options.refetchInterval({ state: { data: { embedding: { status: 'running' } } } })
    ).toBe(2000)
  })

  it('keeps polling while an insight-generation job is in flight', () => {
    const options = useLastStatusOptions()
    const data = {
      status: 'completed',
      embedding: { status: 'completed' },
      insight_jobs: [{ command_id: 'command:1', status: 'running' }],
    }
    expect(options.refetchInterval({ state: { data } })).toBe(2000)
    const queued = {
      status: 'completed',
      insight_jobs: [{ command_id: 'command:1', status: 'queued' }],
    }
    expect(options.refetchInterval({ state: { data: queued } })).toBe(2000)
  })

  it('stops polling once insight jobs and everything else are terminal', () => {
    const options = useLastStatusOptions()
    expect(
      options.refetchInterval({ state: { data: { status: 'completed', embedding: { status: 'completed' } } } })
    ).toBe(false)
    expect(
      options.refetchInterval({
        state: {
          data: {
            status: 'completed',
            embedding: { status: 'completed' },
            insight_jobs: [{ command_id: 'command:1', status: 'completed' }],
          },
        },
      })
    ).toBe(false)
    expect(
      options.refetchInterval({
        state: {
          data: {
            status: 'failed',
            embedding: { status: 'failed' },
            insight_jobs: [{ command_id: 'command:1', status: 'failed' }],
          },
        },
      })
    ).toBe(false)
    expect(options.refetchInterval({ state: { data: undefined } })).toBe(false)
  })
})

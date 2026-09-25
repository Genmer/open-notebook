import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the options every useQuery call receives so enabled/queryKey can be
// asserted without a real query client.
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => {
    useQueryMock(options)
    return { data: undefined, isLoading: false }
  },
  useMutation: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    titles: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    status: vi.fn(),
  },
}))

vi.mock('@/lib/api/query-client', () => ({
  QUERY_KEYS: {
    sources: () => ['sources'],
    sourcesInfinite: () => ['sources', 'infinite'],
    source: (id: string) => ['sources', id],
  },
}))

vi.mock('@/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en-US' }),
}))

import { useSourceTitles } from './use-sources'
import { sourcesApi } from '@/lib/api/sources'

function lastOptions(): {
  queryKey: string[]
  enabled: boolean
  queryFn: () => Promise<unknown>
} {
  return useQueryMock.mock.calls[useQueryMock.mock.calls.length - 1][0]
}

describe('useSourceTitles query policy', () => {
  beforeEach(() => {
    useQueryMock.mockClear()
    vi.mocked(sourcesApi.titles).mockClear()
  })

  it('deduplicates and sorts ids before fetching', async () => {
    useSourceTitles(['b', 'a', 'b', 'source:c'])

    const options = lastOptions()
    expect(options.enabled).toBe(true)
    expect(options.queryKey[options.queryKey.length - 1]).toEqual(['a', 'b', 'source:c'])

    vi.mocked(sourcesApi.titles).mockResolvedValue([])
    await options.queryFn()
    expect(sourcesApi.titles).toHaveBeenCalledWith(['a', 'b', 'source:c'])
  })

  it('is disabled for an empty id list so no request goes out', () => {
    useSourceTitles([])

    // React Query never invokes queryFn while enabled is false.
    expect(lastOptions().enabled).toBe(false)
  })
})

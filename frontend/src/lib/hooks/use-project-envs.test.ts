import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the options every useQuery call receives so the refetchInterval
// policies can be asserted without a real query client.
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => {
    useQueryMock(options)
    return { data: undefined, isLoading: false }
  },
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('@/lib/api/project-envs', () => ({
  projectEnvsApi: {
    list: vi.fn(),
    get: vi.fn(),
    getVerification: vi.fn(),
    getMaterials: vi.fn(),
  },
}))

vi.mock('@/lib/api/query-client', () => ({
  QUERY_KEYS: {
    projectEnvs: (view: string) => ['project-envs', view],
    projectEnv: (id: string) => ['project-envs', 'detail', id],
    projectEnvVerification: (id: string) => ['project-envs', 'detail', id, 'verification'],
    projectEnvMaterials: (id: string) => ['project-envs', 'detail', id, 'materials'],
  },
}))

import { useProjectEnvs, useProjectEnvMaterials } from './use-project-envs'

type RefetchFn = (query: { state: { data: unknown } }) => number | false

function lastQueryOptions() {
  return useQueryMock.mock.calls[useQueryMock.mock.calls.length - 1][0] as {
    refetchInterval: RefetchFn
  }
}

describe('useProjectEnvs refetch policy', () => {
  beforeEach(() => {
    useQueryMock.mockClear()
  })

  it('polls the list while any env is pending or material_pending', () => {
    useProjectEnvs()
    const { refetchInterval } = lastQueryOptions()

    expect(
      refetchInterval({ state: { data: [{ status: 'pending' }] } })
    ).toBe(5000)
    expect(
      refetchInterval({
        state: {
          data: [
            { status: 'verified' },
            { status: 'material_pending' },
          ],
        },
      })
    ).toBe(5000)
  })

  it('stops polling once every env is in a terminal-for-list state', () => {
    useProjectEnvs()
    const { refetchInterval } = lastQueryOptions()

    expect(
      refetchInterval({
        state: {
          data: [
            { status: 'verified' },
            { status: 'needs_review' },
            { status: 'material_ready' },
            { status: 'failed' },
          ],
        },
      })
    ).toBe(false)
  })
})

describe('useProjectEnvMaterials refetch policy', () => {
  beforeEach(() => {
    useQueryMock.mockClear()
  })

  it('polls at 3s only while the materials job is running', () => {
    useProjectEnvMaterials('project_env:e1')
    const { refetchInterval } = lastQueryOptions()

    expect(
      refetchInterval({ state: { data: { status: 'material_pending' } } })
    ).toBe(3000)
    expect(
      refetchInterval({ state: { data: { status: 'material_ready' } } })
    ).toBe(false)
    expect(
      refetchInterval({ state: { data: { status: 'failed' } } })
    ).toBe(false)
  })
})

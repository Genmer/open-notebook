import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the options useInfiniteQuery receives so the pagination cursor
// policy can be asserted without a real query client.
const useInfiniteQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: (options: unknown) => {
    useInfiniteQueryMock(options)
    return { data: undefined, isLoading: false }
  },
}))

vi.mock('@/lib/api/tasks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api/tasks')>()
  return { ...actual, tasksApi: { list: vi.fn() } }
})

// query-client constructs a real QueryClient at import time; not needed here.
vi.mock('@/lib/api/query-client', () => ({
  QUERY_KEYS: { tasks: (params?: Record<string, unknown>) => ['tasks', params ?? {}] },
}))

import { tasksApi, type TaskEntry, type TaskListResponse } from '@/lib/api/tasks'
import { useTasks, taskPollInterval } from './use-tasks'

const makeTask = (i: number): TaskEntry => ({
  id: `command:${i}`,
  name: 'export_data',
  type: 'data_transfer',
  target: null,
  status: 'completed',
  retryable: false,
  progress: null,
  error_message: null,
  created: '2026-09-28T00:00:00Z',
  updated: null,
})

const page = (taskCount: number, total: number): TaskListResponse => ({
  tasks: Array.from({ length: taskCount }, (_, i) => makeTask(i)),
  total,
  counts: {},
})

function useLastOptions(status?: string, limit?: number) {
  useTasks(status, limit)
  return useInfiniteQueryMock.mock.calls[useInfiniteQueryMock.mock.calls.length - 1][0] as {
    initialPageParam: number
    queryFn: (ctx: { pageParam: number }) => Promise<unknown>
    getNextPageParam: (
      lastPage: TaskListResponse,
      allPages: TaskListResponse[],
    ) => number | undefined
  }
}

describe('useTasks infinite pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts paging at offset 0', () => {
    expect(useLastOptions().initialPageParam).toBe(0)
  })

  it('returns the cumulative shown count as the next offset while rows remain', () => {
    const { getNextPageParam } = useLastOptions()
    // next offset must be 200 (all pages combined), not the last page's 100
    expect(getNextPageParam(page(100, 250), [page(100, 250), page(100, 250)])).toBe(200)
  })

  it('stops once every matching task is shown', () => {
    const { getNextPageParam } = useLastOptions()
    expect(getNextPageParam(page(100, 100), [page(100, 100)])).toBeUndefined()
    expect(
      getNextPageParam(page(50, 150), [page(100, 150), page(50, 150)]),
    ).toBeUndefined()
  })

  it('stops when shown exceeds total (counts drifted between pages)', () => {
    const { getNextPageParam } = useLastOptions()
    expect(getNextPageParam(page(100, 80), [page(100, 80)])).toBeUndefined()
  })

  it('requests the next page with the server-side status filter and offset', async () => {
    const { queryFn } = useLastOptions('new,queued,running', 100)

    await queryFn({ pageParam: 200 })

    expect(vi.mocked(tasksApi.list)).toHaveBeenCalledWith({
      status: 'new,queued,running',
      limit: 100,
      offset: 200,
    })
  })

  it('calculates polling interval based on active task presence', () => {
    // 1. undefined data returns false (no polling)
    expect(taskPollInterval(undefined)).toBe(false)

    // 2. data with active tasks (running/queued/new) returns ACTIVE_POLL_MS (3000ms)
    const activeData: TaskListResponse = {
      tasks: [],
      total: 10,
      counts: { running: 2, completed: 8 },
    }
    expect(taskPollInterval(activeData)).toBe(3000)

    // 3. data with only completed/failed tasks returns IDLE_POLL_MS (60000ms)
    const idleData: TaskListResponse = {
      tasks: [],
      total: 8,
      counts: { completed: 6, failed: 2 },
    }
    expect(taskPollInterval(idleData)).toBe(60000)
  })
})

import {
  useInfiniteQuery,
  type InfiniteData,
} from '@tanstack/react-query'
import { tasksApi, type TaskListResponse } from '@/lib/api/tasks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { ACTIVE_TASK_STATUSES } from '@/lib/api/tasks'

// While anything is active, keep the task list fresh; an idle list still
// refreshes slowly so completed rows pick up timestamps, but an errored
// backend stops the hammering entirely.
const ACTIVE_POLL_MS = 3000
const IDLE_POLL_MS = 60_000

export function taskPollInterval(
  data: TaskListResponse | undefined
): number | false {
  if (!data) return false
  const active = Object.entries(data.counts ?? {})
    .filter(([status]) => ACTIVE_TASK_STATUSES.has(status))
    .reduce((sum, [, n]) => sum + n, 0)
  return active > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS
}

// Counts are identical on every page (they always reflect the whole table),
// so the first page is enough to drive the poll cadence.
const firstPage = (
  data: InfiniteData<TaskListResponse> | undefined
): TaskListResponse | undefined => data?.pages?.[0]

// Counts are identical on every page (they always reflect the whole table),
// so the first page is enough to drive the poll cadence. Refetching an
// infinite query re-fetches every loaded page, so once the user has paged
// deeper we drop to the slow cadence instead of hammering the aggregates.
const pollIntervalFor = (
  data: InfiniteData<TaskListResponse> | undefined
): number | false => {
  if (data && data.pages.length > 1) return IDLE_POLL_MS
  return taskPollInterval(firstPage(data))
}

export function useTasks(status?: string, limit = 100) {
  return useInfiniteQuery({
    queryKey: QUERY_KEYS.tasks({ status, limit }),
    queryFn: ({ pageParam }) =>
      tasksApi.list({ status, limit, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const shown = allPages.reduce((n, page) => n + page.tasks.length, 0)
      return shown < lastPage.total ? shown : undefined
    },
    refetchInterval: (query) => pollIntervalFor(query.state.data),
    staleTime: 0,
  })
}

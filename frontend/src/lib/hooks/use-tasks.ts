import { useQuery } from '@tanstack/react-query'
import { tasksApi, type TaskListResponse } from '@/lib/api/tasks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { ACTIVE_TASK_STATUSES } from '@/lib/api/tasks'

// While anything is active, keep the task list fresh; an idle list still
// refreshes slowly so completed rows pick up timestamps, but an errored
// backend stops the hammering entirely.
const ACTIVE_POLL_MS = 3000
const IDLE_POLL_MS = 60_000

export function taskPollInterval(data: TaskListResponse | undefined): number | false {
  if (!data) return false
  const active = Object.entries(data.counts ?? {})
    .filter(([status]) => ACTIVE_TASK_STATUSES.has(status))
    .reduce((sum, [, n]) => sum + n, 0)
  return active > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS
}

export function useTasks(status?: string, limit = 100) {
  return useQuery({
    queryKey: QUERY_KEYS.tasks({ status, limit }),
    queryFn: () => tasksApi.list({ status, limit }),
    refetchInterval: (query) =>
      taskPollInterval(query.state.data as TaskListResponse | undefined),
    staleTime: 0,
  })
}

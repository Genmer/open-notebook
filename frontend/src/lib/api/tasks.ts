import apiClient from './client'

export type TaskStatus = 'new' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

export interface TaskProgress {
  kind: string
  embedded_chunks?: number | null
  total_chunks?: number | null
  stage?: string | null
  percent?: number | null
  message?: string | null
}

export interface TaskEntry {
  id: string
  name: string
  type: string
  target: string | null
  status: TaskStatus | string
  progress: TaskProgress | null
  error_message: string | null
  created: string | null
  updated: string | null
}

export interface TaskListResponse {
  tasks: TaskEntry[]
  total: number
  counts: Record<string, number>
}

export const tasksApi = {
  list: async (params?: {
    name?: string
    status?: string
    type?: string
    limit?: number
    offset?: number
  }): Promise<TaskListResponse> => {
    const response = await apiClient.get<TaskListResponse>('/commands/jobs', { params })
    return response.data
  },
}

/** Statuses that mean work is still pending or in flight. */
export const ACTIVE_TASK_STATUSES = new Set(['new', 'queued', 'running'])

export function hasActiveTasks(tasks: TaskEntry[] | undefined): boolean {
  return !!tasks?.some((task) => ACTIVE_TASK_STATUSES.has(task.status))
}

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
  retryable: boolean
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

// check_recovery=true makes the backend pre-check recovery and answer
// { status: 'skipped_recovered', job_id: null } instead of replaying the job.
export interface StageInfo {
  id: string
  title: string
  desc?: string | null
  description?: string | null
  status: string
}

export interface LiveProgressTokenStats {
  is_model: boolean
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  tokens_per_sec: number
  tokens_per_second?: number | null
  model?: string | null
  chunks?: number | null
  total_chunks?: number | null
}

export interface JobLiveProgressResponse {
  job_id: string
  command: string
  status: string
  stage: string
  stage_index: number
  total_stages: number
  stages: StageInfo[]
  percent: number
  elapsed_seconds: number
  stopwatch: string
  token_count: number
  tokens: LiveProgressTokenStats
  stream_text?: string | null
  message?: string | null
  created?: string | null
  updated?: string | null
  error_message?: string | null
}

export interface TaskRetryResponse {
  job_id: string | null
  status: string
  message?: string
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

  getLiveProgress: async (jobId: string): Promise<JobLiveProgressResponse> => {
    const response = await apiClient.get<JobLiveProgressResponse>(
      `/commands/jobs/${encodeURIComponent(jobId)}/live-progress`
    )
    return response.data
  },

  cancel: async (id: string): Promise<void> => {
    await apiClient.delete(`/commands/jobs/${encodeURIComponent(id)}`)
  },

  retry: async (
    id: string,
    opts?: { checkRecovery?: boolean },
  ): Promise<TaskRetryResponse> => {
    const response = await apiClient.post<TaskRetryResponse>(
      `/commands/jobs/${encodeURIComponent(id)}/retry`,
      undefined,
      { params: opts?.checkRecovery ? { check_recovery: true } : undefined },
    )
    return response.data
  },
}

/** Statuses that mean work is still pending or in flight. */
export const ACTIVE_TASK_STATUSES = new Set(['new', 'queued', 'running'])

export function hasActiveTasks(tasks: TaskEntry[] | undefined): boolean {
  return !!tasks?.some((task) => ACTIVE_TASK_STATUSES.has(task.status))
}

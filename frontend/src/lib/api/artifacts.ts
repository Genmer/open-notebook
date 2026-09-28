import apiClient from './client'
import type { ArtifactContextConfig, ArtifactType } from '@/lib/utils/artifact-context'

export interface GenerateArtifactRequest {
  artifact_type: ArtifactType
  instruction?: string
  context_config?: ArtifactContextConfig
}

export interface ArtifactJob {
  job_id: string
  status: string
  artifact_type: string
  message: string
}

/** Shape of GET /commands/jobs/{job_id} (api/routers/commands.py). */
export interface CommandJobStatus {
  job_id: string
  status: string
  result?: Record<string, unknown> | null
  error_message?: string | null
  created?: string | null
  updated?: string | null
  progress?: Record<string, unknown> | null
}

export const artifactsApi = {
  // Submit an async artifact generation; returns immediately with a job id.
  generate: async (notebookId: string, data: GenerateArtifactRequest) => {
    const response = await apiClient.post<ArtifactJob>(
      `/notebooks/${notebookId}/artifacts`,
      data
    )
    return response.data
  },

  // Reuse the generic command job status endpoint for progress polling.
  getJobStatus: async (jobId: string) => {
    const response = await apiClient.get<CommandJobStatus>(`/commands/jobs/${jobId}`)
    return response.data
  },
}

import apiClient from './client'

export interface SourceSectionAnalysisRequest {
  section_title: string
  section_text: string
  page_start?: number | null
  page_end?: number | null
  locale: string
}

export interface SourceSectionAnalysisResponse {
  analysis_markdown: string
  model_name: string | null
  provider: string | null
  truncated: boolean
}

export interface SourceSectionAnalysisSubmitResponse {
  job_id: string
  status: string
}

/** Shape of the `result` object on a completed analyze_source_section job. */
export interface SectionAnalysisJobResult extends SourceSectionAnalysisResponse {
  success?: boolean
  processing_time?: number
}

export interface CommandJobStatusResponse {
  job_id: string
  status: string
  result?: SectionAnalysisJobResult | Record<string, unknown> | null
  error_message?: string | null
  created?: string | null
  updated?: string | null
}

export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'canceled', 'error', 'unknown']

export const sourceAnalysisApi = {
  /** Submit the section analysis as a background job; the final markdown
   * lands in the job result (poll getJobStatus / live-progress). */
  analyzeSection: async (
    sourceId: string,
    payload: SourceSectionAnalysisRequest
  ): Promise<SourceSectionAnalysisSubmitResponse> => {
    const response = await apiClient.post<SourceSectionAnalysisSubmitResponse>(
      `/sources/${sourceId}/sections/analyze`,
      payload
    )
    return response.data
  },

  getJobStatus: async (jobId: string): Promise<CommandJobStatusResponse> => {
    const response = await apiClient.get<CommandJobStatusResponse>(
      `/commands/jobs/${encodeURIComponent(jobId)}`
    )
    return response.data
  },
}

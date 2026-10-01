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

export const sourceAnalysisApi = {
  /** Synchronous section analysis (backend allows up to 300s; axios default is 10min). */
  analyzeSection: async (
    sourceId: string,
    payload: SourceSectionAnalysisRequest
  ): Promise<SourceSectionAnalysisResponse> => {
    const response = await apiClient.post<SourceSectionAnalysisResponse>(
      `/sources/${sourceId}/sections/analyze`,
      payload
    )
    return response.data
  },
}

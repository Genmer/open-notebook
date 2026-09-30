import apiClient from './client'

export interface ExplainSuggestion {
  action: string
  label_key: string
}

export interface ExplainFact {
  label_key: string
  value: string
}

export interface ExplainResponse {
  mode: 'explain' | 'followup'
  classification:
    | 'user_fixable'
    | 'transient'
    | 'known_issue'
    | 'likely_bug'
    | 'unknown'
    | null
  explanation_markdown: string
  suggestions: ExplainSuggestion[]
  facts: ExplainFact[]
  recovery?: { recovered: boolean; detail: string } | null
  degraded: boolean
  from_cache: boolean
}

export interface ExplainPayload {
  resource_type: 'failed_command'
  resource_id: string
  question: string | null
  history: { role: string; content: string }[]
  locale: string
  refresh: boolean
}

export const explainApi = {
  explain: async (payload: ExplainPayload): Promise<ExplainResponse> => {
    const response = await apiClient.post<ExplainResponse>('/explain', payload)
    return response.data
  },
}

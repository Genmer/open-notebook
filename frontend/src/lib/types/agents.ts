export interface Agent {
  id: string
  name: string
  system_prompt: string
  description: string | null
  model_id: string | null
  temperature: number | null
  max_tokens: number | null
  enabled: boolean
  sort_order: number
  in_use_session_count: number
  created: string
  updated: string
}

export interface CreateAgentRequest {
  name: string
  system_prompt: string
  description?: string | null
  model?: string | null
  temperature?: number | null
  max_tokens?: number | null
  enabled?: boolean
  sort_order?: number
}

export interface UpdateAgentRequest {
  name?: string
  system_prompt?: string
  description?: string | null
  model?: string | null
  temperature?: number | null
  max_tokens?: number | null
  enabled?: boolean
  sort_order?: number
}

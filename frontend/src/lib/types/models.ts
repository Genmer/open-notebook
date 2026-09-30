export interface Model {
  id: string
  name: string
  provider: string
  type: 'language' | 'embedding' | 'text_to_speech' | 'speech_to_text'
  credential?: string | null
  created: string
  updated: string
  // CNY per 1M tokens; null until fetched from the public price database or
  // entered manually (see ModelPriceDialog).
  price_input_per_m?: number | null
  price_output_per_m?: number | null
  price_source?: 'litellm' | 'manual' | null
  price_matched_key?: string | null
  price_fetched_at?: string | null
}

export interface ModelPriceResult {
  id: string
  price_input_per_m?: number | null
  price_output_per_m?: number | null
  price_source?: 'litellm' | 'manual' | null
  price_matched_key?: string | null
  price_fetched_at?: string | null
  found: boolean
}

export interface CreateModelRequest {
  name: string
  provider: string
  type: 'language' | 'embedding' | 'text_to_speech' | 'speech_to_text'
  credential?: string
}

export interface ModelDefaults {
  default_chat_model?: string | null
  default_transformation_model?: string | null
  large_context_model?: string | null
  default_text_to_speech_model?: string | null
  default_speech_to_text_model?: string | null
  default_embedding_model?: string | null
  default_tools_model?: string | null
  default_qa_model?: string | null
}

export interface ProviderAvailability {
  available: string[]
  unavailable: string[]
  supported_types: Record<string, string[]>
}

// Model Discovery Types
export interface DiscoveredModel {
  name: string
  provider: string
  model_type: 'language' | 'embedding' | 'text_to_speech' | 'speech_to_text'
  description?: string
}

export interface ProviderSyncResult {
  provider: string
  discovered: number
  new: number
  existing: number
}

export interface AllProvidersSyncResult {
  results: Record<string, ProviderSyncResult>
  total_discovered: number
  total_new: number
}

export interface ProviderModelCount {
  provider: string
  counts: Record<string, number>
  total: number
}

export interface AutoAssignResult {
  assigned: Record<string, string>  // slot_name -> model_id
  skipped: string[]  // slots already assigned
  missing: string[]  // slots with no available models
}

export interface ModelTestResult {
  success: boolean
  message: string
  details?: string
}
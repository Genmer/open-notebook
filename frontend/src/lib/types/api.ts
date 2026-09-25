export interface NotebookResponse {
  id: string
  name: string
  description: string
  archived: boolean
  created: string
  updated: string
  source_count: number
  note_count: number
}

export interface NoteResponse {
  id: string
  title: string | null
  content: string | null
  note_type: string | null
  created: string
  updated: string
}

export interface SourceEmbeddingStatus {
  status: 'not_embedded' | 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  embedded_chunks: number
  total_chunks?: number | null
  error?: string | null
  command_id?: string | null
}

export type SourceProcessingStepKey = 'extraction' | 'embedding' | 'transformation' | 'completion'

export type SourceProcessingStepStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'unknown'

export interface SourceProcessingStep {
  key: SourceProcessingStepKey
  status: SourceProcessingStepStatus
  current?: number | null
  total?: number | null
  error?: string | null
}

export interface SourceListResponse {
  id: string
  title: string | null
  topics?: string[]                  // Make optional to match Python API
  asset: {
    file_path?: string
    url?: string
  } | null
  embedded: boolean
  embedded_chunks: number            // ADD: From Python API
  insights_count: number
  created: string
  updated: string
  file_available?: boolean
  // ADD: Async processing fields from Python API
  command_id?: string
  status?: string
  processing_info?: Record<string, unknown>
  embedding_status?: string | null
}

export interface SourceDetailResponse extends SourceListResponse {
  full_text: string
  notebooks?: string[]  // List of notebook IDs this source is linked to
  embedding?: SourceEmbeddingStatus | null
}

export type SourceResponse = SourceDetailResponse

export interface SourceTitleResponse {
  id: string
  title: string | null
}

export interface SourceTypeGroupResponse {
  key: string
  count: number
}


export interface SourceStatusResponse {
  status?: string
  message: string
  processing_info?: Record<string, unknown>
  command_id?: string
  embedding?: SourceEmbeddingStatus | null
  steps?: SourceProcessingStep[] | null
}

export type SourceViewType = 'ai_content' | 'ai_title' | 'custom'

export interface SourceViewResponse {
  id: string
  name: string
  view_type: SourceViewType
  is_default: boolean
  last_classified_at: string | null
  classify_progress: ClassifyProgress | null
  created: string | null
  updated: string | null
}

export interface ClassifyProgress {
  stage: 'clustering' | 'llm' | 'assigning' | 'done' | 'failed'
  percent: number
  message: string
  error: string | null
  groups_created?: number
  sources_classified?: number
  unclassified?: number
}

export interface ClassifyViewResponse {
  command_id: string
}

export interface SourceGroupResponse {
  id: string
  view_id: string
  name: string
  parent_id: string | null
  source_count: number
  created: string | null
  updated: string | null
}

export interface GroupMembersRequest {
  source_ids: string[]
}

export interface GroupMembersResponse {
  moved: number
}

export interface ViewUngroupResponse {
  removed: number
}

export interface CopyFailure {
  source_id: string
  reason: string
}

export interface CopyToGroupResponse {
  created: string[]
  failed: CopyFailure[]
}

export interface ViewDeleteResponse {
  deleted_groups: number
}

export interface GroupDeleteResponse {
  deleted_groups: number
  deleted_sources: number
}

export interface SettingsResponse {
  default_content_processing_engine_doc?: string
  default_content_processing_engine_url?: string
  default_embedding_option?: string
  auto_delete_files?: string
  docling_ocr?: boolean
  docling_formulas?: boolean
  docling_vision?: boolean
  youtube_preferred_languages?: string[]
  // Raw DB values: undefined means "not set, follow env var / default".
  chunk_size?: number
  chunk_overlap?: number
  min_chunk_size?: number
  embedding_batch_size?: number
  usage_tracking_enabled?: boolean
  // Read-only resolved values (DB > env > default) for display.
  effective_chunk_size: number
  effective_chunk_overlap: number
  effective_min_chunk_size: number
  effective_embedding_batch_size: number
}

export interface Capabilities {
  docling_available: boolean
  crawl4ai_available: boolean
  crawl4ai_remote_configured: boolean
}

export interface CreateNotebookRequest {
  name: string
  description?: string
}

export interface UpdateNotebookRequest {
  name?: string
  description?: string
  archived?: boolean
}

export interface NotebookDeletePreview {
  notebook_id: string
  notebook_name: string
  note_count: number
  exclusive_source_count: number
  shared_source_count: number
}

export interface NotebookDeleteResponse {
  message: string
  deleted_notes: number
  deleted_sources: number
  unlinked_sources: number
}

export interface CreateNoteRequest {
  title?: string
  content: string
  note_type?: string
  notebook_id?: string
}

export interface CreateSourceRequest {
  // Backward compatibility: support old single notebook_id
  notebook_id?: string
  // New multi-notebook support
  notebooks?: string[]
  // Required fields
  type: 'link' | 'upload' | 'text'
  url?: string
  file_path?: string
  content?: string
  title?: string
  transformations?: string[]
  embed?: boolean
  delete_source?: boolean
  // New async processing support
  async_processing?: boolean
}

export interface UpdateNoteRequest {
  title?: string
  content?: string
  note_type?: string
}

export interface UpdateSourceRequest {
  title?: string
  type?: 'link' | 'upload' | 'text'
  url?: string
  content?: string
}

export interface APIError {
  detail: string
}

// Source Chat Types
// Base session interface with common fields
export interface BaseChatSession {
  id: string
  title: string
  created: string
  updated: string
  message_count?: number
  model_override?: string | null
}

export interface SourceChatSession extends BaseChatSession {
  source_id: string
  model_override?: string
}

export interface SourceChatMessage {
  id: string
  type: 'human' | 'ai'
  content: string
  timestamp?: string
}

export interface SourceChatContextIndicator {
  sources: string[]
  insights: string[]
  notes: string[]
}

export interface SourceChatSessionWithMessages extends SourceChatSession {
  messages: SourceChatMessage[]
  context_indicators?: SourceChatContextIndicator
}

export interface CreateSourceChatSessionRequest {
  source_id: string
  title?: string
  model_override?: string
}

export interface UpdateSourceChatSessionRequest {
  title?: string
  model_override?: string
}

export interface SendMessageRequest {
  message: string
  model_override?: string
}

export interface SourceChatStreamEvent {
  type: 'user_message' | 'ai_message' | 'context_indicators' | 'complete' | 'error'
  content?: string
  data?: unknown
  message?: string
  timestamp?: string
}

// Notebook Chat Types
export interface NotebookChatSession extends BaseChatSession {
  notebook_id: string
}

export interface NotebookChatMessage {
  id: string
  type: 'human' | 'ai'
  content: string
  timestamp?: string
}

export interface NotebookChatSessionWithMessages extends NotebookChatSession {
  messages: NotebookChatMessage[]
}

export interface CreateNotebookChatSessionRequest {
  notebook_id: string
  title?: string
  model_override?: string
}

export interface UpdateNotebookChatSessionRequest {
  title?: string
  model_override?: string | null
}

export interface SendNotebookChatMessageRequest {
  session_id: string
  message: string
  context: {
    sources: Array<Record<string, unknown>>
    notes: Array<Record<string, unknown>>
  }
  model_override?: string
}

export interface BuildContextRequest {
  notebook_id: string
  context_config: {
    sources: Record<string, string>
    notes: Record<string, string>
  }
}

export interface BuildContextResponse {
  context: {
    sources: Array<Record<string, unknown>>
    notes: Array<Record<string, unknown>>
  }
  token_count: number
  char_count: number
}

export interface RecentlyViewedResponse {
  type: 'notebook' | 'source'
  id: string
  title: string
  last_viewed_at: string
}

// Usage tracking types. estimated_tokens / previous_totals are optional so
// the UI keeps working against an API that predates them.
export interface UsageTotals {
  calls: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_tokens?: number
}

export interface UsageByModel extends UsageTotals {
  model_name?: string | null
  provider?: string | null
}

export interface UsageByDay extends UsageTotals {
  day: string
}

export interface UsageDayModel {
  day: string
  model_name: string | null
  total_tokens: number
}

export interface UsageSummaryResponse {
  totals: UsageTotals
  previous_totals?: UsageTotals
  by_model: UsageByModel[]
  by_day: UsageByDay[]
  daily_by_model: UsageDayModel[]
}

export interface UsageRecord {
  id?: string | null
  created?: string | null
  day?: string | null
  model_name?: string | null
  provider?: string | null
  model_id?: string | null
  call_type?: string | null
  correlation_id?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  total_tokens?: number | null
  is_estimated: boolean
  success: boolean
  error?: string | null
}

export interface UsageRecordsResponse {
  records: UsageRecord[]
  total: number
}

export interface UsageClearResponse {
  deleted: number
}

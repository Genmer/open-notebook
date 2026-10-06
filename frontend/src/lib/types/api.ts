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


export interface SourceInsightJob {
  command_id: string
  transformation_id?: string | null
  transformation_title?: string | null
  status: string
  error_message?: string | null
}

export interface SourceStatusResponse {
  status?: string
  message: string
  processing_info?: Record<string, unknown>
  command_id?: string
  embedding?: SourceEmbeddingStatus | null
  steps?: SourceProcessingStep[] | null
  insight_jobs?: SourceInsightJob[] | null
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

// Project environment types (软考项目环境) — mirror of the backend
// ProjectEnvResponse family in api/models.py.
export type ProjectEnvSourceType = 'real' | 'mock'
export type ProjectEnvStatus = 'pending' | 'verified' | 'needs_review' | 'failed'

export interface ProjectEnvAiAssisted {
  polish_count?: number
  last_polished_at?: string
}

export interface ProjectEnvTimeAdjusted {
  from: { period_start: string; period_end: string }
  to: { period_start: string; period_end: string }
  reason?: string
}

export interface ProjectEnvTimeWarning {
  rule: string
  severity: string
  message: string
  params?: Record<string, unknown>
}

export interface ProjectEnvVerificationProgress {
  stage?: string
  percent?: number
  message?: string
  error?: string | null
  updated?: string
}

export interface ProjectEnv {
  id: string
  name: string
  background: string
  period_start: string
  period_end: string
  source_type: ProjectEnvSourceType
  keywords: string[] | null
  tech_background: string
  tuning_process: string | null
  problems_solutions: string | null
  my_role: string | null
  scale: string | null
  status: ProjectEnvStatus | string
  ai_assisted: ProjectEnvAiAssisted | null
  time_adjusted: ProjectEnvTimeAdjusted | null
  time_warnings: ProjectEnvTimeWarning[]
  pending_claims_count: number
  session_ref_count: number
  verification_progress: ProjectEnvVerificationProgress | null
  has_snapshot: boolean
  active_job_id: string | null
  created: string
  updated: string
}

export interface CreateProjectEnvRequest {
  name: string
  background: string
  period_start: string
  period_end: string
  source_type: ProjectEnvSourceType
  keywords?: string[]
  tech_background: string
  tuning_process?: string | null
  problems_solutions?: string | null
  my_role?: string | null
  scale?: string | null
  background_ai_polished?: boolean
}

export interface UpdateProjectEnvRequest {
  name?: string
  background?: string
  period_start?: string
  period_end?: string
  source_type?: ProjectEnvSourceType
  keywords?: string[]
  tech_background?: string
  tuning_process?: string | null
  problems_solutions?: string | null
  my_role?: string | null
  scale?: string | null
}

export interface MockGenerateRequest {
  name?: string
  keywords: string[]
  period_start?: string
  period_end?: string
}

export interface MockGenerateResponse {
  id: string
  job_id: string
}

export interface PolishBackgroundRequest {
  background: string
  name?: string
  tech_background?: string
}

export interface PolishBackgroundResponse {
  polished: string
}

export interface ProjectEnvLaneResult {
  verdict: string
  issues?: string[]
}

export type ProjectEnvLane = 'A' | 'B' | 'C'
export type ProjectEnvLanes = Partial<Record<ProjectEnvLane, ProjectEnvLaneResult>>

export interface ProjectEnvClaimRound {
  round: number
  action: string
  lane_results?: ProjectEnvLanes
  corrected_text?: string
  verdict: string
}

export type ProjectEnvPointState =
  | 'pending'
  | 'passed'
  | 'manual_review'
  | 'dismissed'
  | 'rewritten'
  | 'exempt'
  | 'error'

export interface ProjectEnvClaimPoint {
  point_id: string
  quote: string
  field: string
  type?: string
  state: ProjectEnvPointState | string
  manual_reason?: string
  lanes?: ProjectEnvLanes
  rounds?: ProjectEnvClaimRound[]
}

export interface ProjectEnvVerificationSummary {
  total?: number
  passed?: number
  failed?: number
  manual?: number
  uncovered?: number
}

export interface ProjectEnvVerificationStatus {
  status: ProjectEnvStatus | string
  job?: { id: string; status?: string; error_message?: string | null } | null
  progress?: ProjectEnvVerificationProgress | null
  summary?: ProjectEnvVerificationSummary | null
  points: ProjectEnvClaimPoint[]
  degraded?: Record<string, unknown> | null
}

export interface RewriteClaimRequest {
  text: string
}

export interface RewriteClaimResponse {
  passed: boolean
  lanes: ProjectEnvLanes
  env: ProjectEnv
}

export interface ReverifyResponse {
  job_id: string
}

export interface ProjectEnvDeleteResponse {
  success: boolean
  affected_sessions: number
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
  agent?: string | null
  project_env?: string | null
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
  // Run metadata (PDR-004): only notebook chat messages carry these; the
  // parallel group renderer reads them off the shared message shape.
  model_name?: string | null
  agent_name?: string | null
  run_role?: string | null
  group_id?: string | null
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
  model_name?: string | null
  agent_name?: string | null
  run_role?: string | null
  group_id?: string | null
}

export interface NotebookChatSessionWithMessages extends NotebookChatSession {
  messages: NotebookChatMessage[]
}

export interface CreateNotebookChatSessionRequest {
  notebook_id: string
  title?: string
  model_override?: string
  agent?: string
  project_env?: string
}

export interface UpdateNotebookChatSessionRequest {
  title?: string
  model_override?: string | null
  agent?: string | null
  project_env?: string | null
}

export interface SendNotebookChatMessageRequest {
  session_id: string
  message: string
  context: {
    sources: Array<Record<string, unknown>>
    notes: Array<Record<string, unknown>>
  }
  model_override?: string
  agent_override?: string
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
  estimated_cost_cny?: number | null
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
  // Model names excluded from totals.estimated_cost_cny because no price is
  // stored for them; the usage page points the user at the model settings.
  unpriced_models?: string[]
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

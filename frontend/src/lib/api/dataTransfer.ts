import apiClient from './client'
import { getApiUrl } from '@/lib/config'
import { getAuthToken } from '@/lib/auth-token'

export type TransferStatus = 'none' | 'queued' | 'running' | 'completed' | 'failed'

export interface TransferProgress {
  stage?: string
  percent: number
  message?: string
  error?: string
  /** Structured per-item progress the UI renders with localized templates. */
  detail?: Record<string, unknown> | null
  /** Last detail per finished stage id, so rows keep stats across refreshes. */
  stages?: Record<string, Record<string, unknown>> | null
}

export interface ExportSummary {
  package_filename: string
  package_size_bytes: number
  package_type?: 'full' | 'models'
  counts: Record<string, number>
  files_skipped: number
  /** First 100 skipped entries (source_id/file/reason); files_skipped stays the total. */
  skipped_files?: Array<{ source_id: string; file: string; reason: string }>
  duration_seconds?: number | null
  embedding_model_id?: string | null
  embedding_dimension?: number | null
  exported_at?: string | null
}

export interface TransferWarning {
  code: string
  params?: Record<string, string | number>
}

export interface ImportSummary {
  imported: Record<string, number>
  skipped: Record<string, number>
  warnings: string[]
  warning_codes?: TransferWarning[]
  embedding_model_id?: string | null
  embedding_dimension?: number | null
  duration_seconds?: number | null
}

export interface ExportStatusResponse {
  status: TransferStatus
  command_id?: string
  progress?: TransferProgress
  summary?: ExportSummary
}

export interface ImportStatusResponse {
  status: TransferStatus
  command_id?: string
  progress?: TransferProgress
  summary?: ImportSummary
}

export interface DataTransferStartResponse {
  command_id: string
  message: string
}

export interface PackageDeleteResponse {
  deleted: boolean
}

export type ExportScope = 'full' | 'models' | 'notebooks'

export interface ExportStartInput {
  scope: ExportScope
  include_models: boolean
  /** Only for scope='notebooks': the topic-package notebook selection. */
  notebook_ids?: string[]
}

export interface ExportEstimate {
  scope: string
  notebook_ids: string[]
  notebooks: number
  sources: number
  notes: number
  insights: number
  embeddings: number
  asset_files: number
  asset_bytes: number
  text_chars: number
  /** Deflated-zip approximation; the UI renders it with a "~" prefix. */
  estimated_package_bytes: number
}

export interface DownloadProgress {
  /** Bytes received so far. */
  loaded: number
  /** Total bytes when Content-Length is present, otherwise 0 (indeterminate). */
  total: number
}

export interface ImportConflictItem {
  kind: 'credential' | 'model'
  id: string
  local: Record<string, unknown>
  package: Record<string, unknown>
  diff_fields: string[]
  default_action: 'skip' | 'overwrite'
}

export interface ImportScanResponse {
  scan_id: string
  package_type: ExportScope
  format_version: number
  counts: Record<string, number>
  conflicts: ImportConflictItem[]
  decisions_required: number
}

export interface ImportDecisionInput {
  kind: 'credential' | 'model'
  id: string
  action: 'skip' | 'overwrite'
}

export interface ImportExecuteInput {
  scan_id: string
  decisions: ImportDecisionInput[]
}

export const dataTransferApi = {
  startExport: async (input: ExportStartInput): Promise<DataTransferStartResponse> => {
    const response = await apiClient.post<DataTransferStartResponse>(
      '/data-transfer/export',
      input
    )
    return response.data
  },

  getExportStatus: async (): Promise<ExportStatusResponse> => {
    const response = await apiClient.get<ExportStatusResponse>('/data-transfer/export/status')
    return response.data
  },

  // Pre-export preview (counts, asset bytes, ~package size). Worker-free and
  // read-only, so it is cheap to re-fetch whenever the dialog's scope or
  // notebook selection changes.
  estimateExport: async (input: {
    scope: ExportScope
    notebook_ids?: string[]
  }): Promise<ExportEstimate> => {
    const params = new URLSearchParams()
    params.set('scope', input.scope)
    for (const id of input.notebook_ids ?? []) params.append('notebook_ids', id)
    const response = await apiClient.get<ExportEstimate>(
      `/data-transfer/export/estimate?${params.toString()}`
    )
    return response.data
  },

  // Streaming download with progress. axios buffers blob responses whole, so
  // this bypasses apiClient for a raw fetch against the API base (same
  // reasoning as chat streaming: no proxy hop, auth header carried manually)
  // and accumulates chunks so the caller can render bytes/percent live.
  downloadExport: async (
    onProgress?: (progress: DownloadProgress) => void,
    fallbackFilename = 'open_notebook_export.zip',
    signal?: AbortSignal
  ): Promise<void> => {
    const token = getAuthToken()
    const apiUrl = await getApiUrl()
    const response = await fetch(`${apiUrl}/api/data-transfer/export/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    })
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`)
    }
    const disposition = response.headers.get('content-disposition')
    const match =
      typeof disposition === 'string'
        ? disposition.match(/filename="?([^";]+)"?/i)
        : null
    const filename = match?.[1] || fallbackFilename
    const total = Number(response.headers.get('content-length')) || 0

    const chunks: BlobPart[] = []
    let loaded = 0
    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value as unknown as BlobPart)
          loaded += value.byteLength
          onProgress?.({ loaded, total })
        }
      }
    }

    const blob = new Blob(chunks, { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  },

  deleteExportPackage: async (): Promise<PackageDeleteResponse> => {
    const response = await apiClient.delete<PackageDeleteResponse>('/data-transfer/export/package')
    return response.data
  },

  uploadImport: async (file: File): Promise<ImportScanResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await apiClient.post<ImportScanResponse>(
      '/data-transfer/import',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    )
    return response.data
  },

  executeImport: async (input: ImportExecuteInput): Promise<DataTransferStartResponse> => {
    const response = await apiClient.post<DataTransferStartResponse>(
      '/data-transfer/import/execute',
      input
    )
    return response.data
  },

  getImportStatus: async (): Promise<ImportStatusResponse> => {
    const response = await apiClient.get<ImportStatusResponse>('/data-transfer/import/status')
    return response.data
  },
}

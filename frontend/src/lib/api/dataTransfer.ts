import apiClient from './client'

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

export type ExportScope = 'full' | 'models'

export interface ExportStartInput {
  scope: ExportScope
  include_models: boolean
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

  // Blob download through apiClient (auth header included, unlike window.open)
  downloadExport: async (fallbackFilename = 'open_notebook_export.zip'): Promise<void> => {
    const response = await apiClient.get<Blob>('/data-transfer/export/download', {
      responseType: 'blob',
    })
    const disposition = response.headers?.['content-disposition']
    const match =
      typeof disposition === 'string' ? disposition.match(/filename="?([^";]+)"?/i) : null
    const filename = match?.[1] || fallbackFilename

    const url = URL.createObjectURL(response.data)
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

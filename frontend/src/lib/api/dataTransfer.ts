import apiClient from './client'

export type TransferStatus = 'none' | 'queued' | 'running' | 'completed' | 'failed'

export interface TransferProgress {
  stage?: string
  percent: number
  message?: string
  error?: string
}

export interface ExportSummary {
  package_filename: string
  package_size_bytes: number
  counts: Record<string, number>
  files_skipped: number
  embedding_model_id?: string | null
  embedding_dimension?: number | null
  exported_at?: string | null
}

export interface ImportSummary {
  imported: Record<string, number>
  skipped: Record<string, number>
  warnings: string[]
  embedding_model_id?: string | null
  embedding_dimension?: number | null
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

export const dataTransferApi = {
  startExport: async (): Promise<DataTransferStartResponse> => {
    const response = await apiClient.post<DataTransferStartResponse>('/data-transfer/export')
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

  uploadImport: async (file: File): Promise<DataTransferStartResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await apiClient.post<DataTransferStartResponse>(
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

  getImportStatus: async (): Promise<ImportStatusResponse> => {
    const response = await apiClient.get<ImportStatusResponse>('/data-transfer/import/status')
    return response.data
  },
}

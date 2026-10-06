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

export interface ChunkSession {
  upload_id: string
  filename: string
  total_size: number
  chunk_size: number
  total_chunks: number
  uploaded_chunks: number[]
}

export interface ChunkedUploadProgress {
  /** Bytes the server has confirmed, including parts resumed from disk. */
  loaded: number
  total: number
}

// Above this size the upload switches to the chunked/resumable path; below it
// a single request is simpler and just as reliable.
export const CHUNKED_UPLOAD_THRESHOLD = 32 * 1024 * 1024
const CHUNK_SIZE = 8 * 1024 * 1024
const CHUNK_CONCURRENCY = 3
const CHUNK_RETRIES = 3

// Marks 4xx rejections: resending identical bytes cannot heal them, so the
// retry loop must rethrow instead of swallowing them into backoff.
class NonRetryableChunkError extends Error {}

async function putChunk(
  apiUrl: string,
  headers: Record<string, string>,
  uploadId: string,
  index: number,
  blob: Blob,
  signal?: AbortSignal
): Promise<void> {
  const digestBuffer = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const sha256 = Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  let lastError: unknown = null
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `${apiUrl}/api/data-transfer/import/chunk-session/${uploadId}/chunks/${index}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': sha256 },
          body: blob,
          signal,
        }
      )
      if (response.ok) return
      // 4xx other than 429 will not heal by resending the same bytes.
      if (response.status < 500 && response.status !== 429) {
        throw new NonRetryableChunkError(`Chunk ${index} rejected: HTTP ${response.status}`)
      }
      lastError = new Error(`Chunk ${index} retryable: HTTP ${response.status}`)
    } catch (error) {
      if (signal?.aborted || error instanceof NonRetryableChunkError) throw error
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
  }
  throw lastError instanceof Error ? lastError : new Error('chunk upload failed')
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

  // Chunked + resumable upload for large packages. The client_key (name+size+
  // mtime) lets a retry after a network drop or page refresh continue from the
  // parts already on the server instead of starting from zero.
  uploadImportChunked: async (
    file: File,
    onProgress?: (progress: ChunkedUploadProgress) => void,
    signal?: AbortSignal
  ): Promise<ImportScanResponse> => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const clientKey = `${file.name}:${file.size}:${file.lastModified}`
    const sessionResponse = await apiClient.post<ChunkSession>(
      '/data-transfer/import/chunk-session',
      {
        filename: file.name,
        total_size: file.size,
        chunk_size: CHUNK_SIZE,
        total_chunks: totalChunks,
        client_key: clientKey,
      },
      { signal }
    )
    const session = sessionResponse.data
    const uploaded = new Set(session.uploaded_chunks)
    const bytesOf = (index: number): number =>
      Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE)
    const report = () => {
      let loaded = 0
      for (const index of uploaded) loaded += bytesOf(index)
      onProgress?.({ loaded, total: file.size })
    }
    report()

    const token = getAuthToken()
    const apiUrl = await getApiUrl()
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {}

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < totalChunks) {
        const index = cursor++
        if (uploaded.has(index)) continue
        await putChunk(apiUrl, headers, session.upload_id, index, file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), signal)
        uploaded.add(index)
        report()
      }
    }
    await Promise.all(Array.from({ length: CHUNK_CONCURRENCY }, () => worker()))

    const completeResponse = await apiClient.post<ImportScanResponse>(
      `/data-transfer/import/chunk-session/${session.upload_id}/complete`,
      {},
      { signal }
    )
    return completeResponse.data
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

import type { AxiosResponse } from 'axios'

import apiClient from './client'
import { 
  SourceListResponse, 
  SourceDetailResponse, 
  SourceResponse,
  SourceStatusResponse,
  SourceTitleResponse,
  SourceTypeGroupResponse,
  CreateSourceRequest, 
  UpdateSourceRequest 
} from '@/lib/types/api'

export type SourceSortField = 'type' | 'title' | 'created' | 'updated' | 'insights_count' | 'embedded'

export const sourcesApi = {
  list: async (params?: {
    notebook_id?: string
    limit?: number
    offset?: number
    sort_by?: SourceSortField
    sort_order?: 'asc' | 'desc'
    view_id?: string
    group_id?: string
    ungrouped?: boolean
    source_type?: 'file' | 'link' | 'text'
    file_ext?: string
  }) => {
    const response = await apiClient.get<SourceListResponse[]>('/sources', { params })
    return response.data
  },

  typeGroups: async () => {
    const response = await apiClient.get<SourceTypeGroupResponse[]>('/sources/type-groups')
    return response.data
  },

  get: async (id: string) => {
    const response = await apiClient.get<SourceDetailResponse>(`/sources/${id}`)
    return response.data
  },

  create: async (data: CreateSourceRequest & { file?: File }) => {
    // Always use FormData to match backend expectations
    const formData = new FormData()
    
    // Add basic fields
    formData.append('type', data.type)
    
    if (data.notebooks !== undefined) {
      formData.append('notebooks', JSON.stringify(data.notebooks))
    }
    if (data.notebook_id) {
      formData.append('notebook_id', data.notebook_id)
    }
    if (data.title) {
      formData.append('title', data.title)
    }
    if (data.url) {
      formData.append('url', data.url)
    }
    if (data.content) {
      formData.append('content', data.content)
    }
    if (data.transformations !== undefined) {
      formData.append('transformations', JSON.stringify(data.transformations))
    }
    
    const dataWithFile = data as CreateSourceRequest & { file?: File }
    if (dataWithFile.file instanceof File) {
      formData.append('file', dataWithFile.file)
    }
    
    formData.append('embed', String(data.embed ?? false))
    formData.append('delete_source', String(data.delete_source ?? false))
    formData.append('async_processing', String(data.async_processing ?? false))
    
    const response = await apiClient.post<SourceResponse>('/sources', formData)
    return response.data
  },

  update: async (id: string, data: UpdateSourceRequest) => {
    const response = await apiClient.put<SourceListResponse>(`/sources/${id}`, data)
    return response.data
  },

  delete: async (id: string) => {
    await apiClient.delete(`/sources/${id}`)
  },

  status: async (id: string) => {
    const response = await apiClient.get<SourceStatusResponse>(`/sources/${id}/status`)
    return response.data
  },

  titles: async (ids: string[]) => {
    const response = await apiClient.get<SourceTitleResponse[]>('/sources/titles', {
      params: { ids: ids.join(',') },
    })
    return response.data
  },

  upload: async (file: File, notebook_id: string) => {
    const formData = new FormData()
    formData.append('file', file)
    // Plural field (preferred); the deprecated singular notebook_id form
    // field is folded into notebooks by the API model for compatibility.
    formData.append('notebooks', JSON.stringify([notebook_id]))
    formData.append('type', 'upload')
    formData.append('async_processing', 'true')
    
    const response = await apiClient.post<SourceResponse>('/sources', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  },

  retry: async (id: string) => {
    const response = await apiClient.post<SourceResponse>(`/sources/${id}/retry`)
    return response.data
  },

  downloadFile: async (id: string): Promise<AxiosResponse<Blob>> => {
    return apiClient.get(`/sources/${id}/download`, {
      responseType: 'blob',
    })
  },

  /** Raw bytes of the source's original file, for the in-app PDF viewer. */
  fetchSourceFileBuffer: async (sourceId: string): Promise<ArrayBuffer> => {
    const response = await apiClient.get<ArrayBuffer>(
      `/sources/${sourceId}/download`,
      { responseType: 'arraybuffer' }
    )
    return response.data
  },

  /**
   * Locate which passage of a source backs a clicked citation. `passage` is
   * the answer text around the citation marker. Returns null when nothing
   * matches well enough (endpoint 404) — callers fall back to a plain open.
   */
  locatePassage: async (
    sourceId: string,
    passage: string
  ): Promise<PassageLocateResponse | null> => {
    try {
      const response = await apiClient.get<PassageLocateResponse>(
        `/sources/${sourceId}/locate-passage`,
        { params: { passage } }
      )
      return response.data
    } catch {
      return null
    }
  },
}

export interface PassageLocateResponse {
  source_id: string
  chunk_order: number
  quote: string
  score: number
}

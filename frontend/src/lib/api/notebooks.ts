import apiClient from './client'
import {
  NotebookResponse,
  RecentlyViewedResponse,
  CreateNotebookRequest,
  UpdateNotebookRequest,
  NotebookDeletePreview,
  NotebookDeleteResponse,
} from '@/lib/types/api'
import type { ContextMode, ContextTreeResponse } from '@/lib/types/notebook-context'
import { artifactsApi, type GenerateArtifactRequest, type ArtifactJob } from './artifacts'

/** One saved per-source chat-context preference for a folder scope. */
export interface ContextPrefEntry {
  source_id: string
  mode: ContextMode
}

export const notebooksApi = {
  /** Folder tree + every notebook source, for the chat context picker. */
  contextTree: async (notebookId: string, viewId?: string | null) => {
    const response = await apiClient.get<ContextTreeResponse>(
      `/notebooks/${notebookId}/context-tree`,
      { params: viewId ? { view_id: viewId } : {} }
    )
    return response.data
  },

  list: async (params?: { archived?: boolean; order_by?: string }) => {
    const response = await apiClient.get<NotebookResponse[]>('/notebooks', { params })
    return response.data
  },

  recentlyViewed: async (limit: number = 12) => {
    const response = await apiClient.get<RecentlyViewedResponse[]>('/recently-viewed', {
      params: { limit },
    })
    return response.data
  },

  get: async (id: string) => {
    const response = await apiClient.get<NotebookResponse>(`/notebooks/${id}`)
    return response.data
  },

  create: async (data: CreateNotebookRequest) => {
    const response = await apiClient.post<NotebookResponse>('/notebooks', data)
    return response.data
  },

  update: async (id: string, data: UpdateNotebookRequest) => {
    const response = await apiClient.put<NotebookResponse>(`/notebooks/${id}`, data)
    return response.data
  },

  deletePreview: async (id: string) => {
    const response = await apiClient.get<NotebookDeletePreview>(
      `/notebooks/${id}/delete-preview`
    )
    return response.data
  },

  delete: async (id: string, deleteExclusiveSources: boolean = false) => {
    const response = await apiClient.delete<NotebookDeleteResponse>(`/notebooks/${id}`, {
      params: { delete_exclusive_sources: deleteExclusiveSources },
    })
    return response.data
  },

  addSource: async (notebookId: string, sourceId: string) => {
    const response = await apiClient.post(`/notebooks/${notebookId}/sources/${sourceId}`)
    return response.data
  },

  removeSource: async (notebookId: string, sourceId: string) => {
    const response = await apiClient.delete(`/notebooks/${notebookId}/sources/${sourceId}`)
    return response.data
  },

  generateArtifact: async (
    notebookId: string,
    data: GenerateArtifactRequest
  ): Promise<ArtifactJob> => {
    return artifactsApi.generate(notebookId, data)
  },
}

// Folder-scoped chat-context preferences (chat_context_pref). A null folderId
// addresses the ungrouped bucket (the request omits folder_id).
export const contextPrefsApi = {
  get: async (notebookId: string, folderId: string | null) => {
    const response = await apiClient.get<{ prefs: Record<string, ContextMode> }>(
      `/notebooks/${notebookId}/context-preferences`,
      { params: folderId ? { folder_id: folderId } : undefined },
    )
    return response.data.prefs
  },

  save: async (
    notebookId: string,
    folderId: string | null,
    selections: ContextPrefEntry[],
  ) => {
    const response = await apiClient.put<{ saved: number }>(
      `/notebooks/${notebookId}/context-preferences`,
      { folder_id: folderId, selections },
    )
    return response.data
  },
}

import apiClient from './client'
import {
  ClassifyViewResponse,
  CopyToGroupResponse,
  GroupDeleteResponse,
  GroupMembersResponse,
  SourceGroupResponse,
  SourceViewResponse,
  ViewDeleteResponse,
  ViewUngroupResponse,
} from '@/lib/types/api'

export const sourceViewsApi = {
  listViews: async () => {
    const response = await apiClient.get<SourceViewResponse[]>('/views')
    return response.data
  },

  classifyView: async (viewId: string) => {
    const response = await apiClient.post<ClassifyViewResponse>(
      `/views/${viewId}/classify`
    )
    return response.data
  },

  createView: async (name: string) => {
    const response = await apiClient.post<SourceViewResponse>('/views', {
      name,
      view_type: 'custom',
    })
    return response.data
  },

  updateView: async (id: string, name: string) => {
    const response = await apiClient.patch<SourceViewResponse>(`/views/${id}`, { name })
    return response.data
  },

  deleteView: async (id: string) => {
    const response = await apiClient.delete<ViewDeleteResponse>(`/views/${id}`)
    return response.data
  },

  listGroups: async (viewId: string) => {
    const response = await apiClient.get<SourceGroupResponse[]>(`/views/${viewId}/groups`)
    return response.data
  },

  createGroup: async (viewId: string, name: string, parentId?: string | null) => {
    const response = await apiClient.post<SourceGroupResponse>(
      `/views/${viewId}/groups`,
      { name, parent_id: parentId ?? null }
    )
    return response.data
  },

  updateGroup: async (id: string, data: { name?: string; parent_id?: string | null }) => {
    const response = await apiClient.patch<SourceGroupResponse>(`/groups/${id}`, data)
    return response.data
  },

  deleteGroup: async (id: string, deleteSources: boolean) => {
    const response = await apiClient.delete<GroupDeleteResponse>(`/groups/${id}`, {
      params: { delete_sources: deleteSources },
    })
    return response.data
  },

  moveMembers: async (groupId: string, sourceIds: string[]) => {
    const response = await apiClient.post<GroupMembersResponse>(
      `/groups/${groupId}/members`,
      { source_ids: sourceIds }
    )
    return response.data
  },

  ungroupMembers: async (viewId: string, sourceIds: string[]) => {
    const response = await apiClient.post<ViewUngroupResponse>(
      `/views/${viewId}/ungroup`,
      { source_ids: sourceIds }
    )
    return response.data
  },

  copyMembers: async (groupId: string, sourceIds: string[]) => {
    const response = await apiClient.post<CopyToGroupResponse>(
      `/groups/${groupId}/copy`,
      { source_ids: sourceIds }
    )
    return response.data
  },
}

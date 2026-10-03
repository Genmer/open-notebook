import apiClient from './client'
import {
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '@/lib/types/agents'

export const agentsApi = {
  list: async (enabled?: boolean) => {
    const response = await apiClient.get<Agent[]>('/agents', {
      params: enabled === undefined ? {} : { enabled },
    })
    return response.data
  },

  get: async (id: string) => {
    const response = await apiClient.get<Agent>(`/agents/${id}`)
    return response.data
  },

  create: async (data: CreateAgentRequest) => {
    const response = await apiClient.post<Agent>('/agents', data)
    return response.data
  },

  update: async (id: string, data: UpdateAgentRequest) => {
    const response = await apiClient.put<Agent>(`/agents/${id}`, data)
    return response.data
  },

  delete: async (id: string) => {
    await apiClient.delete(`/agents/${id}`)
  },
}

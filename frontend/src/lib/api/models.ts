import apiClient from './client'
import {
  Model,
  CreateModelRequest,
  ModelDefaults,
  ModelPriceResult,
  ProviderAvailability,
  DiscoveredModel,
  ProviderSyncResult,
  AllProvidersSyncResult,
  ProviderModelCount,
  AutoAssignResult,
  ModelTestResult,
} from '@/lib/types/models'

export const modelsApi = {
  list: async () => {
    const response = await apiClient.get<Model[]>('/models')
    return response.data
  },

  get: async (id: string) => {
    const response = await apiClient.get<Model>(`/models/${id}`)
    return response.data
  },

  create: async (data: CreateModelRequest) => {
    const response = await apiClient.post<Model>('/models', data)
    return response.data
  },

  delete: async (id: string) => {
    await apiClient.delete(`/models/${id}`)
  },

  getDefaults: async () => {
    const response = await apiClient.get<ModelDefaults>('/models/defaults')
    return response.data
  },

  updateDefaults: async (data: Partial<ModelDefaults>) => {
    const response = await apiClient.put<ModelDefaults>('/models/defaults', data)
    return response.data
  },

  getProviders: async () => {
    const response = await apiClient.get<ProviderAvailability>('/models/providers')
    return response.data
  },

  // Model Discovery API
  /**
   * Discover available models from a provider without registering them
   */
  discoverModels: async (provider: string) => {
    const response = await apiClient.get<DiscoveredModel[]>(`/models/discover/${provider}`)
    return response.data
  },

  /**
   * Sync models for a specific provider (discover and register)
   */
  syncProvider: async (provider: string) => {
    const response = await apiClient.post<ProviderSyncResult>(`/models/sync/${provider}`)
    return response.data
  },

  /**
   * Sync models for all configured providers
   */
  syncAll: async () => {
    const response = await apiClient.post<AllProvidersSyncResult>('/models/sync')
    return response.data
  },

  /**
   * Get count of registered models for a provider
   */
  getProviderModelCount: async (provider: string) => {
    const response = await apiClient.get<ProviderModelCount>(`/models/count/${provider}`)
    return response.data
  },

  /**
   * Get all models for a specific provider
   */
  getByProvider: async (provider: string) => {
    const response = await apiClient.get<Model[]>(`/models/by-provider/${provider}`)
    return response.data
  },

  /**
   * Auto-assign default models based on available models
   */
  autoAssign: async () => {
    const response = await apiClient.post<AutoAssignResult>('/models/auto-assign')
    return response.data
  },

  /**
   * Test an individual model configuration
   */
  testModel: async (modelId: string): Promise<ModelTestResult> => {
    const response = await apiClient.post<ModelTestResult>(`/models/${modelId}/test`)
    return response.data
  },

  /**
   * Fetch the per-1M-token price (CNY) from the public LiteLLM price
   * database and store it on the model record.
   */
  refreshPrice: async (modelId: string): Promise<ModelPriceResult> => {
    const response = await apiClient.post<ModelPriceResult>(`/models/${modelId}/price/refresh`)
    return response.data
  },

  /**
   * Store a manually entered per-1M-token price (CNY) on the model record.
   */
  savePrice: async (
    modelId: string,
    data: { price_input_per_m: number; price_output_per_m: number }
  ): Promise<ModelPriceResult> => {
    const response = await apiClient.put<ModelPriceResult>(`/models/${modelId}/price`, data)
    return response.data
  },
}
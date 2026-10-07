import apiClient from './client'
import {
  CreateProjectEnvRequest,
  GenericParagraphResponse,
  MaterialsSubmitRequest,
  MockGenerateRequest,
  MockGenerateResponse,
  PolishBackgroundRequest,
  PolishBackgroundResponse,
  ProjectEnv,
  ProjectEnvDeleteResponse,
  ProjectEnvMaterialsStatus,
  ProjectEnvVerificationStatus,
  ReverifyResponse,
  RewriteClaimRequest,
  RewriteClaimResponse,
  SuggestClaimRewriteResponse,
  UpdateProjectEnvRequest,
} from '@/lib/types/api'

export type ProjectEnvView = 'manage' | 'selectable'

export const projectEnvsApi = {
  list: async (view: ProjectEnvView = 'manage'): Promise<ProjectEnv[]> => {
    const response = await apiClient.get<ProjectEnv[]>('/project-envs', {
      params: { view },
    })
    return response.data
  },

  get: async (id: string): Promise<ProjectEnv> => {
    const response = await apiClient.get<ProjectEnv>(`/project-envs/${id}`)
    return response.data
  },

  create: async (data: CreateProjectEnvRequest): Promise<ProjectEnv> => {
    const response = await apiClient.post<ProjectEnv>('/project-envs', data)
    return response.data
  },

  update: async (id: string, data: UpdateProjectEnvRequest): Promise<ProjectEnv> => {
    const response = await apiClient.put<ProjectEnv>(`/project-envs/${id}`, data)
    return response.data
  },

  remove: async (id: string): Promise<ProjectEnvDeleteResponse> => {
    const response = await apiClient.delete<ProjectEnvDeleteResponse>(
      `/project-envs/${id}`
    )
    return response.data
  },

  mockGenerate: async (data: MockGenerateRequest): Promise<MockGenerateResponse> => {
    const response = await apiClient.post<MockGenerateResponse>(
      '/project-envs/mock-generate',
      data
    )
    return response.data
  },

  polishBackground: async (
    data: PolishBackgroundRequest
  ): Promise<PolishBackgroundResponse> => {
    const response = await apiClient.post<PolishBackgroundResponse>(
      '/project-envs/polish-background',
      data
    )
    return response.data
  },

  getVerification: async (id: string): Promise<ProjectEnvVerificationStatus> => {
    const response = await apiClient.get<ProjectEnvVerificationStatus>(
      `/project-envs/${id}/verification`
    )
    return response.data
  },

  reverify: async (id: string): Promise<ReverifyResponse> => {
    const response = await apiClient.post<ReverifyResponse>(
      `/project-envs/${id}/reverify`
    )
    return response.data
  },

  regenerate: async (id: string): Promise<ReverifyResponse> => {
    const response = await apiClient.post<ReverifyResponse>(
      `/project-envs/${id}/regenerate`
    )
    return response.data
  },

  getMaterials: async (id: string): Promise<ProjectEnvMaterialsStatus> => {
    const response = await apiClient.get<ProjectEnvMaterialsStatus>(
      `/project-envs/${id}/materials`
    )
    return response.data
  },

  generateMaterials: async (id: string): Promise<ReverifyResponse> => {
    const response = await apiClient.post<ReverifyResponse>(
      `/project-envs/${id}/materials/generate`
    )
    return response.data
  },

  submitMaterials: async (
    id: string,
    data: MaterialsSubmitRequest
  ): Promise<ReverifyResponse> => {
    const response = await apiClient.post<ReverifyResponse>(
      `/project-envs/${id}/materials/submit`,
      data
    )
    return response.data
  },

  dismissClaim: async (
    envId: string,
    pointId: string
  ): Promise<ProjectEnv> => {
    const response = await apiClient.post<ProjectEnv>(
      `/project-envs/${envId}/claims/${pointId}/dismiss`
    )
    return response.data
  },

  rewriteClaim: async (
    envId: string,
    pointId: string,
    data: RewriteClaimRequest
  ): Promise<RewriteClaimResponse> => {
    const response = await apiClient.post<RewriteClaimResponse>(
      `/project-envs/${envId}/claims/${pointId}/rewrite`,
      data
    )
    return response.data
  },

  suggestClaimRewrite: async (
    envId: string,
    pointId: string
  ): Promise<SuggestClaimRewriteResponse> => {
    const response = await apiClient.post<SuggestClaimRewriteResponse>(
      `/project-envs/${envId}/claims/${pointId}/suggest`
    )
    return response.data
  },

  generateGenericParagraph: async (
    envId: string
  ): Promise<GenericParagraphResponse> => {
    const response = await apiClient.post<GenericParagraphResponse>(
      `/project-envs/${envId}/generic-paragraph/generate`
    )
    return response.data
  },
}

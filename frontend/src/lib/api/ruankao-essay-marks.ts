import apiClient from './client'
import {
  DanglingCleanupResponse,
  EssayMarksLibraryResponse,
  EssayMarkToggleRequest,
  EssayMarkToggleResponse,
} from '@/lib/types/api'

// 软考范文库标记 API client（marks 存 id 引用，生效集合运行时计算，全在服务端）
export const essayMarksApi = {
  library: async (viewId: string): Promise<EssayMarksLibraryResponse> => {
    const response = await apiClient.get<EssayMarksLibraryResponse>(
      '/ruankao/essay-marks/library',
      { params: { view_id: viewId } }
    )
    return response.data
  },

  toggle: async (data: EssayMarkToggleRequest): Promise<EssayMarkToggleResponse> => {
    const response = await apiClient.post<EssayMarkToggleResponse>(
      '/ruankao/essay-marks/toggle',
      data
    )
    return response.data
  },

  // dangling=true 是端点唯一支持的模式（不带参数 400，防止误清全部标记）
  cleanupDangling: async (): Promise<DanglingCleanupResponse> => {
    const response = await apiClient.delete<DanglingCleanupResponse>(
      '/ruankao/essay-marks',
      { params: { dangling: true } }
    )
    return response.data
  },
}

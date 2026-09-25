import apiClient from './client'
import {
  UsageClearResponse,
  UsageRecordsResponse,
  UsageSummaryResponse,
} from '@/lib/types/api'

export const usageApi = {
  summary: async (
    days = 30,
    callType?: string,
    tzOffset?: number
  ): Promise<UsageSummaryResponse> => {
    const response = await apiClient.get<UsageSummaryResponse>('/usage/summary', {
      params: {
        days,
        ...(callType ? { call_type: callType } : {}),
        ...(tzOffset !== undefined ? { tz_offset: tzOffset } : {}),
      },
    })
    return response.data
  },

  records: async (limit = 100, offset = 0, callType?: string): Promise<UsageRecordsResponse> => {
    const response = await apiClient.get<UsageRecordsResponse>('/usage/records', {
      params: { limit, offset, ...(callType ? { call_type: callType } : {}) },
    })
    return response.data
  },

  clear: async (): Promise<UsageClearResponse> => {
    const response = await apiClient.delete<UsageClearResponse>('/usage/records')
    return response.data
  },
}

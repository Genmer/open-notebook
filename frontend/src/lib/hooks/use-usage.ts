import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usageApi } from '@/lib/api/usage'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

// tzOffset is the browser's minute offset from UTC; the backend buckets
// by_day on it. It is stable per device, so it stays out of the query key.
export function useUsageSummary(days = 30, callType?: string, tzOffset?: number) {
  return useQuery({
    queryKey: QUERY_KEYS.usageSummary(days, callType),
    queryFn: () => usageApi.summary(days, callType, tzOffset),
    placeholderData: keepPreviousData,
  })
}

export function useUsageRecords(limit = 100, offset = 0, callType?: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.usageRecords, limit, offset, callType ?? null],
    queryFn: () => usageApi.records(limit, offset, callType),
    placeholderData: keepPreviousData,
  })
}

export function useClearUsage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: () => usageApi.clear(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['usage'] })
      toast({
        title: t('common.success'),
        description: t('usage.clearedDesc', { count: result.deleted }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key), t('usage.clearFailed')),
        variant: 'destructive',
      })
    },
  })
}

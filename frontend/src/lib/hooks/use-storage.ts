import { useQuery } from '@tanstack/react-query'
import { storageApi } from '@/lib/api/storage'
import { QUERY_KEYS } from '@/lib/api/query-client'

// Storage numbers change slowly; a short manual refresh button beats polling.
export function useStorageSummary() {
  return useQuery({
    queryKey: QUERY_KEYS.storageSummary,
    queryFn: storageApi.summary,
    staleTime: 60 * 1000,
  })
}

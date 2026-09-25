import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import {
  dataTransferApi,
  type ExportStatusResponse,
  type ImportStatusResponse,
} from '@/lib/api/dataTransfer'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { formatApiError, getApiErrorMessage } from '@/lib/utils/error-handler'

const ACTIVE_POLL_MS = 5000
const IDLE_POLL_MS = 60000

// queued/running → poll fast; terminal states stop polling; none → slow watch
const pollInterval = (status?: string): number | false => {
  if (status === 'queued' || status === 'running') return ACTIVE_POLL_MS
  if (status === 'completed' || status === 'failed') return false
  return IDLE_POLL_MS
}

// The backend rejects concurrent same-kind jobs with an English detail
// ("A data export/import job is already queued or running").
const isConcurrentError = (error: unknown) =>
  formatApiError(error).includes('already queued or running')

const isTooLargeError = (error: unknown) =>
  isAxiosError(error) && error.response?.status === 413

export function useExportStatus() {
  return useQuery({
    queryKey: QUERY_KEYS.dataTransferExport,
    queryFn: dataTransferApi.getExportStatus,
    refetchInterval: (query) => {
      const data = query.state.data as ExportStatusResponse | undefined
      return pollInterval(data?.status)
    },
  })
}

export function useImportStatus() {
  return useQuery({
    queryKey: QUERY_KEYS.dataTransferImport,
    queryFn: dataTransferApi.getImportStatus,
    refetchInterval: (query) => {
      const data = query.state.data as ImportStatusResponse | undefined
      return pollInterval(data?.status)
    },
  })
}

export function useStartExport() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: () => dataTransferApi.startExport(),
    onSuccess: () => {
      toast({
        title: t('common.success'),
        description: t('dataManagement.export.startedToast'),
      })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dataTransferExport })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: isConcurrentError(error)
          ? t('dataManagement.errors.concurrent')
          : getApiErrorMessage(error, (key) => t(key), 'dataManagement.errors.failed'),
        variant: 'destructive',
      })
    },
  })
}

export function useUploadImportPackage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (file: File) => dataTransferApi.uploadImport(file),
    onSuccess: () => {
      toast({
        title: t('common.success'),
        description: t('dataManagement.import.startedToast'),
      })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dataTransferImport })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: isTooLargeError(error)
          ? t('dataManagement.errors.uploadTooLarge')
          : isConcurrentError(error)
            ? t('dataManagement.errors.concurrent')
            : getApiErrorMessage(error, (key) => t(key), 'dataManagement.errors.failed'),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteExportPackage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: () => dataTransferApi.deleteExportPackage(),
    onSuccess: (result) => {
      if (result.deleted) {
        toast({
          title: t('common.success'),
          description: t('dataManagement.export.deletedToast'),
        })
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dataTransferExport })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key), 'dataManagement.errors.failed'),
        variant: 'destructive',
      })
    },
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { isAxiosError } from 'axios'
import {
  CHUNKED_UPLOAD_THRESHOLD,
  dataTransferApi,
  type ChunkedUploadProgress,
  type ExportScope,
  type ExportStartInput,
  type ExportStatusResponse,
  type ImportExecuteInput,
  type ImportStatusResponse,
} from '@/lib/api/dataTransfer'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { formatApiError, getApiErrorMessage } from '@/lib/utils/error-handler'

const ACTIVE_POLL_MS = 5000
const IDLE_POLL_MS = 60000

// queued/running → poll fast; terminal states keep a slow safety poll: the
// invalidation refetch right after a start can dedup with an in-flight request
// from the previous idle interval and inherit its stale terminal result, which
// would otherwise stop polling forever on the OLD finished package.
const pollInterval = (status?: string): number | false => {
  if (status === 'queued' || status === 'running') return ACTIVE_POLL_MS
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

export function useExportEstimate(enabled: boolean, scope: ExportScope, notebookIds: string[]) {
  return useQuery({
    // Selection is part of the key so changing the dialog's scope/notebooks
    // refetches the preview instead of serving a stale one.
    queryKey: [...QUERY_KEYS.dataTransferExportEstimate, scope, [...notebookIds].sort()],
    queryFn: () =>
      dataTransferApi.estimateExport({
        scope,
        notebook_ids: scope === 'notebooks' ? notebookIds : [],
      }),
    enabled: enabled && scope !== 'models',
    staleTime: 30_000,
  })
}

export function useStartExport() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (input: ExportStartInput) => dataTransferApi.startExport(input),
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

export function useExecuteImport() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (input: ImportExecuteInput) => dataTransferApi.executeImport(input),
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
  // Byte-level progress for the chunked path only (the single-request path
  // has no streaming progress with axios).
  const [uploadProgress, setUploadProgress] = useState<ChunkedUploadProgress | null>(
    null
  )

  const mutation = useMutation({
    mutationFn: (file: File) =>
      file.size > CHUNKED_UPLOAD_THRESHOLD
        ? dataTransferApi.uploadImportChunked(file, setUploadProgress)
        : dataTransferApi.uploadImport(file),
    onSettled: () => setUploadProgress(null),
    onSuccess: () => {
      // No success toast: the scan result drives the next UI step (conflict
      // dialog or automatic execute).
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

  return { ...mutation, uploadProgress }
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

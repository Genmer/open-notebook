'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { artifactsApi, type GenerateArtifactRequest } from '@/lib/api/artifacts'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60 * 1000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Generate a study artifact and wait for the command job to finish. The
 * generated artifact lands as a note, so the notes query is invalidated on
 * success (it is then embedded and exported like any other note).
 */
export function useGenerateArtifact(notebookId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async (request: GenerateArtifactRequest) => {
      const job = await artifactsApi.generate(notebookId, request)
      const deadline = Date.now() + POLL_TIMEOUT_MS
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS)
        const status = await artifactsApi.getJobStatus(job.job_id)
        if (status.status === 'completed') return status
        // 'canceled' is a terminal state in surreal_commands; 'unknown' means
        // the job record is gone — both must stop the poll instead of timing out.
        if (
          status.status === 'failed' ||
          status.status === 'canceled' ||
          status.status === 'unknown'
        ) {
          throw new Error(status.error_message || t('artifacts.failed'))
        }
      }
      throw new Error(t('artifacts.timeout'))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
      toast.success(t('artifacts.success'))
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string }
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'artifacts.failed'))
    },
  })
}

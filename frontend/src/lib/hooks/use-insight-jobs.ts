import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { insightsApi } from '@/lib/api/insights'
import { useTranslation } from '@/lib/hooks/use-translation'
import { isActiveInsightJobStatus } from '@/lib/hooks/use-sources'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { toast } from 'sonner'

// Poll cadence for an in-flight insight command.
const ACTIVE_POLL_MS = 2000
// run_transformation completes before the insight row exists (two-phase
// write): after 'completed', re-fetch insights a few times until the count
// grows so the fresh insight appears without a manual refresh.
const COMPLETION_CATCHUP_ATTEMPTS = 5
const COMPLETION_CATCHUP_MS = 2000

export interface ActiveInsightJob {
  commandId: string
  /** Transformation display name, when known (null for recovered jobs). */
  title: string | null
  /** Client-side clock start (null for jobs recovered after a reload). */
  startedAt: number | null
}

interface UseInsightJobWatcherOptions {
  /** Re-fetch the insights list (also refreshes the count ref on the caller side). */
  refetchInsights: () => Promise<void>
  /** Current insight count, read after each refetch to detect the new row. */
  getInsightCount: () => number
  /** Called once after the job reaches a terminal state (invalidate sources etc.). */
  onSettled: () => void
}

/**
 * Watches one insight-generation command at a time with react-query polling:
 * 2s while new/queued/running, an error toast on failed/canceled/unknown, and
 * a short insights catch-up after completion (absorbs the two-phase write).
 * Submission calls `watchJob`; recovery after a page reload calls it via the
 * status endpoint's insight_jobs through `adoptActiveJobs`.
 */
export function useInsightJobWatcher({
  refetchInsights,
  getInsightCount,
  onSettled,
}: UseInsightJobWatcherOptions) {
  const { t } = useTranslation()
  const [activeJob, setActiveJob] = useState<ActiveInsightJob | null>(null)
  // Terminal jobs we already handled, so a recovered/poll overlap never
  // re-adopts or double-toasts them.
  const handledRef = useRef<Set<string>>(new Set())
  const catchingUpRef = useRef(false)

  const watchJob = useCallback((job: ActiveInsightJob) => {
    handledRef.current.add(job.commandId)
    setActiveJob(job)
  }, [])

  // Recovery: pick up an in-flight job reported by GET /sources/{id}/status.
  const adoptActiveJobs = useCallback(
    (jobs: Array<{ command_id: string; transformation_title?: string | null }> | null | undefined) => {
      if (!activeJob) {
        const active = jobs?.find((job) => !handledRef.current.has(job.command_id))
        if (active) {
          handledRef.current.add(active.command_id)
          setActiveJob({
            commandId: active.command_id,
            title: active.transformation_title ?? null,
            startedAt: null,
          })
        }
      }
    },
    [activeJob]
  )

  const { data: jobStatus } = useQuery({
    queryKey: ['insight-jobs', activeJob?.commandId],
    queryFn: () => insightsApi.getCommandStatus(activeJob!.commandId),
    enabled: !!activeJob,
    refetchInterval: (query) => {
      const data = query.state.data as { status?: string } | undefined
      return data && isActiveInsightJobStatus(data.status) ? ACTIVE_POLL_MS : false
    },
    staleTime: 0,
  })

  const finishJob = useCallback(
    (refresh: boolean) => {
      const job = activeJob
      setActiveJob(null)
      if (!refresh || !job) {
        onSettled()
        return
      }
      // Catch-up: the command is done but the insight row may not exist yet.
      if (catchingUpRef.current) return
      catchingUpRef.current = true
      const baseline = getInsightCount()
      let attempt = 0
      const poll = async () => {
        attempt += 1
        await refetchInsights()
        if (getInsightCount() > baseline || attempt >= COMPLETION_CATCHUP_ATTEMPTS) {
          catchingUpRef.current = false
          onSettled()
          return
        }
        setTimeout(poll, COMPLETION_CATCHUP_MS)
      }
      setTimeout(poll, COMPLETION_CATCHUP_MS)
    },
    [activeJob, getInsightCount, onSettled, refetchInsights]
  )

  useEffect(() => {
    if (!activeJob || !jobStatus) return
    const status = jobStatus.status
    if (isActiveInsightJobStatus(status)) return
    if (status === 'completed') {
      finishJob(true)
      return
    }
    // failed / canceled / unknown
    const detail = jobStatus.error_message?.trim()
    toast.error(t('sources.insightGenerationFailed'), {
      description: detail
        ? getApiErrorMessage(detail, (key) => t(key))
        : undefined,
    })
    finishJob(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, jobStatus])

  return { activeJob, watchJob, adoptActiveJobs }
}

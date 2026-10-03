'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  sourceAnalysisApi,
  TERMINAL_JOB_STATUSES,
  type SectionAnalysisJobResult,
} from '@/lib/api/source-analysis'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorKey } from '@/lib/utils/error-handler'

interface SubmitSectionArgs {
  /** Outline entry key the job belongs to (echoed back on completion). */
  key: string
  sourceId: string
  sectionTitle: string
  sectionText: string
  pageStart?: number | null
  pageEnd?: number | null
}

export interface ActiveSectionAnalysisJob {
  jobId: string
  key: string
}

interface UseSectionAnalysisOptions {
  /** Result of a completed job, keyed by the submitting entry. */
  onCompleted: (key: string, result: SectionAnalysisJobResult) => void
  /** Terminal failure/cancel of a submitted job. */
  onFailed: (key: string, detail?: string | null) => void
}

/** Poll cadence while a section-analysis job is in flight. */
const JOB_POLL_MS = 2000

/**
 * One section AI analysis per click, now as a background command job:
 * submit returns a job id; polling here resolves the terminal state and
 * hands the result back keyed by outline entry. `activeJob` also powers the
 * live progress inspector rendered next to the entry being analyzed.
 */
export function useSectionAnalysis({ onCompleted, onFailed }: UseSectionAnalysisOptions) {
  const { toast } = useToast()
  const { t, language } = useTranslation()
  const [activeJob, setActiveJob] = useState<ActiveSectionAnalysisJob | null>(null)
  // Terminal jobs we already handled so a late poll never double-fires.
  const handledRef = useRef<Set<string>>(new Set())

  const { data: jobStatus } = useQuery({
    queryKey: ['section-analysis-job', activeJob?.jobId],
    queryFn: () => sourceAnalysisApi.getJobStatus(activeJob!.jobId),
    enabled: !!activeJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && TERMINAL_JOB_STATUSES.includes(status) ? false : JOB_POLL_MS
    },
    staleTime: 0,
  })

  useEffect(() => {
    if (!activeJob || !jobStatus) return
    const status = jobStatus.status
    if (!TERMINAL_JOB_STATUSES.includes(status)) return
    if (handledRef.current.has(activeJob.jobId)) return
    handledRef.current.add(activeJob.jobId)

    if (status === 'completed') {
      const result = jobStatus.result as SectionAnalysisJobResult | undefined
      if (result && typeof result.analysis_markdown === 'string') {
        onCompleted(activeJob.key, result)
      } else {
        onFailed(activeJob.key)
      }
    } else {
      onFailed(activeJob.key, jobStatus.error_message)
      toast({
        title: t('common.error'),
        description:
          jobStatus.error_message?.trim() || t('sources.fileView.analysisFailed'),
        variant: 'destructive',
      })
    }
    setActiveJob(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, jobStatus])

  const submit = useCallback(
    async ({
      key,
      sourceId,
      sectionTitle,
      sectionText,
      pageStart,
      pageEnd,
    }: SubmitSectionArgs) => {
      try {
        const { job_id: jobId } = await sourceAnalysisApi.analyzeSection(sourceId, {
          section_title: sectionTitle,
          section_text: sectionText,
          page_start: pageStart ?? null,
          page_end: pageEnd ?? null,
          locale: language,
        })
        setActiveJob({ jobId, key })
      } catch (error) {
        toast({
          title: t('common.error'),
          description: getApiErrorKey(error, t('sources.fileView.analysisFailed')),
          variant: 'destructive',
        })
        onFailed(key)
      }
    },
    [language, onFailed, t, toast]
  )

  return { submit, activeJob, isAnalyzing: activeJob != null }
}

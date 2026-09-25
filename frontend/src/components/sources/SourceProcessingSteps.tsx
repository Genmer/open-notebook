'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  Loader2,
  Minus,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { embeddingApi } from '@/lib/api/embedding'
import {
  SourceProcessingStep,
  SourceProcessingStepKey,
  SourceProcessingStepStatus,
} from '@/lib/types/api'
import { useRetrySource } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toast } from 'sonner'

interface SourceProcessingStepsProps {
  sourceId: string
  steps: SourceProcessingStep[] | null | undefined
}

const STEP_TITLE_KEYS: Record<SourceProcessingStepKey, string> = {
  extraction: 'sources.processingStepExtraction',
  embedding: 'sources.processingStepEmbedding',
  transformation: 'sources.processingStepTransformation',
  completion: 'sources.processingStepCompletion',
}

const STATUS_KEYS: Record<SourceProcessingStepStatus, string> = {
  pending: 'sources.processingStatusPending',
  in_progress: 'sources.processingStatusInProgress',
  done: 'sources.processingStatusDone',
  failed: 'sources.processingStatusFailed',
  skipped: 'sources.processingStatusSkipped',
  unknown: 'sources.processingStatusUnknown',
}

const STEP_ICONS: Record<
  SourceProcessingStepStatus,
  { Icon: typeof CircleDashed; className: string; spin?: boolean }
> = {
  pending: { Icon: CircleDashed, className: 'text-muted-foreground' },
  in_progress: { Icon: Loader2, className: 'text-teal', spin: true },
  done: { Icon: CheckCircle2, className: 'text-fern' },
  failed: { Icon: XCircle, className: 'text-destructive' },
  skipped: { Icon: Minus, className: 'text-muted-foreground' },
  unknown: { Icon: HelpCircle, className: 'text-muted-foreground' },
}

export function SourceProcessingSteps({ sourceId, steps }: SourceProcessingStepsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const retrySource = useRetrySource()
  const [embeddingRetrying, setEmbeddingRetrying] = useState(false)

  if (!steps || steps.length === 0) return null
  // All-settled pipeline disappears; failed/unknown rows stay until a retry succeeds.
  if (steps.every(step => step.status === 'done' || step.status === 'skipped')) return null

  const busy = retrySource.isPending || embeddingRetrying

  const handleEmbedRetry = async () => {
    try {
      setEmbeddingRetrying(true)
      const response = await embeddingApi.embedContent(sourceId, 'source')
      toast.success(response.message || t('common.success'))
      queryClient.invalidateQueries({ queryKey: ['sources', sourceId, 'status'] })
    } catch (err) {
      console.error('Failed to embed content:', err)
      toast.error(t('common.error'))
    } finally {
      setEmbeddingRetrying(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 mb-4">
      <h3 className="text-sm font-medium">{t('sources.processingTitle')}</h3>
      <div className="mt-3 space-y-2.5">
        {steps.map(step => {
          const { Icon, className, spin } = STEP_ICONS[step.status] ?? STEP_ICONS.unknown
          const isEmbeddingStep = step.key === 'embedding'
          // failed keeps its residual x/N (transformation); embedding failure
          // stays numberless because the backend leaves current empty there
          const showProgress =
            (step.status === 'in_progress' || step.status === 'failed') &&
            typeof step.current === 'number'
          return (
            <div key={step.key} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${className} ${spin ? 'animate-spin' : ''}`}
                />
                <div className="min-w-0">
                  <p className="text-sm">{t(STEP_TITLE_KEYS[step.key])}</p>
                  {step.status === 'failed' && step.error && (
                    <p className="text-xs text-destructive break-words">{step.error}</p>
                  )}
                  {step.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5"
                      disabled={busy}
                      onClick={() =>
                        isEmbeddingStep ? handleEmbedRetry() : retrySource.mutate(sourceId)
                      }
                    >
                      {(isEmbeddingStep && embeddingRetrying) ||
                      (!isEmbeddingStep && retrySource.isPending) ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('sources.processingStatusInProgress')}
                        </>
                      ) : (
                        <>
                          <XCircle className="mr-2 h-4 w-4" />
                          {isEmbeddingStep
                            ? t('sources.embeddingRetry')
                            : t('sources.retryProcessing')}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {showProgress && (
                  <span className="text-xs text-muted-foreground">
                    {step.current}/{typeof step.total === 'number' ? step.total : '—'}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {t(STATUS_KEYS[step.status])}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

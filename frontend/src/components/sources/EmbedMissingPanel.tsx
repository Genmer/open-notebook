'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { embeddingApi, type EmbeddingStatusSummary } from '@/lib/api/embedding'
import { QUERY_KEYS, queryClient } from '@/lib/api/query-client'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorKey } from '@/lib/utils/error-handler'
import { cn } from '@/lib/utils'

const ACTIVE_POLL_MS = 5000
const IDLE_POLL_MS = 60000

const isBusy = (s?: EmbeddingStatusSummary) => !!s && s.queued + s.running > 0

export function EmbedMissingPanel() {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // Status snapshot when the rebuild was confirmed - failure detection baseline
  const [baseline, setBaseline] = useState<EmbeddingStatusSummary | null>(null)

  const status = useQuery({
    queryKey: QUERY_KEYS.embeddingStatus,
    queryFn: embeddingApi.getStatus,
    refetchInterval: (query) => {
      const data = query.state.data as EmbeddingStatusSummary | undefined
      return isBusy(data) ? ACTIVE_POLL_MS : IDLE_POLL_MS
    },
  })

  const rebuild = useMutation({
    mutationFn: () => embeddingApi.rebuildEmbeddings({ mode: 'missing' }),
    onSuccess: () => {
      setSubmitted(true)
      setDismissed(false)
      setBaseline(status.data ?? null)
      toast.success(t('sources.embedMissing.startedToast'))
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.embeddingStatus })
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { detail?: string } }, message?: string }
      toast.error(t(getApiErrorKey(err.response?.data?.detail || err.message)))
    },
  })

  const data = status.data
  const pending = data?.pending ?? 0
  const showProgress =
    !!data && ((submitted && !dismissed) || isBusy(data))
  const converged = !!data && pending === 0 && !isBusy(data)
  // New failures with zero completions: the embedding model is likely unconfigured
  const failingFromStart =
    !!data && !!baseline && data.failed > baseline.failed && data.completed === 0
  const processed = data ? data.completed + data.failed : 0
  const progressPct = data && data.total_sources > 0 ? (processed / data.total_sources) * 100 : 0

  const badges = data
    ? [
        {
          count: data.not_embedded,
          label: t('sources.embedMissing.badge.notEmbedded'),
          className: 'bg-muted text-muted-foreground',
        },
        {
          count: data.queued,
          label: t('sources.embedMissing.badge.queued'),
          className: 'bg-popover text-muted-foreground',
        },
        {
          count: data.running,
          label: t('sources.embedMissing.badge.running'),
          className: 'bg-type-web-soft text-foreground',
        },
        {
          count: data.completed,
          label: t('sources.embedMissing.badge.completed'),
          className: 'bg-fern-tint text-fern-deep dark:text-fern',
        },
        {
          count: data.failed,
          label: t('sources.embedMissing.badge.failed'),
          className: 'bg-destructive-tint text-destructive',
        },
      ]
    : []

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending === 0 || rebuild.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {rebuild.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t('sources.embedMissing.button')}
          {pending > 0 && (
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {pending}
            </span>
          )}
        </Button>
      </div>

      {showProgress && data && (
        <div className="w-full max-w-md rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              {t('sources.embedMissing.progressTitle')}
              {isBusy(data) && (
                <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </span>
            {converged && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setDismissed(true)}
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {failingFromStart && (
            <p className="mb-2 text-xs text-destructive">
              {t('sources.embedMissing.errorHint')}
            </p>
          )}

          <Progress value={progressPct} className="mb-3 h-1.5" />

          <div className="flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <Badge key={badge.label} variant="secondary" className={cn('gap-1', badge.className)}>
                {badge.count}
                {' '}
                {badge.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('sources.embedMissing.confirmTitle')}
        description={t('sources.embedMissing.confirmDescription', { count: pending })}
        confirmText={t('sources.embedMissing.confirmCta')}
        onConfirm={() => {
          setConfirmOpen(false)
          rebuild.mutate()
        }}
        isLoading={rebuild.isPending}
      />
    </div>
  )
}

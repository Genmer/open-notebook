'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, Loader2, X, AlertTriangle, ShieldCheck } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useDismissClaim,
  useProjectEnvVerification,
  useRewriteClaim,
} from '@/lib/hooks/use-project-envs'
import { tasksApi } from '@/lib/api/tasks'
import type {
  ProjectEnvClaimPoint,
  ProjectEnvClaimRound,
  ProjectEnvLane,
  ProjectEnvLanes,
} from '@/lib/types/api'

const LANES: ProjectEnvLane[] = ['A', 'B', 'C']

// Static literals so the locale unused-key scanner sees the references.
const LANE_LABEL_KEYS: Record<ProjectEnvLane, string> = {
  A: 'projectEnvs.laneA',
  B: 'projectEnvs.laneB',
  C: 'projectEnvs.laneC',
}

function fieldLabel(field: string, t: (k: string) => string): string {
  switch (field) {
    case 'background': return t('projectEnvs.fieldBackground')
    case 'tech_background': return t('projectEnvs.fieldTechBackground')
    case 'tuning_process': return t('projectEnvs.fieldTuning')
    case 'problems_solutions': return t('projectEnvs.fieldProblems')
    case 'my_role': return t('projectEnvs.fieldMyRole')
    case 'scale': return t('projectEnvs.fieldScale')
    default: return t('projectEnvs.fieldOther')
  }
}

function reasonLabel(reason: string | undefined, t: (k: string) => string): string | null {
  switch (reason) {
    case 'off_table': return t('projectEnvs.reasonOffTable')
    case 'exhausted': return t('projectEnvs.reasonExhausted')
    case 'cost_cap': return t('projectEnvs.reasonCostCap')
    case 'uncovered': return t('projectEnvs.reasonUncovered')
    case 'lanes_failed': return t('projectEnvs.reasonLanesFailed')
    default: return null
  }
}

function stageLabel(stage: string | undefined, t: (k: string) => string): string {
  switch (stage) {
    case 'preparing': return t('projectEnvs.stagePreparing')
    case 'verifying': return t('projectEnvs.stageVerifying')
    case 'converging': return t('projectEnvs.stageConverging')
    default: return t('projectEnvs.stageVerifying')
  }
}

function LaneBadge({ lane, result }: { lane: ProjectEnvLane; result?: ProjectEnvLanes[ProjectEnvLane] }) {
  const { t } = useTranslation()
  const name = t(LANE_LABEL_KEYS[lane])
  const verdict = result?.verdict
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 text-[10px]',
        verdict === 'pass' && 'border-fern/50 text-fern',
        verdict === 'fail' && 'border-destructive/50 text-destructive',
        (verdict === 'error' || verdict === 'off_table') && 'border-warn/60 text-warn',
        !verdict && 'text-muted-foreground'
      )}
      title={result?.issues?.join('\n')}
    >
      {verdict === 'pass' && <Check className="h-3 w-3" />}
      {verdict === 'fail' && <X className="h-3 w-3" />}
      {verdict === 'error' && <AlertTriangle className="h-3 w-3" />}
      {name}
    </Badge>
  )
}

function RoundsHistory({ rounds }: { rounds: ProjectEnvClaimRound[] }) {
  const { t } = useTranslation()
  if (!rounds.length) return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown className="h-3 w-3" />
        {t('projectEnvs.roundsHistory', { count: rounds.length })}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-1.5 space-y-1 border-l pl-3">
          {rounds.map((round) => (
            <li key={round.round} className="text-xs text-muted-foreground">
              <span className="font-mono">#{round.round}</span>{' '}
              {round.action} · {round.verdict}
              {round.corrected_text && (
                <p className="mt-0.5 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1">
                  {round.corrected_text}
                </p>
              )}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function PointCard({
  envId,
  point,
  pending,
}: {
  envId: string
  point: ProjectEnvClaimPoint
  pending: boolean
}) {
  const { t } = useTranslation()
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteText, setRewriteText] = useState('')
  const [confirmDismiss, setConfirmDismiss] = useState(false)
  const dismissMutation = useDismissClaim()
  const rewriteMutation = useRewriteClaim()

  const state = point.state
  const isManual = state === 'manual_review'
  const correctionRound =
    pending && (point.rounds?.length ?? 0) > 0 ? point.rounds!.length : null

  const stateBadge = (() => {
    if (state === 'passed')
      return <Badge className="gap-1 bg-fern-tint text-fern border-fern/40 hover:bg-fern-tint">{t('projectEnvs.statePassed')}</Badge>
    if (state === 'manual_review')
      return <Badge className="gap-1 bg-warn-tint text-warn border-warn/40 hover:bg-warn-tint">{t('projectEnvs.stateManual')}</Badge>
    if (state === 'dismissed')
      return <Badge variant="outline" className="text-muted-foreground">{t('projectEnvs.stateDismissed')}</Badge>
    if (state === 'rewritten')
      return <Badge variant="outline" className="border-fern/40 text-fern">{t('projectEnvs.stateRewritten')}</Badge>
    if (state === 'exempt')
      return <Badge variant="outline" className="text-muted-foreground">{t('projectEnvs.stateExempt')}</Badge>
    if (state === 'error')
      return <Badge variant="destructive">{t('projectEnvs.stateError')}</Badge>
    if (correctionRound !== null)
      return <Badge variant="outline" className="border-gold/50 text-gold">{t('projectEnvs.stateCorrecting', { round: correctionRound })}</Badge>
    return (
      <Badge variant="outline" className="gap-1 border-teal/50 text-teal">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('projectEnvs.statePending')}
      </Badge>
    )
  })()

  const rewriteResult = rewriteMutation.data

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 space-y-2',
        isManual && 'border-warn/50'
      )}
      data-testid={`claim-point-${point.point_id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm break-all">{point.quote}</p>
        {stateBadge}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="secondary" className="text-[10px] font-normal">
          {fieldLabel(point.field, t)}
        </Badge>
        {LANES.map((lane) => (
          <LaneBadge key={lane} lane={lane} result={point.lanes?.[lane]} />
        ))}
        {state === 'manual_review' && point.manual_reason === 'uncovered' && (
          <span>({t('projectEnvs.stateUncovered')})</span>
        )}
        {isManual && reasonLabel(point.manual_reason, t) && (
          <span className="text-warn">{reasonLabel(point.manual_reason, t)}</span>
        )}
      </div>
      <RoundsHistory rounds={point.rounds ?? []} />

      {isManual && !pending && (
        <div className="space-y-2 border-t pt-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={dismissMutation.isPending}
              onClick={() => setConfirmDismiss(true)}
            >
              {dismissMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('projectEnvs.dismissAction')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRewriteOpen((open) => !open)
                setRewriteText('')
              }}
            >
              {t('projectEnvs.rewriteAction')}
            </Button>
          </div>
          {rewriteOpen && (
            <div className="space-y-1.5">
              <Textarea
                value={rewriteText}
                onChange={(event) => setRewriteText(event.target.value.slice(0, 2000))}
                placeholder={t('projectEnvs.rewritePlaceholder')}
                rows={3}
                data-testid={`claim-rewrite-input-${point.point_id}`}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {t('projectEnvs.rewriteCount', { count: rewriteText.length })}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setRewriteOpen(false)}>
                    {t('projectEnvs.rewriteCancel')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!rewriteText.trim() || rewriteMutation.isPending}
                    onClick={() =>
                      rewriteMutation.mutate(
                        { envId, pointId: point.point_id, data: { text: rewriteText.trim() } },
                        // Reset local result state per submit so a retry after
                        // failure doesn't keep showing the previous outcome.
                        { onSuccess: () => setRewriteText('') }
                      )
                    }
                  >
                    {rewriteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t('projectEnvs.rewriteSubmit')}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {rewriteMutation.isSuccess && rewriteResult && (
            <p
              className={cn(
                'text-xs',
                rewriteResult.passed ? 'text-fern' : 'text-destructive'
              )}
              data-testid={`claim-rewrite-result-${point.point_id}`}
            >
              {rewriteResult.passed
                ? t('projectEnvs.rewritePassed')
                : t('projectEnvs.rewriteFailed')}
              {!rewriteResult.passed &&
                LANES.map((lane) =>
                  rewriteResult.lanes?.[lane]?.issues?.length ? (
                    <span key={lane} className="block break-all">
                      {lane}: {rewriteResult.lanes![lane]!.issues!.join('; ')}
                    </span>
                  ) : null
                )}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDismiss}
        onOpenChange={setConfirmDismiss}
        title={t('projectEnvs.dismissTitle')}
        description={t('projectEnvs.dismissDesc')}
        confirmText={t('projectEnvs.dismissAction')}
        confirmVariant="destructive"
        isLoading={dismissMutation.isPending}
        onConfirm={() =>
          dismissMutation.mutate(
            { envId, pointId: point.point_id },
            {
              // Optimistic rollback lives in the query invalidation; on error
              // the panel refetch keeps the server truth.
              onSettled: () => setConfirmDismiss(false),
            }
          )
        }
      />
    </div>
  )
}

interface VerificationPanelProps {
  envId: string
  onCancel?: () => void
}

export function VerificationPanel({ envId, onCancel }: VerificationPanelProps) {
  const { t } = useTranslation()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const { data, isLoading, refetch } = useProjectEnvVerification(envId)

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  const pending = data.status === 'pending'
  const summary = data.summary ?? {}
  const degraded = data.degraded ?? {}
  const progress = data.progress

  const handleCancel = async () => {
    if (data.job?.id) {
      try {
        await tasksApi.cancel(data.job.id)
      } catch {
        // Job may already be gone; the panel converges via polling anyway.
      }
    }
    await refetch()
    onCancel?.()
  }

  return (
    <div className="space-y-4" data-testid="verification-panel">
      {pending && (
        <div className="space-y-2 rounded-lg border border-teal/40 bg-teal-tint/40 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-teal">
              <Loader2 className="h-4 w-4 animate-spin" />
              {stageLabel(progress?.stage, t)}
            </span>
            <span className="text-xs text-muted-foreground">
              {progress?.percent ?? 0}%
            </span>
          </div>
          <Progress value={progress?.percent ?? 0} />
        </div>
      )}

      {data.status === 'verified' && (
        <div className="flex items-center gap-2 rounded-lg border border-fern/40 bg-fern-tint/50 p-3 text-sm text-fern" data-testid="verification-verified-banner">
          <ShieldCheck className="h-4 w-4" />
          {t('projectEnvs.verifiedBanner')}
        </div>
      )}
      {data.status === 'needs_review' && (
        <div className="rounded-lg border border-warn/40 bg-warn-tint/60 p-3 text-sm text-warn" data-testid="verification-review-banner">
          {t('projectEnvs.needsReviewBanner', {
            count: summary.manual ?? 0,
          })}
        </div>
      )}
      {data.status === 'failed' && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="verification-failed-banner">
          {t('projectEnvs.failedBanner')}
          {progress?.error && <p className="mt-1 text-xs break-all">{progress.error}</p>}
          {data.job?.error_message && (
            <p className="mt-1 text-xs break-all">{data.job.error_message}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {t('projectEnvs.summaryLine', {
            passed: summary.passed ?? 0,
            total: summary.total ?? 0,
            manual: summary.manual ?? 0,
            uncovered: summary.uncovered ?? 0,
          })}
        </span>
        {!!degraded.kb_empty && (
          <Badge variant="outline" className="border-warn/60 text-warn">
            {t('projectEnvs.degradedKbEmpty')}
          </Badge>
        )}
        {!!degraded.single_model && (
          <Badge variant="outline" className="border-warn/60 text-warn">
            {t('projectEnvs.degradedSingleModel')}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {data.points.map((point) => (
          <PointCard key={point.point_id} envId={envId} point={point} pending={pending} />
        ))}
        {!data.points.length && !pending && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('common.noResults')}
          </p>
        )}
      </div>

      {pending && onCancel && (
        <div className="space-y-1 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>
            {t('projectEnvs.cancelVerify')}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {t('projectEnvs.cancelVerifyHint')}
          </p>
          <ConfirmDialog
            open={confirmCancel}
            onOpenChange={setConfirmCancel}
            title={t('projectEnvs.cancelVerifyTitle')}
            description={t('projectEnvs.cancelVerifyDesc')}
            confirmText={t('projectEnvs.cancelVerify')}
            confirmVariant="destructive"
            onConfirm={() => {
              setConfirmCancel(false)
              void handleCancel()
            }}
          />
        </div>
      )}
    </div>
  )
}

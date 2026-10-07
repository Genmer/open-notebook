'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { Bot, Building2, CalendarRange, Check, Copy, Loader2, RefreshCw, ScrollText, Sparkles, X } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useDeleteProjectEnv,
  useDuplicateProjectEnv,
  useRegenerateProjectEnv,
  useReverifyProjectEnv,
} from '@/lib/hooks/use-project-envs'
import type { ProjectEnv } from '@/lib/types/api'
import { spanMonths } from '@/lib/utils/project-env-time'
import { accentOf } from './env-accent'

interface ProjectEnvListProps {
  envs: ProjectEnv[]
  isLoading: boolean
  onOpenVerification: (envId: string) => void
  onOpenDetail: (env: ProjectEnv) => void
}

function StatusBadge({ env, onOpen }: { env: ProjectEnv; onOpen: () => void }) {
  const { t } = useTranslation()
  if (env.status === 'verified') {
    return (
      <Badge className="rounded-md gap-1 border-fern/40 bg-fern-tint text-fern hover:bg-fern-tint">
        <Check className="size-3" />
        {t('projectEnvs.statusVerified')}
      </Badge>
    )
  }
  if (env.status === 'needs_review') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title={t('projectEnvs.statusNeedsReview', { count: env.pending_claims_count })}
      >
        <Badge className="rounded-md border-warn/40 bg-warn-tint text-warn hover:bg-warn-tint">
          {t('projectEnvs.statusNeedsReview', { count: env.pending_claims_count })}
        </Badge>
      </button>
    )
  }
  if (env.status === 'pending') {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`env-pending-${env.id}`}
        className="rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Badge variant="outline" className="rounded-md gap-1 border-teal/50 text-teal hover:border-teal">
          <Loader2 className="size-3 animate-spin" />
          {t('projectEnvs.statusPending')}
        </Badge>
      </button>
    )
  }
  if (env.status === 'material_pending') {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`env-material-pending-${env.id}`}
        className="rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Badge variant="outline" className="rounded-md gap-1 border-teal/50 text-teal hover:border-teal">
          <Loader2 className="size-3 animate-spin" />
          {t('projectEnvs.statusMaterialPending')}
        </Badge>
      </button>
    )
  }
  if (env.status === 'material_ready') {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`env-material-ready-${env.id}`}
        className="rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Badge className="rounded-md border-warn/40 bg-warn-tint text-warn hover:bg-warn-tint">
          {t('projectEnvs.statusMaterialReady')}
        </Badge>
      </button>
    )
  }
  return (
    <Badge variant="destructive" className="rounded-md gap-1">
      <X className="size-3" />
      {t('projectEnvs.statusFailed')}
    </Badge>
  )
}

export function ProjectEnvList({ envs, isLoading, onOpenVerification, onOpenDetail }: ProjectEnvListProps) {
  const { t } = useTranslation()
  const [deleteTarget, setDeleteTarget] = useState<ProjectEnv | null>(null)
  const deleteMutation = useDeleteProjectEnv()
  const duplicateMutation = useDuplicateProjectEnv()
  const reverifyMutation = useReverifyProjectEnv()
  const regenerateMutation = useRegenerateProjectEnv()
  const [copyingId, setCopyingId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <LoadingSpinner className="mr-2" />
        {t('common.loading')}
      </div>
    )
  }

  if (!envs.length) {
    return null
  }

  const handleCopy = (env: ProjectEnv) => {
    setCopyingId(env.id)
    duplicateMutation.mutate(
      {
        name: `${env.name.slice(0, 92)}${t('projectEnvs.copySuffix')}`,
        background: env.background,
        period_start: env.period_start,
        period_end: env.period_end,
        source_type: env.source_type,
        keywords: env.keywords ?? undefined,
        tech_background: env.tech_background,
        tuning_process: env.tuning_process,
        problems_solutions: env.problems_solutions,
        my_role: env.my_role,
        scale: env.scale,
        generic_paragraph: env.generic_paragraph ?? null,
        background_ai_polished: (env.ai_assisted?.polish_count ?? 0) > 0,
      },
      { onSettled: () => setCopyingId(null) }
    )
  }

  return (
    <div className="space-y-3" data-testid="project-env-list">
      {envs.map((env) => {
        const span = spanMonths(env.period_start, env.period_end)
        const accent = accentOf(env.id)
        const real = env.source_type === 'real'
        return (
          <Card
            key={env.id}
            className="relative gap-0 overflow-hidden py-0"
            style={{ backgroundImage: accent.wash }}
          >
            <span
              aria-hidden
              className="env-accent-ribbon absolute inset-y-0 left-0 w-[3px] rounded-l-[inherit]"
              style={{ backgroundImage: accent.ribbon }}
            />
            <CardContent className="relative flex flex-col gap-2.5 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', accent.tile)}
                >
                  <Building2 className="size-4" strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    data-testid={`env-open-detail-${env.id}`}
                    title={env.name}
                    onClick={() => onOpenDetail(env)}
                    className="block w-full truncate text-left text-sm font-medium hover:text-teal hover:underline underline-offset-4"
                  >
                    {env.name}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {real ? (
                      <Badge variant="secondary">{t('projectEnvs.sourceReal')}</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-teal/40 bg-teal-tint/40 text-teal">
                        <Bot className="size-3" aria-hidden />
                        {t('projectEnvs.sourceMock')}
                      </Badge>
                    )}
                    {(env.ai_assisted?.polish_count ?? 0) > 0 && (
                      <Badge variant="outline" className="gap-1 border-teal/50 text-teal">
                        <Sparkles className="size-3" aria-hidden />
                        {t('projectEnvs.aiPolished')}
                      </Badge>
                    )}
                    {(env.period_start || env.period_end) && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <CalendarRange className="size-3" aria-hidden />
                        <span className="font-mono tabular-nums">
                          {env.period_start}–{env.period_end}
                        </span>
                        {span !== null && <span>· {t('projectEnvs.monthsCount', { count: span })}</span>}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <StatusBadge env={env} onOpen={() => onOpenVerification(env.id)} />
                </div>
              </div>

              {!!env.keywords?.length && (
                // pl-12 aligns the chips with the name (size-9 tile + gap-3)
                <div className="flex flex-wrap gap-1.5 pl-12">
                  {env.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1.5 rounded-sm border bg-popover px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      <span aria-hidden className={cn('size-1.5 rounded-full', accent.dot)} />
                      {kw}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t('projectEnvs.sessionsCount', { count: env.session_ref_count })}</span>
                  {env.generic_paragraph && (
                    <span title={t('projectEnvs.genericParagraph')} className="inline-flex items-center text-fern">
                      <ScrollText className="size-3" aria-hidden />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {env.source_type === 'mock' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={
                        regenerateMutation.isPending ||
                        env.status === 'pending' ||
                        env.status === 'material_pending'
                      }
                      onClick={() => regenerateMutation.mutate(env.id)}
                      aria-label={t('projectEnvs.regenerate')}
                      title={t('projectEnvs.regenerate')}
                    >
                      {regenerateMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {t('projectEnvs.regenerate')}
                    </Button>
                  )}
                  {env.status === 'failed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={reverifyMutation.isPending}
                      onClick={() => reverifyMutation.mutate(env.id)}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', reverifyMutation.isPending && 'animate-spin')} />
                      {t('projectEnvs.reverify')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={t('projectEnvs.copy')}
                    title={t('projectEnvs.copy')}
                    disabled={copyingId === env.id || duplicateMutation.isPending}
                    onClick={() => handleCopy(env)}
                  >
                    {copyingId === env.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    aria-label={t('projectEnvs.deleteTitle')}
                    title={t('projectEnvs.deleteTitle')}
                    disabled={deleteMutation.isPending}
                    onClick={() => setDeleteTarget(env)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('projectEnvs.deleteTitle')}
        description={t('projectEnvs.deleteDesc', {
          name: deleteTarget?.name ?? '',
          count: deleteTarget?.session_ref_count ?? 0,
        })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return
          deleteMutation.mutate(deleteTarget.id, {
            onSettled: () => setDeleteTarget(null),
          })
        }}
      />
    </div>
  )
}

export function ProjectEnvEmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={Building2}
      title={t('projectEnvs.emptyTitle')}
      description={t('projectEnvs.emptyDesc')}
      action={
        <Button size="sm" onClick={onCreate} data-testid="env-create-button">
          {t('projectEnvs.create')}
        </Button>
      }
    />
  )
}

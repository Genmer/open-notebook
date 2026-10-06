'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { Building2, Check, Copy, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useDeleteProjectEnv,
  useDuplicateProjectEnv,
  useRegenerateProjectEnv,
  useReverifyProjectEnv,
} from '@/lib/hooks/use-project-envs'
import type { ProjectEnv } from '@/lib/types/api'
import { spanMonths } from '@/lib/utils/project-env-time'

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
      <Badge className="gap-1 border-fern/40 bg-fern-tint text-fern hover:bg-fern-tint">
        <Check className="h-3 w-3" />
        {t('projectEnvs.statusVerified')}
      </Badge>
    )
  }
  if (env.status === 'needs_review') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title={t('projectEnvs.statusNeedsReview', { count: env.pending_claims_count })}
      >
        <Badge className="border-warn/40 bg-warn-tint text-warn hover:bg-warn-tint">
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
        className="rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Badge variant="outline" className="gap-1 border-teal/50 text-teal hover:border-teal">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('projectEnvs.statusPending')}
        </Badge>
      </button>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <X className="h-3 w-3" />
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
        background_ai_polished: (env.ai_assisted?.polish_count ?? 0) > 0,
      },
      { onSettled: () => setCopyingId(null) }
    )
  }

  return (
    <div className="space-y-2" data-testid="project-env-list">
      {envs.map((env) => {
        const span = spanMonths(env.period_start, env.period_end)
        return (
          <Card key={env.id} className="py-3">
            <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium hover:text-teal hover:underline underline-offset-4"
                title={env.name}
                onClick={() => onOpenDetail(env)}
                data-testid={`env-open-detail-${env.id}`}
              >
                {env.name}
              </button>

              {env.source_type === 'real' ? (
                <Badge variant="secondary">{t('projectEnvs.sourceReal')}</Badge>
              ) : (
                <Badge variant="outline" className="gap-1">🤖 {t('projectEnvs.sourceMock')}</Badge>
              )}
              {(env.ai_assisted?.polish_count ?? 0) > 0 && (
                <Badge variant="outline" className="gap-1 border-teal/50 text-teal">
                  <Sparkles className="h-3 w-3" />
                  {t('projectEnvs.aiPolished')}
                </Badge>
              )}

              {(env.period_start || env.period_end) && (
                <span className="text-xs text-muted-foreground">
                  {env.period_start}–{env.period_end}
                  {span !== null && ` · ${t('projectEnvs.monthsCount', { count: span })}`}
                </span>
              )}

              <StatusBadge env={env} onOpen={() => onOpenVerification(env.id)} />

              <span className="text-xs text-muted-foreground">
                {t('projectEnvs.sessionsCount', { count: env.session_ref_count })}
              </span>

              <div className="flex items-center gap-1">
                {env.source_type === 'mock' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={regenerateMutation.isPending || env.status === 'pending'}
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

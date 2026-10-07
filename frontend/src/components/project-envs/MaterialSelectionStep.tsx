'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useGenerateProjectEnvMaterials,
  useProjectEnvMaterials,
  useRegenerateProjectEnv,
  useSubmitProjectEnvMaterials,
} from '@/lib/hooks/use-project-envs'
import { MaterialPickerTab } from './MaterialPickerTab'
import { RoutePickerTab } from './RoutePickerTab'

export type MaterialTab = 'materials' | 'routes'

// Confirm-guarded actions on the ready branch. Submit kinds are guarded only
// when the OTHER tab holds a pick that the submit would silently drop.
type ConfirmAction = 'regenerate' | 'skip' | 'submitMaterials' | 'submitRoutes'

function materialStageLabel(stage: string | undefined, t: (k: string) => string): string {
  switch (stage) {
    case 'routing': return t('projectEnvs.stageRouting')
    default: return t('projectEnvs.stageMaterialing')
  }
}

// progress.updated older than this means the worker is slow (not dead —
// polling keeps running); show a reassurance hint.
const STALE_AFTER_MS = 180_000

function isStale(updated: string | undefined): boolean {
  if (!updated) return false
  const time = Date.parse(updated)
  return Number.isFinite(time) && Date.now() - time > STALE_AFTER_MS
}

interface MaterialSelectionStepProps {
  envId: string
  keywords: string[]
  tab: MaterialTab
  selectedIds: Set<string>
  selectedRouteId: string | null
  onTabChange: (tab: MaterialTab) => void
  onSelectedIdsChange: (ids: Set<string>) => void
  onSelectedRouteChange: (id: string | null) => void
  onSubmitted: () => void
  onBack: () => void
  // Closes the whole wizard (used while generation keeps running in the
  // worker); the list badge lets the user come back to this step.
  onClose: () => void
}

export function MaterialSelectionStep({
  envId,
  keywords,
  tab,
  selectedIds,
  selectedRouteId,
  onTabChange,
  onSelectedIdsChange,
  onSelectedRouteChange,
  onSubmitted,
  onBack,
  onClose,
}: MaterialSelectionStepProps) {
  const { t } = useTranslation()
  const { data, isLoading, refetch } = useProjectEnvMaterials(envId)
  const generateMutation = useGenerateProjectEnvMaterials()
  const regenerateMutation = useRegenerateProjectEnv()
  const submitMutation = useSubmitProjectEnvMaterials()
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  const materialItems = data.materials?.items ?? []
  const routeItems = data.routes?.items ?? []
  const hasStore = materialItems.length > 0 || routeItems.length > 0
  const generating = data.status === 'material_pending'
  const errorText = data.progress?.error || data.job?.error_message || ''

  const doSubmitMaterials = () => {
    submitMutation.mutate(
      { envId, data: { kind: 'materials', material_ids: [...selectedIds] } },
      { onSuccess: () => onSubmitted() }
    )
  }

  const doSubmitRoutes = (routeId: string) => {
    submitMutation.mutate(
      { envId, data: { kind: 'routes', route_id: routeId } },
      { onSuccess: () => onSubmitted() }
    )
  }

  const submitMaterials = () => {
    if (selectedIds.size === 0) return
    // Submitting materials drops a route picked on the other tab — confirm.
    if (selectedRouteId) {
      setConfirmAction('submitMaterials')
      return
    }
    doSubmitMaterials()
  }

  const submitRoutes = () => {
    if (!selectedRouteId) return
    const routeId = selectedRouteId
    // Adopting a route drops materials picked on the other tab — confirm.
    if (selectedIds.size > 0) {
      setConfirmAction('submitRoutes')
      return
    }
    doSubmitRoutes(routeId)
  }

  const retry = () => generateMutation.mutate(envId)
  // Skip = the existing regenerate endpoint: keywords straight to
  // draft+verification, no candidate step. On the ready branch it costs a
  // full run and drops picks, so it goes through a confirm dialog.
  const doSkip = () =>
    regenerateMutation.mutate(envId, { onSuccess: () => onSubmitted() })

  const doRegenerateBatch = () => {
    onSelectedIdsChange(new Set())
    onSelectedRouteChange(null)
    generateMutation.mutate(envId)
  }

  const confirmDialog = (() => {
    switch (confirmAction) {
      case 'regenerate':
        return {
          title: t('projectEnvs.materialRegenerateTitle'),
          description: t('projectEnvs.materialRegenerateDesc'),
          confirmText: t('projectEnvs.materialRegenerateBatch'),
          onConfirm: doRegenerateBatch,
        }
      case 'skip':
        return {
          title: t('projectEnvs.skipReadyTitle'),
          description: t('projectEnvs.skipReadyDesc'),
          confirmText: t('projectEnvs.skipMaterials'),
          onConfirm: doSkip,
        }
      case 'submitRoutes':
        return {
          title: t('projectEnvs.crossTabRoutesTitle'),
          description: t('projectEnvs.crossTabRoutesDesc', { count: selectedIds.size }),
          confirmText: t('projectEnvs.routeSubmit'),
          onConfirm: () => {
            if (selectedRouteId) doSubmitRoutes(selectedRouteId)
          },
        }
      case 'submitMaterials':
        return {
          title: t('projectEnvs.crossTabMaterialsTitle'),
          description: t('projectEnvs.crossTabMaterialsDesc'),
          confirmText: t('projectEnvs.materialSubmit'),
          onConfirm: doSubmitMaterials,
        }
      default:
        return null
    }
  })()

  return (
    <div className="space-y-3 py-2">
      <div>
        <p className="text-sm font-medium">{t('projectEnvs.materialStepTitle')}</p>
        <p className="text-xs text-muted-foreground">
          {t('projectEnvs.materialStepDesc')}
        </p>
      </div>

      {keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('projectEnvs.mockKeywordsLabel')}
          </span>
          {keywords.map((keyword) => (
            <Badge key={keyword} variant="secondary" className="font-normal">
              {keyword}
            </Badge>
          ))}
        </div>
      )}

      {generating && (
        <div className="space-y-2 rounded-lg border border-teal/40 bg-teal-tint/40 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-teal">
              <Loader2 className="h-4 w-4 animate-spin" />
              {materialStageLabel(data.progress?.stage, t)}
            </span>
            <span className="text-xs text-muted-foreground">
              {data.progress?.percent ?? 0}%
            </span>
          </div>
          <Progress value={data.progress?.percent ?? 0} />
          {data.progress?.message && (
            <p className="text-xs text-muted-foreground" data-testid="candidates-progress-message">
              {data.progress.message}
            </p>
          )}
          {isStale(data.progress?.updated) && (
            <p className="text-xs text-warn">{t('projectEnvs.materialStaleHint')}</p>
          )}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-3 w-3" />
              {t('common.refresh')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onClose}
            >
              {t('projectEnvs.materialBackToList')}
            </Button>
          </div>
        </div>
      )}

      {!generating && !hasStore && (
        <>
          <div
            className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="candidates-failed-banner"
          >
            <p className="font-medium">
              {data.status === 'failed'
                ? t('projectEnvs.materialGenerateFailed')
                : t('projectEnvs.materialEmptyAll')}
            </p>
            {errorText && <p className="break-all text-xs">{errorText}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={generateMutation.isPending}
              onClick={retry}
              data-testid="candidates-retry"
            >
              {generateMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {t('projectEnvs.materialRetry')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={regenerateMutation.isPending}
              onClick={doSkip}
              data-testid="candidates-skip"
            >
              {t('projectEnvs.skipMaterials')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onBack}>
              {t('common.back')}
            </Button>
          </div>
        </>
      )}

      {!generating && hasStore && (
        <>
          <Tabs value={tab} onValueChange={(value) => onTabChange(value as MaterialTab)}>
            <TabsList>
              <TabsTrigger value="materials">{t('projectEnvs.tabMaterials')}</TabsTrigger>
              <TabsTrigger value="routes">{t('projectEnvs.tabRoutes')}</TabsTrigger>
            </TabsList>
            <TabsContent value="materials" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('projectEnvs.tabMaterialsHint')}
              </p>
              {materialItems.length > 0 ? (
                <MaterialPickerTab
                  items={materialItems}
                  selectedIds={selectedIds}
                  onSelectedIdsChange={onSelectedIdsChange}
                  onSubmit={submitMaterials}
                  submitting={submitMutation.isPending}
                />
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t('projectEnvs.materialEmptyAll')}
                </p>
              )}
            </TabsContent>
            <TabsContent value="routes" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('projectEnvs.tabRoutesHint')}
              </p>
              {routeItems.length > 0 ? (
                <RoutePickerTab
                  routes={routeItems}
                  selectedRouteId={selectedRouteId}
                  onSelectedRouteChange={onSelectedRouteChange}
                  onSubmit={submitRoutes}
                  submitting={submitMutation.isPending}
                />
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t('projectEnvs.materialEmptyAll')}
                </p>
              )}
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={generateMutation.isPending}
                onClick={() => setConfirmAction('regenerate')}
                data-testid="candidates-regenerate-batch"
              >
                {generateMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                <RefreshCw className="h-3.5 w-3.5" />
                {t('projectEnvs.materialRegenerateBatch')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={regenerateMutation.isPending}
                onClick={() => setConfirmAction('skip')}
                data-testid="candidates-skip-ready"
              >
                {t('projectEnvs.skipMaterials')}
              </Button>
            </div>
            <Button variant="outline" onClick={onBack}>
              {t('common.back')}
            </Button>
          </div>
        </>
      )}

      {confirmDialog && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null)
          }}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmText={confirmDialog.confirmText}
          onConfirm={() => {
            setConfirmAction(null)
            confirmDialog.onConfirm()
          }}
        />
      )}
    </div>
  )
}

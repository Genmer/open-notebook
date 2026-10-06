'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, Loader2, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { TaskLiveInspector } from '@/components/tasks/TaskLiveInspector'
import { dataTransferApi, type DownloadProgress, type ExportScope } from '@/lib/api/dataTransfer'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import {
  useDeleteExportPackage,
  useExportEstimate,
  useExportStatus,
  useStartExport,
} from '@/lib/hooks/use-data-transfer'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  formatDuration,
  tableLabel,
  TransferActivity,
  TransferStageList,
  type TransferStage,
} from './TransferStageList'

export const EXPORT_STAGES: readonly TransferStage[] = [
  { id: 'collecting', labelKey: 'dataManagement.export.stages.collecting' },
  { id: 'exporting_tables', labelKey: 'dataManagement.export.stages.exporting_tables' },
  { id: 'copying_files', labelKey: 'dataManagement.export.stages.copying_files' },
  { id: 'exporting_embeddings', labelKey: 'dataManagement.export.stages.exporting_embeddings' },
  { id: 'packaging', labelKey: 'dataManagement.export.stages.packaging' },
]

import { formatBytes } from '@/lib/utils/format'

// Re-exported for backwards compatibility; the implementation lives in
// utils/format so non-data components can share it.
export { formatBytes } from '@/lib/utils/format'

export function ExportCard() {
  const { t } = useTranslation()
  const { data } = useExportStatus()
  const startExport = useStartExport()
  const deletePackage = useDeleteExportPackage()
  const { toast } = useToast()

  const [startOpen, setStartOpen] = useState(false)
  const [scope, setScope] = useState<ExportScope>('full')
  const [includeModels, setIncludeModels] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [selectedNotebooks, setSelectedNotebooks] = useState<string[]>([])

  const { data: notebooksData } = useNotebooks(false)
  const notebooks = useMemo(() => notebooksData ?? [], [notebooksData])
  // The estimate query runs only while the start dialog is open; scope and
  // the notebook selection are part of its key, so toggling either refetches.
  const estimateQuery = useExportEstimate(startOpen, scope, selectedNotebooks)
  const estimate = estimateQuery.data

  const status = data?.status
  const progress = data?.progress
  const summary = data?.summary
  const isActive = status === 'queued' || status === 'running'
  const modelsIncluded = scope === 'models' || includeModels
  const notebooksReady = scope === 'notebooks' && selectedNotebooks.length > 0
  const [showSkippedFiles, setShowSkippedFiles] = useState(false)
  const stageLabels = Object.fromEntries(
    EXPORT_STAGES.map((stage) => [stage.id, t(stage.labelKey)])
  )

  const openStartDialog = () => {
    setScope('full')
    setIncludeModels(false)
    setSelectedNotebooks([])
    setStartOpen(true)
  }

  const toggleNotebook = (id: string, checked: boolean) => {
    setSelectedNotebooks((prev) =>
      checked ? [...prev, id] : prev.filter((entry) => entry !== id)
    )
  }

  const handleStart = () => {
    if (scope === 'notebooks' && selectedNotebooks.length === 0) return
    setStartOpen(false)
    startExport.mutate({
      scope,
      include_models: scope === 'full' ? includeModels : false,
      notebook_ids: scope === 'notebooks' ? selectedNotebooks : undefined,
    })
  }

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadProgress({ loaded: 0, total: 0 })
    try {
      await dataTransferApi.downloadExport(
        (progressUpdate) => setDownloadProgress(progressUpdate),
        summary?.package_filename,
      )
    } catch {
      toast({
        title: t('common.error'),
        description: t('dataManagement.errors.failed'),
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
      setDownloadProgress(null)
    }
  }

  const downloadPercent =
    downloadProgress && downloadProgress.total > 0
      ? Math.min(100, Math.round((downloadProgress.loaded / downloadProgress.total) * 100))
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dataManagement.export.title')}</CardTitle>
        <CardDescription>{t('dataManagement.export.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isActive && (
          <div className="space-y-3">
            <TransferStageList
              stages={EXPORT_STAGES}
              current={progress?.stage}
              stageStats={progress?.stages}
            />
            <Progress value={progress?.percent ?? 0} className="h-1.5" />
            <TransferActivity
              progress={progress ?? {}}
              stageLabels={stageLabels}
              fallbackLabel={t('dataManagement.export.stages.collecting')}
            />
            {data?.command_id && (
              <div data-testid="export-live-inspector">
                <TaskLiveInspector
                  embedded
                  variant="compact"
                  job={{ jobId: data.command_id, commandName: 'export_data', type: 'data_transfer' }}
                />
              </div>
            )}
          </div>
        )}

        {status === 'completed' && summary && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">
                {summary.package_type === 'models'
                  ? t('dataManagement.export.summary.packageTypeModels')
                  : t('dataManagement.export.summary.packageTypeFull')}
              </span>
              {' · '}
              <span className="text-muted-foreground">
                {t('dataManagement.export.summary.packageSize')}
              </span>
              : <span className="font-semibold">{formatBytes(summary.package_size_bytes)}</span>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t('dataManagement.export.summary.tableCount')}
              </p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {Object.entries(summary.counts).map(([table, count]) => (
                  <li key={table}>
                    {t('dataManagement.export.summary.counts', {
                      table: tableLabel(t, table),
                      count,
                    })}
                  </li>
                ))}
              </ul>
              {typeof summary.duration_seconds === 'number' && (
                <p className="text-xs text-muted-foreground">
                  {formatDuration(summary.duration_seconds, t)}
                </p>
              )}
            </div>
            {summary.files_skipped > 0 && (
              <div className="rounded-md bg-gold-tint p-3">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-sm font-medium text-gold"
                  onClick={() => setShowSkippedFiles((open) => !open)}
                  aria-expanded={showSkippedFiles}
                >
                  {showSkippedFiles ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {t('dataManagement.export.summary.filesSkipped', { count: summary.files_skipped })}
                </button>
                {showSkippedFiles && (
                  <div className="mt-2 space-y-1 text-sm text-gold">
                    {(summary.skipped_files ?? []).map((entry) => (
                      <div key={`${entry.source_id}-${entry.file}`} className="font-mono text-xs">
                        {entry.file}
                        <span className="ml-2 font-sans text-muted-foreground">
                          {entry.source_id} ·{' '}
                          {t(
                            entry.reason === 'missing_on_disk'
                              ? 'dataManagement.export.summary.skippedReasonMissing'
                              : 'dataManagement.export.summary.skippedReasonInvalid'
                          )}
                        </span>
                      </div>
                    ))}
                    {(summary.skipped_files?.length ?? 0) < summary.files_skipped && (
                      <p className="text-xs text-muted-foreground">
                        {t('dataManagement.export.summary.skippedTruncated', {
                          shown: summary.skipped_files?.length ?? 0,
                          total: summary.files_skipped,
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleDownload} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {downloading
                  ? downloadPercent !== null
                    ? t('dataManagement.export.downloadingPercent', { percent: downloadPercent })
                    : t('dataManagement.export.downloading')
                  : t('dataManagement.export.download')}
              </Button>
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t('dataManagement.export.deletePackage')}
              </Button>
              <Button variant="outline" onClick={openStartDialog}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t('dataManagement.export.start')}
              </Button>
            </div>
            {downloading && downloadProgress && (
              <div className="space-y-1">
                <Progress
                  value={downloadPercent ?? 100}
                  className="h-1.5"
                />
                <p className="text-xs text-muted-foreground" data-testid="download-progress-label">
                  {downloadPercent !== null
                    ? t('dataManagement.export.downloadProgress', {
                        loaded: formatBytes(downloadProgress.loaded),
                        total: formatBytes(downloadProgress.total),
                        percent: downloadPercent,
                      })
                    : t('dataManagement.export.downloadProgressIndeterminate', {
                        loaded: formatBytes(downloadProgress.loaded),
                      })}
                </p>
              </div>
            )}
          </div>
        )}

        {status === 'failed' && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              {t('dataManagement.errors.failed')} {progress?.error}
            </p>
            <TransferStageList stages={EXPORT_STAGES} current={progress?.stage} failed />
            <Button variant="outline" onClick={openStartDialog}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('dataManagement.export.start')}
            </Button>
          </div>
        )}

        {(!status || status === 'none') && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t('dataManagement.export.idle')}</p>
            <Button onClick={openStartDialog} disabled={startExport.isPending}>
              {startExport.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              {t('dataManagement.export.start')}
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={startOpen} onOpenChange={setStartOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dataManagement.export.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dataManagement.export.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RadioGroup
            value={scope}
            onValueChange={(value) => setScope(value as ExportScope)}
            className="gap-2"
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50">
              <RadioGroupItem value="full" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  {t('dataManagement.export.scope.full')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t('dataManagement.export.scope.fullDesc')}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50">
              <RadioGroupItem value="notebooks" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  {t('dataManagement.export.scope.notebooks')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t('dataManagement.export.scope.notebooksDesc')}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50">
              <RadioGroupItem value="models" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  {t('dataManagement.export.scope.models')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t('dataManagement.export.scope.modelsDesc')}
                </span>
              </span>
            </label>
          </RadioGroup>
          {scope === 'notebooks' && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t('dataManagement.export.pickNotebooks')}
              </p>
              {notebooks.length === 0 && !notebooksData ? (
                <p className="text-sm text-muted-foreground">
                  {t('dataManagement.export.loadingNotebooks')}
                </p>
              ) : notebooks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('dataManagement.export.noNotebooks')}
                </p>
              ) : (
                <ScrollArea className="h-40 rounded-md border p-2">
                  <div className="space-y-1">
                    {notebooks.map((notebook) => {
                      const notebookId = String(notebook.id)
                      return (
                        <label
                          key={notebookId}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={selectedNotebooks.includes(notebookId)}
                            onCheckedChange={(checked) =>
                              toggleNotebook(notebookId, checked === true)
                            }
                          />
                          <span className="truncate">{notebook.name || notebookId}</span>
                        </label>
                      )
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
          {scope !== 'models' && (
            <div
              className="rounded-md bg-muted/50 p-3 text-sm"
              data-testid="export-estimate"
            >
              {estimate ? (
                <div className="space-y-1">
                  <p className="font-medium">
                    {t('dataManagement.export.estimate.size')}:{' '}
                    <span className="font-semibold">
                      ~{formatBytes(estimate.estimated_package_bytes)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('dataManagement.export.estimate.breakdown', {
                      notebooks: estimate.notebooks,
                      sources: estimate.sources,
                      notes: estimate.notes,
                      embeddings: estimate.embeddings,
                    })}
                  </p>
                  {estimate.asset_files > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('dataManagement.export.estimate.files', {
                        count: estimate.asset_files,
                        size: formatBytes(estimate.asset_bytes),
                      })}
                    </p>
                  )}
                </div>
              ) : estimateQuery.isFetching ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('dataManagement.export.estimate.calculating')}
                </p>
              ) : null}
            </div>
          )}
          {scope === 'full' && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={includeModels}
                onCheckedChange={(checked) => setIncludeModels(checked === true)}
                className="mt-0.5"
              />
              <span>
                {t('dataManagement.export.includeModels')}
                <span className="block text-xs text-muted-foreground">
                  {t('dataManagement.export.includeModelsHint')}
                </span>
              </span>
            </label>
          )}
          {modelsIncluded && (
            <p className="rounded-md bg-destructive-tint p-3 text-sm text-destructive">
              {t('dataManagement.export.apiKeyWarning')}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={startExport.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStart}
              disabled={startExport.isPending || (scope === 'notebooks' && !notebooksReady)}
            >
              {t('dataManagement.export.start')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('dataManagement.export.deleteConfirmTitle')}
        description={t('dataManagement.export.deleteConfirmDesc')}
        confirmText={t('dataManagement.export.deletePackage')}
        confirmVariant="destructive"
        onConfirm={() => {
          setDeleteOpen(false)
          deletePackage.mutate()
        }}
        isLoading={deletePackage.isPending}
      />
    </Card>
  )
}

'use client'

import { useState } from 'react'
import { Download, Loader2, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { dataTransferApi } from '@/lib/api/dataTransfer'
import {
  useDeleteExportPackage,
  useExportStatus,
  useStartExport,
} from '@/lib/hooks/use-data-transfer'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { TransferStageList, type TransferStage } from './TransferStageList'

export const EXPORT_STAGES: readonly TransferStage[] = [
  { id: 'collecting', labelKey: 'dataManagement.export.stages.collecting' },
  { id: 'exporting_tables', labelKey: 'dataManagement.export.stages.exporting_tables' },
  { id: 'copying_files', labelKey: 'dataManagement.export.stages.copying_files' },
  { id: 'exporting_embeddings', labelKey: 'dataManagement.export.stages.exporting_embeddings' },
  { id: 'packaging', labelKey: 'dataManagement.export.stages.packaging' },
]

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${exponent === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

export function ExportCard() {
  const { t } = useTranslation()
  const { data } = useExportStatus()
  const startExport = useStartExport()
  const deletePackage = useDeleteExportPackage()
  const { toast } = useToast()

  const [startOpen, setStartOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const status = data?.status
  const progress = data?.progress
  const summary = data?.summary
  const isActive = status === 'queued' || status === 'running'

  const handleDownload = async () => {
    setDownloading(true)
    try {
      await dataTransferApi.downloadExport(summary?.package_filename)
    } catch {
      toast({
        title: t('common.error'),
        description: t('dataManagement.errors.failed'),
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dataManagement.export.title')}</CardTitle>
        <CardDescription>{t('dataManagement.export.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isActive && (
          <div className="space-y-3">
            <TransferStageList stages={EXPORT_STAGES} current={progress?.stage} />
            <Progress value={progress?.percent ?? 0} className="h-1.5" />
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progress?.message || t('dataManagement.export.stages.collecting')}
            </p>
          </div>
        )}

        {status === 'completed' && summary && (
          <div className="space-y-3">
            <div className="text-sm">
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
                    {t('dataManagement.export.summary.counts', { table, count })}
                  </li>
                ))}
              </ul>
            </div>
            {summary.files_skipped > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('dataManagement.export.summary.filesSkipped', { count: summary.files_skipped })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleDownload} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {downloading
                  ? t('dataManagement.export.downloading')
                  : t('dataManagement.export.download')}
              </Button>
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t('dataManagement.export.deletePackage')}
              </Button>
              <Button variant="outline" onClick={() => setStartOpen(true)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t('dataManagement.export.start')}
              </Button>
            </div>
          </div>
        )}

        {status === 'failed' && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              {t('dataManagement.errors.failed')} {progress?.error}
            </p>
            <TransferStageList stages={EXPORT_STAGES} current={progress?.stage} failed />
            <Button variant="outline" onClick={() => setStartOpen(true)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('dataManagement.export.start')}
            </Button>
          </div>
        )}

        {(!status || status === 'none') && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t('dataManagement.export.idle')}</p>
            <Button onClick={() => setStartOpen(true)} disabled={startExport.isPending}>
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

      <ConfirmDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        title={t('dataManagement.export.confirmTitle')}
        description={t('dataManagement.export.confirmDescription')}
        confirmText={t('dataManagement.export.start')}
        onConfirm={() => {
          setStartOpen(false)
          startExport.mutate()
        }}
        isLoading={startExport.isPending}
      />

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

'use client'

import { useState } from 'react'
import { AlertCircle, FileArchive, Loader2, Upload } from 'lucide-react'

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
import {
  useImportStatus,
  useUploadImportPackage,
} from '@/lib/hooks/use-data-transfer'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { formatBytes } from './ExportCard'
import { TransferStageList, type TransferStage } from './TransferStageList'

export const IMPORT_STAGES: readonly TransferStage[] = [
  { id: 'validating', labelKey: 'dataManagement.import.stages.validating' },
  { id: 'precheck', labelKey: 'dataManagement.import.stages.precheck' },
  { id: 'metadata', labelKey: 'dataManagement.import.stages.metadata' },
  { id: 'files', labelKey: 'dataManagement.import.stages.files' },
  { id: 'embeddings', labelKey: 'dataManagement.import.stages.embeddings' },
  { id: 'relations', labelKey: 'dataManagement.import.stages.relations' },
]

// Mirrors the API MaxBodySizeMiddleware default (OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB).
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export function ImportCard() {
  const { t } = useTranslation()
  const { data } = useImportStatus()
  const uploadImport = useUploadImportPackage()

  const [file, setFile] = useState<File | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Without this the terminal states (completed/failed) have no way back to
  // the upload UI: import state persists server-side with no reset endpoint.
  const [showUploadPanel, setShowUploadPanel] = useState(false)

  const status = data?.status
  const progress = data?.progress
  const summary = data?.summary
  const isActive = status === 'queued' || status === 'running'
  const tooLarge = !!file && file.size > MAX_UPLOAD_BYTES
  const canUpload = !!file && !tooLarge && !uploadImport.isPending

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dataManagement.import.title')}</CardTitle>
        <CardDescription>{t('dataManagement.import.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isActive && (
          <div className="space-y-3">
            <TransferStageList stages={IMPORT_STAGES} current={progress?.stage} />
            <Progress value={progress?.percent ?? 0} className="h-1.5" />
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progress?.message || t('dataManagement.import.stages.validating')}
            </p>
          </div>
        )}

        {status === 'completed' && summary && (
          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('dataManagement.import.summary.imported')}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {Object.entries(summary.imported).map(([table, count]) => (
                    <li key={table}>
                      {t('dataManagement.import.rowFormat', { table, count })}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('dataManagement.import.summary.skipped')}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {Object.entries(summary.skipped).map(([table, count]) => (
                    <li key={table}>
                      {t('dataManagement.import.rowFormat', { table, count })}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {summary.warnings.length > 0 && (
              <div className="space-y-1 rounded-md bg-gold-tint p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-gold">
                  <AlertCircle className="h-4 w-4" />
                  {t('dataManagement.import.summary.warnings')}
                </p>
                <ul className="list-inside list-disc text-sm text-gold">
                  {summary.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="outline" onClick={() => { setFile(null); setShowUploadPanel(true) }}>
              <Upload className="mr-2 h-4 w-4" />
              {t('dataManagement.import.importAnother')}
            </Button>
          </div>
        )}

        {status === 'failed' && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              {t('dataManagement.errors.failed')} {progress?.error}
            </p>
            <TransferStageList stages={IMPORT_STAGES} current={progress?.stage} failed />
            <Button variant="outline" onClick={() => { setFile(null); setShowUploadPanel(true) }}>
              <Upload className="mr-2 h-4 w-4" />
              {t('dataManagement.import.importAnother')}
            </Button>
          </div>
        )}

        {(!status || status === 'none' || showUploadPanel) && !isActive && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                aria-label={t('dataManagement.import.chooseFile')}
                className="text-sm"
              />
              <Button onClick={() => setConfirmOpen(true)} disabled={!canUpload}>
                {uploadImport.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploadImport.isPending
                  ? t('dataManagement.import.uploading')
                  : t('dataManagement.import.upload')}
              </Button>
            </div>
            {file && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileArchive className="h-4 w-4" />
                {file.name} ({formatBytes(file.size)})
              </p>
            )}
            <p className={cn('text-xs', tooLarge ? 'text-destructive' : 'text-muted-foreground')}>
              {t('dataManagement.import.limitHint')}
            </p>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('dataManagement.import.confirmTitle')}
        description={t('dataManagement.import.confirmDescription')}
        confirmText={t('dataManagement.import.upload')}
        onConfirm={() => {
          setConfirmOpen(false)
          setShowUploadPanel(false)
          if (file) uploadImport.mutate(file)
        }}
        isLoading={uploadImport.isPending}
      />
    </Card>
  )
}

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
import type { ImportSummary } from '@/lib/api/dataTransfer'
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
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

// code → literal i18n key (the unused-key test greps source for these strings).
const WARNING_KEYS: Record<string, string> = {
  droppedField: 'dataManagement.warnings.droppedField',
  unparseableDatetime: 'dataManagement.warnings.unparseableDatetime',
  embeddingModelMismatch: 'dataManagement.warnings.embeddingModelMismatch',
  noDefaultEmbeddingModel: 'dataManagement.warnings.noDefaultEmbeddingModel',
  embeddingDimensionMismatch: 'dataManagement.warnings.embeddingDimensionMismatch',
  transformationModelMissing: 'dataManagement.warnings.transformationModelMissing',
  transformationPromptConflict: 'dataManagement.warnings.transformationPromptConflict',
  manifestFileMissing: 'dataManagement.warnings.manifestFileMissing',
  fileChecksumMismatch: 'dataManagement.warnings.fileChecksumMismatch',
  edgeEndpointNotImported: 'dataManagement.warnings.edgeEndpointNotImported',
  edgeEndpointUnknown: 'dataManagement.warnings.edgeEndpointUnknown',
}

// Legacy imports stored plain English messages without codes; recognize them
// (same templates commands/data_transfer_commands.py emits) so old summaries
// localize too. Unmatched text falls back as-is.
const LEGACY_WARNING_PATTERNS: Array<{
  pattern: RegExp
  code: string
  params: (m: RegExpMatchArray) => Record<string, unknown>
}> = [
  {
    pattern: /^No default embedding model configured here; imported vectors may not match newly generated ones$/,
    code: 'noDefaultEmbeddingModel',
    params: () => ({}),
  },
  {
    pattern: /^Package was embedded with (.+) but this environment defaults to (.+); similarity search may be inconsistent$/,
    code: 'embeddingModelMismatch',
    params: (m) => ({ packageModel: m[1], currentModel: m[2] }),
  },
  {
    pattern: /^Package embedding dimension (\d+) differs from this environment's dominant dimension (\d+)$/,
    code: 'embeddingDimensionMismatch',
    params: (m) => ({ packageDimension: m[1], currentDimension: m[2] }),
  },
  {
    pattern: /^(.+): dropped field '(.+)' \(not in whitelist\)$/,
    code: 'droppedField',
    params: (m) => ({ table: m[1], field: m[2] }),
  },
  {
    pattern: /^(.+): unparseable (.+), using database default$/,
    code: 'unparseableDatetime',
    params: (m) => ({ table: m[1], field: m[2] }),
  },
  {
    pattern: /^Transformation model\(s\) not found in this environment: (.+)$/,
    code: 'transformationModelMissing',
    params: (m) => ({ models: m[1] }),
  },
  {
    pattern: /^Transformation '(.+)' exists with a different prompt; kept the local version$/,
    code: 'transformationPromptConflict',
    params: (m) => ({ title: m[1] }),
  },
  {
    pattern: /^Package file (.+) listed in manifest but missing; source (.+) keeps asset\.url$/,
    code: 'manifestFileMissing',
    params: (m) => ({ file: m[1], sourceId: m[2] }),
  },
  {
    pattern: /^sha256 mismatch for (.+); file skipped, source (.+) keeps asset\.url$/,
    code: 'fileChecksumMismatch',
    params: (m) => ({ file: m[1], sourceId: m[2] }),
  },
  {
    pattern: /^Skipped (\w+) edge (.+?) -> (.+?): in endpoint was not imported this run$/,
    code: 'edgeEndpointNotImported',
    params: (m) => ({ edge: m[1], source: m[2], target: m[3] }),
  },
  {
    pattern: /^Skipped (\w+) edge (.+?) -> (.+?): endpoint not in package or database$/,
    code: 'edgeEndpointUnknown',
    params: (m) => ({ edge: m[1], source: m[2], target: m[3] }),
  },
]

function localizeLegacyWarning(
  raw: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  for (const { pattern, code, params } of LEGACY_WARNING_PATTERNS) {
    const match = raw.match(pattern)
    if (!match) continue
    const key = WARNING_KEYS[code]
    if (!key) return raw
    const text = t(key, params(match))
    return text === key ? raw : text
  }
  return raw
}

// Localized warning lines: structured codes win; raw English text from older
// imports (or unmapped codes) falls back as-is.
function displayWarnings(
  summary: ImportSummary,
  t: (key: string, options?: Record<string, unknown>) => string
): string[] {
  if (summary.warning_codes?.length) {
    return summary.warning_codes.map((warning, i) => {
      const key = WARNING_KEYS[warning.code]
      if (!key) return summary.warnings[i] ?? warning.code
      const text = t(key, warning.params ?? {})
      return text === key ? summary.warnings[i] ?? warning.code : text
    })
  }
  return summary.warnings.map((raw) => localizeLegacyWarning(raw, t))
}

export function ImportCard() {
  const { t } = useTranslation()
  const { data } = useImportStatus()
  const uploadImport = useUploadImportPackage()

  const [file, setFile] = useState<File | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
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

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
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
                  {displayWarnings(summary, t).map((warning, i) => (
                    <li key={i}>{warning}</li>
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
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
                dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
              )}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">{t('dataManagement.import.chooseFileButton')}</span>
              <span className="text-xs text-muted-foreground">
                {t('dataManagement.import.dropzoneHint')}
              </span>
              {/* sr-only: the label itself is the visible, clickable affordance;
                  the input keeps the accessible name for tests/screen readers. */}
              <input
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                aria-label={t('dataManagement.import.chooseFile')}
                className="sr-only"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
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
              {file && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileArchive className="h-4 w-4" />
                  {file.name} ({formatBytes(file.size)})
                </p>
              )}
            </div>
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

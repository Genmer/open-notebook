'use client'

import { Check, Loader2, X } from 'lucide-react'

import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

// Full i18n keys are carried per stage (not built from a prefix) so the
// locale unused-key scanner can see every literal key.
export interface TransferStage {
  id: string
  labelKey: string
}

interface TransferStageListProps {
  stages: readonly TransferStage[]
  /** Backend stage id; unknown ids highlight nothing (the message line carries the detail). */
  current?: string
  failed?: boolean
  /** Last detail per stage id from the backend; drives per-row result stats. */
  stageStats?: Record<string, Record<string, unknown>> | null
}

// Stage ids whose done-state stat is a file or chunk total (i18n'd unit).
const FILE_STAT_STAGES = new Set(['copying_files', 'files'])
const CHUNK_STAT_STAGES = new Set(['exporting_embeddings', 'embeddings'])

export function TransferStageList({
  stages,
  current,
  failed,
  stageStats,
}: TransferStageListProps) {
  const { t } = useTranslation()
  const currentIndex = current ? stages.findIndex((stage) => stage.id === current) : -1

  return (
    <ol className="space-y-1">
      {stages.map((stage, index) => {
        const isDone = currentIndex >= 0 && index < currentIndex
        const isCurrent = stage.id === current
        const stat = stageStats?.[stage.id]
        let statText: string | null = null
        if (stat && typeof stat.current === 'number' && typeof stat.total === 'number') {
          if (isCurrent && !failed) statText = `${stat.current}/${stat.total}`
        }
        if (!statText && !isCurrent && stat && typeof stat.total === 'number') {
          if (FILE_STAT_STAGES.has(stage.id)) {
            statText = t('dataManagement.activity.statFiles', { count: stat.total })
          } else if (CHUNK_STAT_STAGES.has(stage.id)) {
            statText = t('dataManagement.activity.statChunks', { count: stat.total })
          }
        }

        return (
          <li
            key={stage.id}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1 text-sm',
              isCurrent && !failed && 'bg-muted font-medium',
              isCurrent && failed && 'bg-destructive-tint font-medium text-destructive',
              !isCurrent && !isDone && 'text-muted-foreground'
            )}
          >
            {isDone ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-fern" />
            ) : isCurrent ? (
              failed ? (
                <X className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              )
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
            )}
            {t(stage.labelKey)}
            {statText && (
              <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                {statText}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// Full i18n keys per summary table key (scanner-visible); unknown keys fall
// back to the raw table name.
const TABLE_LABEL_KEYS: Record<string, string> = {
  notebook: 'dataManagement.tables.notebook',
  transformation: 'dataManagement.tables.transformation',
  source_view: 'dataManagement.tables.source_view',
  source_group: 'dataManagement.tables.source_group',
  source: 'dataManagement.tables.source',
  source_insight: 'dataManagement.tables.source_insight',
  note: 'dataManagement.tables.note',
  reference: 'dataManagement.tables.reference',
  artifact: 'dataManagement.tables.artifact',
  source_group_member: 'dataManagement.tables.source_group_member',
  source_embedding: 'dataManagement.tables.source_embedding',
  refers_to: 'dataManagement.tables.refers_to',
  annotation_settings: 'dataManagement.tables.annotation_settings',
  source_annotation: 'dataManagement.tables.source_annotation',
  content_settings: 'dataManagement.tables.content_settings',
  default_prompts: 'dataManagement.tables.default_prompts',
  credential: 'dataManagement.tables.credential',
  model: 'dataManagement.tables.model',
  default_models: 'dataManagement.tables.default_models',
  files: 'dataManagement.tables.files',
}

type TFn = (key: string, options?: Record<string, unknown>) => string

/** Localized display name for a transfer summary table/count key. */
export function tableLabel(t: TFn, key: string): string {
  const i18nKey = TABLE_LABEL_KEYS[key]
  return i18nKey ? t(i18nKey) : key
}

/** Localized transfer duration ("x seconds" / "x min y s"). */
export function formatDuration(seconds: number, t: TFn): string {
  if (seconds >= 90) {
    const minutes = Math.floor(seconds / 60)
    const rest = Math.round(seconds % 60)
    return t('dataManagement.activity.durationMin', { minutes, seconds: rest })
  }
  return t('dataManagement.activity.durationSec', { count: Math.round(seconds) })
}

interface TransferProgressInfo {
  stage?: string
  message?: string
  detail?: Record<string, unknown> | null
}

// Literal key map (scanner-visible), matched against backend stage ids.
const ACTIVITY_KEYS: Record<string, string> = {
  collecting: 'dataManagement.activity.collecting',
  exporting_tables: 'dataManagement.activity.exportingTable',
  copying_files: 'dataManagement.activity.copyingFiles',
  exporting_embeddings: 'dataManagement.activity.exportingEmbeddings',
  metadata: 'dataManagement.activity.writingTable',
  files: 'dataManagement.activity.restoringFiles',
  relations: 'dataManagement.activity.linkingTable',
}

/**
 * Localized live activity line for a running transfer. Structured backend
 * detail ({table,current,total,item}) wins; otherwise the current stage's
 * localized label; otherwise the backend's raw English message. Key presence
 * per locale is enforced by the locale parity tests, not guarded here.
 */
export function TransferActivity({
  progress,
  stageLabels,
  fallbackLabel,
}: {
  progress: TransferProgressInfo
  stageLabels: Record<string, string>
  fallbackLabel: string
}) {
  const { t } = useTranslation()
  const detail = progress.detail
  const key = progress.stage ? ACTIVITY_KEYS[progress.stage] : undefined

  let text: string | undefined
  if (key && detail) text = t(key, detail as Record<string, unknown>)
  if (!text && progress.stage) text = stageLabels[progress.stage]
  if (!text) text = progress.message || fallbackLabel

  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {text}
    </p>
  )
}

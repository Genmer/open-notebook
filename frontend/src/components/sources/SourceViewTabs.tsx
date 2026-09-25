'use client'

import { useState, type ReactNode } from 'react'
import { CheckCircle2, Loader2, MoreVertical, Pencil, Plus, Sparkles, Trash2, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ClassifyProgress, SourceViewResponse } from '@/lib/types/api'
import { FILE_TYPE_VIEW_ID } from '@/lib/stores/source-view-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { displayViewName } from '@/lib/utils/view-display'
import { cn } from '@/lib/utils'

interface SourceViewTabsProps {
  views: SourceViewResponse[]
  activeViewId: string
  isLoading?: boolean
  onSelectView: (id: string) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onClassify?: (id: string) => void
}

type DialogMode = { kind: 'create' } | { kind: 'rename'; view: SourceViewResponse } | null

const isAiView = (view: SourceViewResponse) =>
  view.is_default || view.view_type.startsWith('ai_')

const STAGE_LABEL_KEYS: Record<string, string> = {
  clustering: 'sources.grouping.classify.stageClustering',
  llm: 'sources.grouping.classify.stageLlm',
  assigning: 'sources.grouping.classify.stageAssigning',
}

export function SourceViewTabs({
  views,
  activeViewId,
  isLoading = false,
  onSelectView,
  onCreate,
  onRename,
  onDelete,
  onClassify,
}: SourceViewTabsProps) {
  const { t } = useTranslation()
  const [dialog, setDialog] = useState<DialogMode>(null)
  const [nameInput, setNameInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SourceViewResponse | null>(null)
  const [classifyTarget, setClassifyTarget] = useState<SourceViewResponse | null>(null)
  const [dismissedStages, setDismissedStages] = useState<Record<string, string>>({})

  const openDialog = (mode: DialogMode) => {
    setDialog(mode)
    setNameInput(mode?.kind === 'rename' ? mode.view.name : '')
  }

  const submitDialog = () => {
    const name = nameInput.trim()
    if (!name || !dialog) return
    if (dialog.kind === 'create') onCreate(name)
    else onRename(dialog.view.id, name)
    setDialog(null)
  }

  const activeView = views.find((view) => view.id === activeViewId)
  const progress = activeView?.classify_progress ?? null

  // 三段家族：手动 custom / AI 自动 / 文件类型（虚拟 tab），命名规则"带『按』字的是机器给的"
  const customViews = views.filter((view) => !isAiView(view))
  const aiViews = views.filter(isAiView)
  const mineHint = t('sources.grouping.familyMineHint')
  const aiHint = t('sources.grouping.familyAiHint')
  const fileTypeHint = t('sources.grouping.familyFileTypeHint')
  const activeHint =
    activeViewId === FILE_TYPE_VIEW_ID
      ? fileTypeHint
      : activeView && isAiView(activeView)
        ? aiHint
        : activeView
          ? mineHint
          : null

  return (
    <div data-testid="source-view-tabs">
      <div className="mb-2 flex flex-shrink-0 items-end gap-5 border-b">
        <TabSegment label={t('sources.grouping.familyMine')} data-testid="family-segment-mine">
          {customViews.map((view) => (
            <div key={view.id} className="relative flex items-center">
              <TabButton
                label={displayViewName(view, t)}
                title={mineHint}
                active={activeViewId === view.id}
                onClick={() => onSelectView(view.id)}
              />
              {activeViewId === view.id && (
                <ViewOptionsButton view={view} onRename={() => openDialog({ kind: 'rename', view })} onDelete={() => setDeleteTarget(view)} />
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            disabled={isLoading}
            onClick={() => openDialog({ kind: 'create' })}
            aria-label={t('sources.grouping.addView')}
            title={mineHint}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TabSegment>
        <TabSegment label={t('sources.grouping.familyAi')} data-testid="family-segment-ai">
          {aiViews.map((view) => (
            <div key={view.id} className="relative flex items-center">
              <TabButton
                label={displayViewName(view, t)}
                title={aiHint}
                active={activeViewId === view.id}
                onClick={() => onSelectView(view.id)}
              />
              {onClassify && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  disabled={isClassifying(view.classify_progress)}
                  aria-label={`${t('sources.grouping.classify.button')}: ${view.name}`}
                  title={aiHint}
                  onClick={() => setClassifyTarget(view)}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </Button>
              )}
              {activeViewId === view.id && (
                <ViewOptionsButton view={view} onRename={() => openDialog({ kind: 'rename', view })} onDelete={() => setDeleteTarget(view)} />
              )}
            </div>
          ))}
        </TabSegment>
        <TabSegment label={t('sources.grouping.familyFileType')} data-testid="family-segment-filetype">
          <TabButton
            label={t('sources.grouping.fileTypeTab')}
            title={fileTypeHint}
            active={activeViewId === FILE_TYPE_VIEW_ID}
            onClick={() => onSelectView(FILE_TYPE_VIEW_ID)}
          />
        </TabSegment>
      </div>

      {activeHint && (
        <p className="mb-3 text-xs text-muted-foreground" data-testid="active-family-hint">
          {activeHint}
        </p>
      )}

      {progress && isClassifying(progress) && (
        <div
          data-testid="classify-progress"
          className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {t(STAGE_LABEL_KEYS[progress.stage] ?? 'sources.grouping.classify.progressRunning')}
          </span>
          <span>{progress.percent}%</span>
        </div>
      )}

      {progress && isTerminal(progress) && dismissedStages[activeViewId] !== progress.stage && (
        <div
          data-testid="classify-progress"
          className={cn(
            'mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
            progress.stage === 'failed' ? 'border-destructive text-destructive' : 'text-muted-foreground'
          )}
        >
          {progress.stage === 'failed' ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">
            {progress.stage === 'done'
              ? t('sources.grouping.classify.doneSummary', {
                  groups: progress.groups_created ?? 0,
                  sources: progress.sources_classified ?? 0,
                  unclassified: progress.unclassified ?? 0,
                })
              : progress.error || t('sources.grouping.classify.failed')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-5 w-5 shrink-0"
            aria-label={t('common.close')}
            onClick={() =>
              setDismissedStages((prev) => ({ ...prev, [activeViewId]: progress.stage }))
            }
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === 'rename'
                ? t('sources.grouping.renameViewTitle')
                : t('sources.grouping.addViewTitle')}
            </DialogTitle>
            <DialogDescription>{t('sources.grouping.viewNameDesc')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={nameInput}
            maxLength={100}
            placeholder={t('sources.grouping.viewNamePlaceholder')}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitDialog()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!nameInput.trim()} onClick={submitDialog}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('sources.grouping.deleteViewTitle', { name: deleteTarget?.name ?? '' })}
        description={t('sources.grouping.deleteViewDesc')}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />

      <ConfirmDialog
        open={classifyTarget !== null}
        onOpenChange={(open) => !open && setClassifyTarget(null)}
        title={t('sources.grouping.classify.confirmTitle')}
        description={t('sources.grouping.classify.confirmDescription', {
          name: classifyTarget?.name ?? '',
        })}
        confirmText={t('sources.grouping.classify.confirmCta')}
        onConfirm={() => {
          if (classifyTarget) onClassify?.(classifyTarget.id)
          setClassifyTarget(null)
        }}
      />
    </div>
  )
}

const isClassifying = (progress: ClassifyProgress | null | undefined) =>
  !!progress && ['clustering', 'llm', 'assigning'].includes(progress.stage)

const isTerminal = (progress: ClassifyProgress) =>
  progress.stage === 'done' || progress.stage === 'failed'

function ViewOptionsButton({
  view,
  onRename,
  onDelete,
}: {
  view: SourceViewResponse
  onRename: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-0.5 h-6 w-6 text-muted-foreground"
          aria-label={t('sources.grouping.viewOptions')}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-4 w-4" />
          {t('common.edit')}
        </DropdownMenuItem>
        {!view.is_default && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 家族段：小字标签 + 一排 tab。label/hint 让四套同质 tab 变成三段可解释的结构。
function TabSegment({
  label,
  children,
  'data-testid': testId,
}: {
  label: string
  children: ReactNode
  'data-testid'?: string
}) {
  return (
    <section className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </section>
  )
}

function TabButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string
  title?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'relative px-3 py-2 text-sm font-medium transition-colors',
        'border-b-2 -mb-px',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}

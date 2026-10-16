'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Check,
  ChevronDown,
  FileText,
  Layers,
  Lightbulb,
  Plus,
  SlidersHorizontal,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toast } from 'sonner'
import {
  ContextCombo,
  ContextComboModes,
  CONTEXT_COMBOS_CHANGED_EVENT,
  listCombos,
  saveCombo,
  deleteCombo,
  computeComboReplacement,
  ensureDefaultCombo,
  getActiveCombo,
  setActiveComboId,
  selectionsMatchCombo,
  updateCombo,
} from '@/lib/notebooks/context-combos'
import type { SourceListResponse, NoteResponse } from '@/lib/types/api'
import type { ContextSelections } from '@/lib/types/notebook-context'

interface ContextIndicatorProps {
  sourcesInsights: number
  sourcesFull: number
  notesCount: number
  tokenCount?: number
  charCount?: number
  className?: string
  /** When set, the context bar row itself and the manage icon open the context picker. */
  onOpenPicker?: () => void
  /** Notebook ID for local-storage combo binding. */
  notebookId?: string
  /** Flag indicating combos are enabled (hidden in single-folder scope). */
  combosEnabled?: boolean
  /** Handler to apply a combo replacement at page level. */
  onApplyCombo?: (replacement: ContextSelections, comboId?: string | null) => void
  /** Current context selections (for matching and saving). */
  contextSelections?: ContextSelections
  /** Current full sources pool (for computing valid items). */
  sources?: SourceListResponse[]
  /** Current notes pool (for computing valid items). */
  notes?: NoteResponse[]
}

// Helper function to format large numbers with K/M suffixes
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toString()
}

export function ContextIndicator({
  sourcesInsights,
  sourcesFull,
  notesCount,
  tokenCount,
  charCount,
  className,
  onOpenPicker,
  notebookId,
  combosEnabled = false,
  onApplyCombo,
  contextSelections,
  sources = [],
  notes = [],
}: ContextIndicatorProps) {
  const { t } = useTranslation()
  const hasContext = (sourcesInsights + sourcesFull) > 0 || notesCount > 0

  // ── Combo state & persistence ─────────────────────────────────────────────
  const [combos, setCombos] = useState<ContextCombo[]>([])
  const [comboToDelete, setComboToDelete] = useState<ContextCombo | null>(null)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [newComboName, setNewComboName] = useState('')

  const reloadCombos = useCallback(() => {
    if (notebookId && combosEnabled) {
      setCombos(listCombos(notebookId))
    } else {
      setCombos([])
    }
  }, [notebookId, combosEnabled])

  useEffect(() => {
    reloadCombos()
  }, [reloadCombos])

  // 其他表面（弹窗/页面）写组合存储后广播：重读以免触发按钮滞留旧标签
  useEffect(() => {
    if (!combosEnabled || !notebookId) return
    const handleCombosChanged = () => reloadCombos()
    window.addEventListener(CONTEXT_COMBOS_CHANGED_EVENT, handleCombosChanged)
    return () =>
      window.removeEventListener(CONTEXT_COMBOS_CHANGED_EVENT, handleCombosChanged)
  }, [combosEnabled, notebookId, reloadCombos])

  // Count of surviving items in a combo given current available sources & notes
  const survivingCount = useCallback(
    (combo: ContextCombo) => {
      const currentSourceIds = new Set(sources.map((s) => s.id))
      const currentNoteIds = new Set(notes.map((n) => n.id))
      const sCount = Object.keys(combo.sources).filter((id) => currentSourceIds.has(id)).length
      const nCount = Object.keys(combo.notes).filter((id) => currentNoteIds.has(id)).length
      return sCount + nCount
    },
    [sources, notes]
  )

  // Current active selections eligible for saving (must have at least one non-off item)
  const hasSelectionToSave = useMemo(() => {
    if (!contextSelections) return false
    const sHas = Object.values(contextSelections.sources).some((m) => m && m !== 'off')
    const nHas = Object.values(contextSelections.notes).some((m) => m && m !== 'off')
    return sHas || nHas
  }, [contextSelections])

  // 激活组合状态（含 dirty）。不变量：dirty 落盘必伴随 selections 变更或
  // reloadCombos，所以把这些一并放进依赖触发重读
  const activeComboState = useMemo(
    () => (notebookId ? getActiveCombo(notebookId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 多余依赖是有意的重读触发器
    [notebookId, combos, contextSelections, sources, notes]
  )
  const activeCombo = activeComboState
    ? combos.find((c) => c.id === activeComboState.id) ?? null
    : null
  // 已修改用现场失配判定：分页/新上传来源被默认填充后标签与更新入口立即反映；
  // 持久 dirty 位只留给 page 挂载恢复分流。池取并集口径（同 page 的对账）：
  // 弹窗（全量树）里勾的分页外来源也要参与比对，否则与弹窗的判定互相矛盾
  const comboDirty =
    !!activeCombo &&
    !!contextSelections &&
    !selectionsMatchCombo(
      contextSelections,
      activeCombo,
      new Set([
        ...sources.map((s) => s.id),
        ...Object.keys(contextSelections.sources),
        ...Object.keys(activeCombo.sources),
      ]),
      new Set([
        ...notes.map((n) => n.id),
        ...Object.keys(contextSelections.notes),
        ...Object.keys(activeCombo.notes),
      ])
    )
  // 默认组合的存储名是占位符，永不直接渲染
  const displayName = (combo: ContextCombo) =>
    combo.isDefault ? t('chat.contextComboDefaultName') : combo.name

  // Recognize which saved combo matches current selections exactly, comparing
  // only entries that survive in the current pools: a combo item deleted from
  // the notebook (or not yet paginated in) must not fail the whole match. The
  // combo recorded as active wins when it still matches, so identical-looking
  // combos are disambiguated by the active memory instead of list order.
  const matchedCombo = useMemo(() => {
    if (!contextSelections || !notebookId) return null
    const currentSourceIds = new Set(sources.map((s) => s.id))
    const currentNoteIds = new Set(notes.map((n) => n.id))
    const active = activeComboState
      ? combos.find((c) => c.id === activeComboState.id) ?? null
      : null
    if (
      active &&
      selectionsMatchCombo(contextSelections, active, currentSourceIds, currentNoteIds)
    ) {
      return active
    }
    return (
      combos.find(
        (c) => selectionsMatchCombo(contextSelections, c, currentSourceIds, currentNoteIds)
      ) ?? null
    )
  }, [contextSelections, combos, notebookId, sources, notes, activeComboState])
  // 下拉勾选判定：激活组合优先，其次内容匹配，最后无高亮
  const currentComboId = activeCombo?.id ?? matchedCombo?.id ?? null

  // Apply a combo
  const handleApply = (combo: ContextCombo) => {
    if (!onApplyCombo || !notebookId) return
    const sourceIds = new Set(sources.map((s) => s.id))
    const noteIds = new Set(notes.map((n) => n.id))
    const replacement = computeComboReplacement(
      combo,
      sourceIds,
      noteIds,
      contextSelections ?? { sources: {}, notes: {} }
    )
    setActiveComboId(notebookId, combo.id)
    onApplyCombo(replacement, combo.id)
    toast.success(t('chat.contextComboApplied', { name: displayName(combo) }))
  }

  // 更新当前组合：用当前勾选覆盖激活组合的快照（默认组合不可更新）
  const handleUpdateActiveCombo = () => {
    if (!notebookId || !activeComboState || !activeCombo) return
    const modes: ContextComboModes = { sources: {}, notes: {} }
    for (const [id, mode] of Object.entries(contextSelections?.sources ?? {})) {
      if (mode && mode !== 'off') modes.sources[id] = mode
    }
    for (const [id, mode] of Object.entries(contextSelections?.notes ?? {})) {
      if (mode && mode !== 'off') modes.notes[id] = mode
    }
    const updated = updateCombo(notebookId, activeCombo.id, modes)
    if (!updated) {
      toast.error(t('chat.contextComboSaveFailed'))
      return
    }
    reloadCombos()
    toast.success(t('chat.contextComboUpdated', { name: displayName(updated) }))
  }

  // Save current selections as a new combo
  const handleSave = () => {
    if (!notebookId || !newComboName.trim() || !contextSelections) return
    const modes: ContextComboModes = { sources: {}, notes: {} }
    for (const [id, mode] of Object.entries(contextSelections.sources)) {
      if (mode && mode !== 'off') modes.sources[id] = mode
    }
    for (const [id, mode] of Object.entries(contextSelections.notes)) {
      if (mode && mode !== 'off') modes.notes[id] = mode
    }
    const saved = saveCombo(notebookId, newComboName.trim(), modes)
    if (!saved) {
      toast.error(t('chat.contextComboSaveFailed'))
      return
    }
    // 保存即激活
    setActiveComboId(notebookId, saved.id)
    reloadCombos()
    setNewComboName('')
    setSaveDialogOpen(false)
    toast.success(t('chat.contextComboSaved', { name: saved.name }))
  }

  // Delete a combo
  const handleDelete = () => {
    if (!notebookId || !comboToDelete) return
    deleteCombo(notebookId, comboToDelete.id)
    reloadCombos()
    toast.success(t('chat.contextComboDeleted'))
    setComboToDelete(null)
  }

  // ── Badges & token counters ───────────────────────────────────────────────
  const badges = hasContext && (
    <div className="flex items-center gap-1.5">
      {sourcesInsights > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-xs flex items-center gap-1 px-1.5 py-0.5 text-ctx-insights border-ctx-insights/50 cursor-default"
            >
              <Lightbulb className="h-3 w-3" />
              <span>{sourcesInsights}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('chat.contextInsightsTooltip', { count: sourcesInsights })}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {sourcesFull > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-xs flex items-center gap-1 px-1.5 py-0.5 text-ctx-full border-ctx-full/50 cursor-default"
            >
              <FileText className="h-3 w-3" />
              <span>{sourcesFull}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('chat.contextFullTooltip', { count: sourcesFull })}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {notesCount > 0 && (
        <>
          {(sourcesInsights > 0 || sourcesFull > 0) && (
            <span className="text-muted-foreground">•</span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-xs flex items-center gap-1 px-1.5 py-0.5 text-ctx-full border-ctx-full/50 cursor-default"
              >
                <StickyNote className="h-3 w-3" />
                <span>{notesCount}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('chat.contextNotesTooltip', { count: notesCount })}</p>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )

  const tokenSummary =
    (tokenCount !== undefined || charCount !== undefined) && (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {tokenCount !== undefined && tokenCount > 0 && (
          <span>{t('chat.contextTokens', { value: formatNumber(tokenCount) })}</span>
        )}
        {tokenCount !== undefined &&
          charCount !== undefined &&
          tokenCount > 0 &&
          charCount > 0 && <span>/</span>}
        {charCount !== undefined && charCount > 0 && (
          <span>{t('chat.contextChars', { value: formatNumber(charCount) })}</span>
        )}
      </div>
    )

  // ── Render mode 1: Read-only (e.g. single-source chat) ────────────────────
  if (!onOpenPicker && !combosEnabled) {
    if (!hasContext) {
      return (
        <div
          className={cn(
            'flex-shrink-0 text-xs text-muted-foreground py-2 px-3 border-t',
            className
          )}
        >
          {t('chat.contextEmptyReadOnly')}
        </div>
      )
    }
    return (
      <div
        className={cn(
          'flex-shrink-0 flex items-center justify-between gap-2 py-2 px-3 border-t bg-muted/30',
          className
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('chat.contextLabel')}
          </span>
          {badges}
        </div>
        {tokenSummary}
      </div>
    )
  }

  // ── Render mode 2: Interactive context bar with combos dropdown ───────────
  // 整行作为打开上下文选择器的入口：仅当 onOpenPicker 存在时升级为可点击按钮
  const handleBarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpenPicker?.()
    }
  }

  return (
    <>
      <div
        data-testid="context-indicator-bar"
        role={onOpenPicker ? 'button' : undefined}
        tabIndex={onOpenPicker ? 0 : undefined}
        aria-label={onOpenPicker ? t('chat.contextPickerOpen') : undefined}
        className={cn(
          'group flex w-full flex-shrink-0 items-center justify-between gap-2 border-t bg-muted/30 py-1.5 px-3 transition-colors hover:bg-muted/40',
          onOpenPicker &&
            'cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className
        )}
        onClick={onOpenPicker}
        onKeyDown={onOpenPicker ? handleBarKeyDown : undefined}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex-shrink-0 text-xs font-medium text-muted-foreground">
            {t('chat.contextLabel')}
          </span>

          {/* Quick Combo Switcher Dropdown (in-place on the context bar) */}
          {combosEnabled && !!notebookId && !!onApplyCombo && (
            <DropdownMenu onOpenChange={(open) => open && reloadCombos()}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="context-combo-dropdown-trigger"
                  className="h-6 gap-1 px-2 text-xs font-normal bg-background/80 hover:bg-background border-border/80 shadow-none shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Layers className="h-3 w-3 text-muted-foreground" />
                  <span className="max-w-[120px] truncate font-medium">
                    {activeCombo
                      ? comboDirty
                        ? t('chat.contextComboActiveModifiedLabel', {
                            name: displayName(activeCombo),
                          })
                        : `${t('chat.contextComboPrefix')}${displayName(activeCombo)}`
                      : matchedCombo
                        ? `${t('chat.contextComboPrefix')}${displayName(matchedCombo)}`
                        : t('chat.contextCombosMenuLabel')}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 p-1">
                <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
                  {t('chat.contextCombosTitle')}
                </DropdownMenuLabel>
                {(() => {
                  const defaultCombo = combos.find((c) => c.isDefault)
                  const isDefaultCurrent =
                    defaultCombo != null && currentComboId === defaultCombo.id
                  return (
                    <DropdownMenuItem
                      data-testid="context-combo-default-entry"
                      className="text-xs gap-1.5 cursor-pointer"
                      onSelect={() => {
                        if (!notebookId) return
                        const def = ensureDefaultCombo(notebookId)
                        if (!def) {
                          toast.error(t('chat.contextComboSaveFailed'))
                          return
                        }
                        reloadCombos()
                        handleApply(def)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isDefaultCurrent ? (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span>{t('chat.contextComboDefaultEntry')}</span>
                    </DropdownMenuItem>
                  )
                })()}
                {combos.filter((c) => !c.isDefault).length === 0 ? (
                  <div
                    data-testid="context-combos-empty-hint"
                    className="px-2 py-2 text-xs text-muted-foreground text-center"
                  >
                    {t('chat.contextCombosEmpty')}
                  </div>
                ) : (
                  combos
                    .filter((c) => !c.isDefault)
                    .map((combo) => {
                      const isCurrent = combo.id === currentComboId
                      return (
                        <div
                          key={combo.id}
                          data-testid={`context-combo-item-${combo.id}`}
                          className="flex items-center justify-between rounded-sm px-2 py-1.5 text-xs hover:bg-muted cursor-pointer group/item"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleApply(combo)
                          }}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {isCurrent ? (
                              <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                            ) : (
                              <span className="w-3.5 shrink-0" />
                            )}
                            <span
                              className={cn(
                                'truncate',
                                isCurrent && 'font-medium text-foreground'
                              )}
                            >
                              {combo.name}
                            </span>
                            <Badge
                              variant="secondary"
                              className="text-[10px] h-4 px-1 shrink-0 font-normal ml-auto"
                            >
                              {t('chat.contextComboCount', { count: survivingCount(combo) })}
                            </Badge>
                          </div>
                          <button
                            type="button"
                            title={t('chat.contextComboDeleteTitle')}
                            aria-label={t('chat.contextComboDeleteTitle')}
                            data-testid={`delete-combo-${combo.id}`}
                            className="opacity-0 group-hover/item:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-opacity shrink-0 ml-1.5"
                            onClick={(e) => {
                              e.stopPropagation()
                              setComboToDelete(combo)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    })
                )}
                <DropdownMenuSeparator />
                {activeCombo && !activeCombo.isDefault && (
                  <DropdownMenuItem
                    data-testid="context-combo-update-current"
                    className="text-xs gap-1.5 cursor-pointer"
                    disabled={!comboDirty}
                    onSelect={handleUpdateActiveCombo}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>
                      {t('chat.contextComboUpdateCurrent', {
                        name: displayName(activeCombo),
                      })}
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  data-testid="context-combo-save-as-new"
                  className="text-xs gap-1.5 cursor-pointer"
                  disabled={!hasSelectionToSave}
                  onSelect={() => {
                    setNewComboName('')
                    setSaveDialogOpen(true)
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('chat.contextComboSaveAsNew')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {hasContext ? (
            badges
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              {t('chat.contextEmpty')}
            </span>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {hasContext && tokenSummary}
          {onOpenPicker && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="open-context-picker-button"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onOpenPicker()
              }}
              title={t('chat.contextPickerOpen')}
              aria-label={t('chat.contextPickerOpen')}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 opacity-60 hover:opacity-100 transition-opacity" />
            </Button>
          )}
        </div>
      </div>

      {/* Save Combo Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('chat.contextComboSaveDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('chat.contextComboSaveDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              data-testid="new-combo-name-input"
              value={newComboName}
              onChange={(e) => setNewComboName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newComboName.trim()) {
                  e.preventDefault()
                  handleSave()
                }
              }}
              placeholder={t('chat.contextComboNamePlaceholder')}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              data-testid="confirm-save-combo-button"
              disabled={!newComboName.trim() || !hasSelectionToSave}
              onClick={handleSave}
            >
              {t('chat.contextComboSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Combo Confirm Dialog */}
      <ConfirmDialog
        open={comboToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setComboToDelete(null)
        }}
        title={t('chat.contextComboDeleteTitle')}
        description={
          comboToDelete
            ? t('chat.contextComboDeleteDesc', { name: comboToDelete.name })
            : ''
        }
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleDelete}
      />
    </>
  )
}

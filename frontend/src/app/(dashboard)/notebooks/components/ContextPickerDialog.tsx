'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, ChevronRight, Folder, ListChecks, Loader2, StickyNote, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import { readFolderOverrides, setFolderOverride } from '@/lib/notebooks/folder-collapse'
import {
  computeComboReplacement,
  deleteCombo,
  ensureDefaultCombo,
  getActiveCombo,
  listCombos,
  saveCombo,
  selectionsMatchCombo,
  updateCombo,
  type ContextCombo,
} from '@/lib/notebooks/context-combos'
import { ContextToggle } from '@/components/common/ContextToggle'
import { buildGroupTree, GroupNode } from '@/lib/utils/group-tree'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { SourceListResponse } from '@/lib/types/api'
import type {
  ContextMode,
  ContextSelections,
  ContextTreeGroup,
  NoteContextMode,
} from '@/lib/types/notebook-context'
import type { SourceBulkAction } from '@/lib/utils/source-context'

interface ContextPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  viewId: string | null | undefined
  sources: SourceListResponse[]
  notes: Array<{ id: string; title: string | null }>
  selections: ContextSelections
  onSourceModeChange: (sourceId: string, mode: ContextMode) => void
  onFolderApply: (
    items: Array<{ id: string; insights_count: number }>,
    action: SourceBulkAction,
  ) => void
  onNoteModeChange: (noteId: string, mode: NoteContextMode) => void
  onClearAll: () => void
  /** 缺省 false=组合区块隐藏（文件夹范围下由 page 关闭） */
  combosEnabled?: boolean
  onApplyCombo?: (replacement: ContextSelections, comboId?: string | null) => void
}

interface PickerSource {
  id: string
  title: string | null
  insights_count: number
}

const asSourceGroupResponse = (g: ContextTreeGroup) => ({
  id: g.id,
  view_id: '',
  name: g.name,
  parent_id: g.parent_id,
  source_count: 0,
  created: null,
  updated: null,
})

export function ContextPickerDialog({
  open,
  onOpenChange,
  notebookId,
  viewId,
  sources,
  notes,
  selections,
  onSourceModeChange,
  onFolderApply,
  onNoteModeChange,
  onClearAll,
  combosEnabled = false,
  onApplyCombo,
}: ContextPickerDialogProps) {
  const { t } = useTranslation()
  const treeQuery = useContextTree(notebookId, viewId, open)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  // 与来源列共用折叠记忆：挂载恢复 overrides；未触碰的文件夹保持恒默认展开
  useEffect(() => {
    setCollapsed(readFolderOverrides(notebookId))
  }, [notebookId])

  const toggleFolderCollapsed = (key: string) => {
    const next = !collapsed[key]
    setCollapsed(prev => ({ ...prev, [key]: next }))
    setFolderOverride(notebookId, key, next)
  }

  // 已存上下文组合：combos 只在弹窗打开且启用时读取；comboName 输入随开关重置
  const [combos, setCombos] = useState<ContextCombo[]>([])
  const [comboName, setComboName] = useState('')
  const [comboToDelete, setComboToDelete] = useState<ContextCombo | null>(null)

  useEffect(() => {
    if (open && combosEnabled) setCombos(listCombos(notebookId))
    setComboName('')
  }, [open, combosEnabled, notebookId])

  // 激活组合状态（含 dirty）。不变量：dirty 落盘必伴随 selections 变更或
  // setCombos 重读，所以两者都在依赖里触发重读
  const activeComboState = useMemo(
    () => (combosEnabled && open ? getActiveCombo(notebookId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 多余依赖是有意的重读触发器
    [combosEnabled, open, notebookId, selections, combos],
  )
  const activeCombo = activeComboState
    ? combos.find(c => c.id === activeComboState.id) ?? null
    : null
  // 默认组合的存储名是占位符，永不直接渲染
  const displayName = (combo: ContextCombo) =>
    combo.isDefault ? t('chat.contextComboDefaultName') : combo.name

  // Folder structure; degrades to a flat source list if the tree endpoint
  // fails (picker stays usable without folders).
  const treeGroups = useMemo(() => {
    if (treeQuery.data?.groups?.length) {
      return buildGroupTree(treeQuery.data.groups.map(asSourceGroupResponse))
    }
    return []
  }, [treeQuery.data?.groups])

  const memberBySource = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of treeQuery.data?.memberships ?? []) {
      if (!map.has(m.source_id)) map.set(m.source_id, m.group_id)
    }
    return map
  }, [treeQuery.data?.memberships])

  const pool: PickerSource[] = useMemo(() => {
    if (treeQuery.data?.sources?.length) {
      return treeQuery.data.sources
    }
    // Endpoint unavailable or still loading: the loaded scope list keeps the
    // picker functional (folders may simply be missing).
    if (treeQuery.isSuccess) return []
    return sources.map(s => ({
      id: s.id,
      title: s.title,
      insights_count: s.insights_count ?? 0,
    }))
  }, [treeQuery.data?.sources, treeQuery.isSuccess, sources])

  // The whole notebook (incl. sources the paginated listing has not loaded).
  const visibleSources = pool

  const modeOf = (id: string): ContextMode => selections.sources[id] ?? 'off'

  interface FolderRow {
    kind: 'folder'
    key: string
    node: GroupNode
    folders: FolderRow[]
    sources: PickerSource[]
  }

  const buildFolderRow = useCallback(
    (node: GroupNode): FolderRow => ({
      kind: 'folder',
      key: node.group.id,
      node,
      folders: node.children.map(buildFolderRow),
      sources: visibleSources.filter(s => memberBySource.get(s.id) === node.group.id),
    }),
    [visibleSources, memberBySource]
  )

  const folderRows = useMemo(() => treeGroups.map(buildFolderRow), [treeGroups, buildFolderRow])

  const groupedIds = useMemo(() => {
    const ids = new Set<string>()
    const walk = (rows: FolderRow[]) => {
      for (const row of rows) {
        row.sources.forEach(s => ids.add(s.id))
        walk(row.folders)
      }
    }
    walk(folderRows)
    return ids
  }, [folderRows])
  const ungroupedSources = useMemo(
    () => visibleSources.filter(s => !groupedIds.has(s.id)),
    [visibleSources, groupedIds]
  )

  const poolIds = useMemo(() => new Set(visibleSources.map(s => s.id)), [visibleSources])
  const comboNoteIds = useMemo(() => new Set(notes.map(n => n.id)), [notes])

  // 已修改用现场失配判定（同 ContextIndicator）：分页/新上传来源被默认填充后
  // 更新按钮立即反映；持久 dirty 位只留给 page 挂载恢复分流
  const comboDirty =
    !!activeCombo && !selectionsMatchCombo(selections, activeCombo, poolIds, comboNoteIds)

  const comboSurvivingCount = (combo: ContextCombo) =>
    Object.keys(combo.sources).filter(id => poolIds.has(id)).length +
    Object.keys(combo.notes).filter(id => comboNoteIds.has(id)).length

  const hasComboSelection =
    Object.values(selections.sources).some(mode => mode !== 'off') ||
    Object.values(selections.notes).some(mode => mode !== 'off')

  const handleSaveCombo = () => {
    // 组装模式快照（过滤 off 后交由 saveCombo 落盘）
    const modes = {
      sources: Object.fromEntries(
        Object.entries(selections.sources).filter(([, mode]) => mode !== 'off'),
      ),
      notes: Object.fromEntries(
        Object.entries(selections.notes).filter(([, mode]) => mode !== 'off'),
      ),
    }
    if (!hasComboSelection) {
      toast.error(t('chat.contextComboNothingSelected'))
      return
    }
    const saved = saveCombo(notebookId, comboName, modes)
    if (!saved) {
      toast.error(t('chat.contextComboSaveFailed'))
      return
    }
    setCombos(listCombos(notebookId))
    setComboName('')
    toast.success(t('chat.contextComboSaved', { name: saved.name }))
  }

  const handleApplyCombo = (combo: ContextCombo) => {
    onApplyCombo?.(computeComboReplacement(combo, poolIds, comboNoteIds, selections), combo.id)
    toast.success(t('chat.contextComboApplied'))
  }

  // 用当前勾选覆盖激活组合的快照（默认组合不可更新）
  const handleUpdateActiveCombo = () => {
    if (!activeCombo) return
    const modes = {
      sources: Object.fromEntries(
        Object.entries(selections.sources).filter(([, mode]) => mode !== 'off'),
      ),
      notes: Object.fromEntries(
        Object.entries(selections.notes).filter(([, mode]) => mode !== 'off'),
      ),
    }
    const updated = updateCombo(notebookId, activeCombo.id, modes)
    if (!updated) {
      toast.error(t('chat.contextComboSaveFailed'))
      return
    }
    setCombos(listCombos(notebookId))
    toast.success(t('chat.contextComboUpdated', { name: displayName(updated) }))
  }

  // 默认组合入口：幂等创建空组合后按整表替换应用（=清空全部勾选）
  const handleApplyDefaultCombo = () => {
    const def = ensureDefaultCombo(notebookId)
    if (!def) {
      toast.error(t('chat.contextComboSaveFailed'))
      return
    }
    setCombos(listCombos(notebookId))
    handleApplyCombo(def)
  }

  const handleDeleteCombo = () => {
    if (!comboToDelete) return
    deleteCombo(notebookId, comboToDelete.id)
    setCombos(listCombos(notebookId))
    setComboToDelete(null)
  }

  const query = search.trim().toLowerCase()
  const matches = (s: PickerSource) =>
    !query || (s.title ?? '').toLowerCase().includes(query)
  const folderHasMatch = (row: FolderRow): boolean =>
    row.sources.some(matches) || row.folders.some(folderHasMatch)

  const renderSourceRow = (source: PickerSource) => {
    const mode = modeOf(source.id)
    const checkboxId = `ctx-src-${source.id}`
    return (
      <div key={source.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={mode !== 'off'}
            onCheckedChange={checked => onSourceModeChange(source.id, checked === true ? 'full' : 'off')}
            className="h-4 w-4 flex-shrink-0"
          />
          <Label
            htmlFor={checkboxId}
            className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"
            title={source.title ?? undefined}
          >
            {source.title || t('sources.untitledSource')}
          </Label>
        </div>
        <ContextToggle
          mode={mode}
          hasInsights={source.insights_count > 0}
          onChange={m => onSourceModeChange(source.id, m)}
        />
      </div>
    )
  }

  const renderFolderRow = (row: FolderRow) => {
    if (query && !folderHasMatch(row)) return null
    const allSources: PickerSource[] = []
    const collect = (r: FolderRow) => {
      r.sources.forEach(s => allSources.push(s))
      r.folders.forEach(collect)
    }
    collect(row)
    const included = allSources.filter(s => modeOf(s.id) !== 'off').length
    const allIncluded = allSources.length > 0 && included === allSources.length
    const folderItems = allSources.map(s => ({ id: s.id, insights_count: s.insights_count }))
    const isCollapsed = !query && collapsed[row.key]
    const visible = query ? row.sources.filter(matches) : row.sources

    return (
      <div key={row.key}>
        <div className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted/50">
          <Checkbox
            checked={included === 0 ? false : allIncluded ? true : 'indeterminate'}
            disabled={allSources.length === 0}
            onCheckedChange={() =>
              onFolderApply(
                allSources.map(s => ({ id: s.id, insights_count: s.insights_count })),
                allIncluded ? 'exclude' : 'full',
              )
            }
            aria-label={row.node.group.name}
            className="h-4 w-4 flex-shrink-0"
          />
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => toggleFolderCollapsed(row.key)}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-sm font-medium">{row.node.group.name}</span>
            <span className="flex-shrink-0 text-xs text-muted-foreground">
              {included}/{allSources.length}
            </span>
          </button>
          {allSources.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-1.5 text-muted-foreground" title={t('sources.bulkContext')}>
                  <ListChecks className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    onFolderApply(folderItems, 'insights')
                  }
                >
                  {t('sources.includeAllInsights')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onFolderApply(folderItems, 'full')}>
                  {t('sources.includeAllFull')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onFolderApply(folderItems, 'exclude')}>
                  {t('sources.excludeAllFromContext')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!isCollapsed && (
          <div className="ml-5 border-l pl-2">
            {visible.map(renderSourceRow)}
            {row.folders.map(renderFolderRow)}
          </div>
        )}
      </div>
    )
  }

  const insightsCount = Object.values(selections.sources).filter(m => m === 'insights').length
  const fullCount = Object.values(selections.sources).filter(m => m === 'full').length
  const notesCount = Object.values(selections.notes).filter(m => m === 'full').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('chat.contextPickerTitle')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t('chat.contextPickerDesc')}</p>

        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('chat.contextSearchPlaceholder')}
        />

        <div className="max-h-[45vh] space-y-1 overflow-y-auto pr-1">
          {treeQuery.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {folderRows.map(renderFolderRow)}

              {ungroupedSources.filter(matches).length > 0 && (
                <div>
                  <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('sources.grouping.ungrouped')}
                  </p>
                  {ungroupedSources.filter(matches).map(renderSourceRow)}
                </div>
              )}

              {notes.length > 0 && (
                <div className="pt-2">
                  <p className="flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <StickyNote className="h-3.5 w-3.5" />
                    {t('chat.contextNotesSection')}
                  </p>
                  {notes.map(note => {
                    const mode: NoteContextMode = selections.notes[note.id] ?? 'off'
                    return (
                      <div key={note.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                        <Checkbox
                          id={`ctx-note-${note.id}`}
                          checked={mode === 'full'}
                          onCheckedChange={checked => onNoteModeChange(note.id, checked === true ? 'full' : 'off')}
                        />
                        <Label htmlFor={`ctx-note-${note.id}`} className="min-w-0 flex-1 cursor-pointer truncate text-sm">
                          {note.title || t('notes.untitledNote')}
                        </Label>
                      </div>
                    )
                  })}
                </div>
              )}

              {combosEnabled && onApplyCombo && (
                <div className="pt-2">
                  <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('chat.contextCombosTitle')}
                  </p>
                  {activeCombo && !activeCombo.isDefault && (
                    <div className="px-2 pb-1">
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="context-picker-combo-update-current"
                        className="h-8 w-full text-xs"
                        disabled={!comboDirty}
                        onClick={handleUpdateActiveCombo}
                      >
                        {t('chat.contextComboUpdateCurrent', {
                          name: displayName(activeCombo),
                        })}
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-2 pb-1">
                    <Input
                      value={comboName}
                      onChange={e => setComboName(e.target.value)}
                      placeholder={t('chat.contextComboNamePlaceholder')}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 text-xs"
                      disabled={!comboName.trim() || !hasComboSelection}
                      onClick={handleSaveCombo}
                    >
                      {t('chat.contextComboSave')}
                    </Button>
                  </div>
                  <button
                    type="button"
                    data-testid="context-picker-combo-default-entry"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                    onClick={handleApplyDefaultCombo}
                  >
                    {t('chat.contextComboDefaultEntry')}
                  </button>
                  {combos.filter(c => !c.isDefault).length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {t('chat.contextCombosEmpty')}
                    </p>
                  ) : (
                    combos
                      .filter(c => !c.isDefault)
                      .map(combo => (
                        <div
                          key={combo.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            title={t('chat.contextComboApplyTitle')}
                            onClick={() => handleApplyCombo(combo)}
                          >
                            <span className="min-w-0 truncate text-sm">{combo.name}</span>
                            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                              {t('chat.contextComboCount', { count: comboSurvivingCount(combo) })}
                            </Badge>
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-1.5 text-destructive hover:text-destructive"
                            title={t('chat.contextComboDeleteTitle')}
                            onClick={() => setComboToDelete(combo)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                  )}
                </div>
              )}

              {visibleSources.length === 0 && notes.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t('chat.contextNoItems')}</p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {t('chat.contextPickerCounts', { insights: insightsCount, full: fullCount, notes: notesCount })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onClearAll}>
              {t('sources.excludeAllFromContext')}
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              {t('common.done')}
            </Button>
          </div>
        </DialogFooter>

        <ConfirmDialog
          open={comboToDelete !== null}
          onOpenChange={open => {
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
          onConfirm={handleDeleteCombo}
        />
      </DialogContent>
    </Dialog>
  )
}

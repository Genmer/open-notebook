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
import { ChevronDown, ChevronRight, Folder, ListChecks, Loader2, StickyNote } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import { ContextToggle } from '@/components/common/ContextToggle'
import { buildGroupTree, GroupNode } from '@/lib/utils/group-tree'
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
}: ContextPickerDialogProps) {
  const { t } = useTranslation()
  const treeQuery = useContextTree(notebookId, viewId, open)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

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
            onClick={() => setCollapsed(prev => ({ ...prev, [row.key]: !prev[row.key] }))}
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
      </DialogContent>
    </Dialog>
  )
}

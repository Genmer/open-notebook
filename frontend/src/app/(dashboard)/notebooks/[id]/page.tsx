'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AppShell } from '@/components/layout/AppShell'
import { NotebookHeader } from '../components/NotebookHeader'
import { ClassicNotebookView } from '../components/ClassicNotebookView'
import { GeminiNotebookView } from '../components/GeminiNotebookView'
import { useNotebookViewStore } from '@/lib/stores/notebook-view-store'
import { GenerateArtifactDialog } from '../components/GenerateArtifactDialog'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources, type NotebookSourceFilters } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { useContextPreferences } from '@/lib/hooks/use-context-preferences'
import { ContextPickerDialog } from '@/app/(dashboard)/notebooks/components/ContextPickerDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { contextPrefsApi, type ContextPrefEntry } from '@/lib/api/notebooks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import {
  applyBulkSourceContext,
  applyBulkNoteContext,
  computeSourceSelections,
  computeNoteSelections,
  scopedFolderSelections,
  ALL_SCOPE_PREF_FOLDER,
  type BulkContextItem,
  type SourceContextDefault,
  type SourceBulkAction,
  type NoteContextDefault,
} from '@/lib/utils/source-context'
import {
  computeComboReplacement,
  getActiveCombo,
  listCombos,
  selectionsMatchCombo,
  setActiveComboDirty,
  setActiveComboId,
} from '@/lib/notebooks/context-combos'

// Re-exported from the shared types module for backward compatibility; several
// components historically import these from this route file.
import type { ContextMode, ContextSelections, NoteContextMode } from '@/lib/types/notebook-context'
export type { ContextMode, ContextSelections, NoteContextMode }

export default function NotebookPage() {
  const { t } = useTranslation()
  const params = useParams()
  const detailStyle = useNotebookViewStore((s) => s.detailStyle)

  // Ensure the notebook ID is properly decoded from URL
  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''

  const { data: notebook, isLoading: notebookLoading } = useNotebook(notebookId)
  const [sourceGrouping, setSourceGrouping] = useState<NotebookSourceFilters>({})
  const {
    sources,
    isLoading: sourcesLoading,
    // keepPreviousData 期间 sources 还是上一个范围/视图的列表，不能用它重建
    isPlaceholderData: sourcesPlaceholder,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId, sourceGrouping)
  const { data: notes, isLoading: notesLoading } = useNotes(notebookId)

  // 当前浏览的文件夹范围。`sourceGrouping` 本就提升在此页（文件夹栏与来源列
  // 共用），直接从这里派生范围，无需再从 SourcesColumn 回传：具体文件夹与
  // 「未分组」桶是范围视图（范围内默认全包含、范围外不进上下文、手动选择
  // 按 (笔记本, 文件夹, 来源) 持久化）；「全部」保持原有整本默认行为。
  const hasGrouping = !!sourceGrouping?.viewId && sourceGrouping.viewId !== 'file_type'
  const selectedGroupValue = sourceGrouping?.group ?? 'all'
  const folderScopeActive = hasGrouping && selectedGroupValue !== 'all'
  // 偏好表里「未分组」桶的 folder 为空（请求缺省 folder_id / folder_id null）
  const prefFolderId = selectedGroupValue === 'ungrouped' ? null : selectedGroupValue
  const scopeKey = folderScopeActive ? `folder:${selectedGroupValue}` : 'all'

  // Context selection state
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {}
  })

  // Study artifact generation dialog (reuses contextSelections as its scope)
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false)

  // Chat context picker dialog (opened from the Context: row in the chat)
  const [contextPickerOpen, setContextPickerOpen] = useState(false)

  // The default context mode applied to sources as they load. A bulk
  // include/exclude updates this so sources loaded later via pagination follow
  // the same intent instead of reverting to "included" (#223/#915).
  // Only meaningful for the unscoped "all" view; folder scopes keep their own
  // per-source preferences instead.
  const [sourceContextDefault, setSourceContextDefault] = useState<SourceContextDefault>('include')

  // Same idea for notes loaded later (notes are binary: included/off).
  const [noteContextDefault, setNoteContextDefault] = useState<NoteContextDefault>('include')

  // 会话内的文件夹级批量意图：范围里做了批量调整后，随后分页进来的同范围
  // 来源沿用该意图（偏好表只按来源存，刷新后回到默认 full）。
  const [folderBulkAction, setFolderBulkAction] = useState<SourceBulkAction | null>(null)

  // Saved (notebook, folder, source) preferences for the browsed scope. The
  // unscoped "all" view persists under the ALL_SCOPE_PREF_FOLDER sentinel so
  // re-entering the notebook restores the last source selection instead of
  // resetting to the implicit include-everything default.
  const queryClient = useQueryClient()
  const contextPrefsQuery = useContextPreferences(
    notebookId,
    folderScopeActive ? prefFolderId : ALL_SCOPE_PREF_FOLDER,
    true,
  )
  const savedPrefs = contextPrefsQuery.data

  // 手动/批量调整在文件夹范围内的持久化：先镜像进偏好缓存（范围重建依赖
  // 该缓存，镜像后重建不会丢刚做的选择），再写回后端；失败仅提示，下次
  // 进入该文件夹会重新拉取真实值。
  const persistFolderContext = (entries: ContextPrefEntry[]) => {
    if (!folderScopeActive || !notebookId || entries.length === 0) return
    queryClient.setQueryData<Record<string, ContextMode>>(
      QUERY_KEYS.contextPreferences(notebookId, prefFolderId),
      prev => ({
        ...prev,
        ...Object.fromEntries(entries.map(e => [e.source_id, e.mode])),
      }),
    )
    contextPrefsApi.save(notebookId, prefFolderId, entries).catch(() => {
      toast.error(t('chat.contextPrefSaveFailed'))
    })
  }

  // 「全部」视图的持久化：与文件夹范围同构，落在 ALL_SCOPE_PREF_FOLDER
  // 哨兵下。写入走串行合并队列——「全选」的大批量 PUT 在服务端逐条 UPSERT
  // 期间，紧随其后的手动微调若并发直发，会被批量请求里的旧值覆盖回去
  // （同一来源后到者赢），因此 pending 条目必须等在途请求完成后再发，
  // 保证后写的变更后到达服务器。
  const allScopeSaveQueueRef = useRef<{
    inFlight: boolean
    pending: Record<string, ContextMode> | null
  }>({ inFlight: false, pending: null })
  const persistAllScopeContext = useCallback((selections: Record<string, ContextMode>) => {
    if (folderScopeActive || !notebookId) return
    if (Object.keys(selections).length === 0) return
    queryClient.setQueryData<Record<string, ContextMode>>(
      QUERY_KEYS.contextPreferences(notebookId, ALL_SCOPE_PREF_FOLDER),
      prev => ({ ...prev, ...selections }),
    )
    const queue = allScopeSaveQueueRef.current
    queue.pending = { ...(queue.pending ?? {}), ...selections }
    if (queue.inFlight) return
    queue.inFlight = true
    const flush = async () => {
      try {
        while (queue.pending) {
          const entries = Object.entries(queue.pending).map(([source_id, mode]) => ({
            source_id,
            mode,
          }))
          queue.pending = null
          await contextPrefsApi.save(notebookId, ALL_SCOPE_PREF_FOLDER, entries)
        }
      } catch {
        toast.error(t('chat.contextPrefSaveFailed'))
      } finally {
        queue.inFlight = false
      }
    }
    void flush()
  }, [folderScopeActive, notebookId, queryClient, t])

  // 「全部」视图：沿用原有默认（include→有见解 insights、无见解 full），
  // 保留已有选择、只填充新加载的来源。占位数据（上一范围列表）期间跳过。
  useEffect(() => {
    if (folderScopeActive || sourcesPlaceholder) return
    if (sources && sources.length > 0) {
      setContextSelections(prev => ({
        ...prev,
        sources: computeSourceSelections(prev.sources, sources, sourceContextDefault),
      }))
    }
  }, [sources, sourceContextDefault, folderScopeActive, sourcesPlaceholder])

  // 文件夹/未分组范围：范围内来源默认全包含（或会话内批量意图），范围外
  // 不进上下文，已保存偏好覆盖默认。整体重建（不沿用旧选择），避免上一个
  // 范围的包含状态泄漏进当前范围。偏好拉取最终失败时降级为空偏好重建
  // （回到范围内默认 full、范围外 off），否则开关会整列消失且上下文陈旧。
  const notifiedPrefErrorRef = useRef(false)

  // 「全部」视图：进入笔记本时用哨兵范围保存的偏好恢复上次的选择，每次
  // 挂载只恢复一次；此后分页陆续到达的来源沿用上面的默认 effect（保留
  // 恢复出的选择、只补默认）。偏好拉取失败时保持隐式默认并提示一次。
  const restoredAllScopeRef = useRef(false)
  useEffect(() => {
    if (folderScopeActive || sourcesPlaceholder) return
    if (contextPrefsQuery.isError) {
      if (!notifiedPrefErrorRef.current) {
        notifiedPrefErrorRef.current = true
        toast.error(t('chat.contextPrefLoadFailed'))
      }
      return
    }
    if (!contextPrefsQuery.isSuccess || restoredAllScopeRef.current) return
    restoredAllScopeRef.current = true
    setContextSelections(prev => ({
      ...prev,
      sources: computeSourceSelections(savedPrefs ?? {}, sources ?? [], sourceContextDefault),
    }))
  }, [folderScopeActive, contextPrefsQuery.isSuccess, contextPrefsQuery.isError, savedPrefs, sources, sourceContextDefault, sourcesPlaceholder, t])

  // 激活组合记忆：挂载后若该笔记本有干净激活组合，按组合整表替换恢复 sources
  // 与 notes；已修改（dirty）时不整表替换，走偏好/默认路径恢复实际勾选。
  // 声明在上面的偏好恢复 effect 之后，且等偏好请求落定（成功或失败）与来源/
  // 笔记列表加载完成后再执行，保证覆盖 savedPrefs 恢复、不被空池时的默认填充
  // 冲掉；每次挂载只恢复一次。
  const restoredActiveComboRef = useRef(false)
  useEffect(() => {
    if (folderScopeActive || sourcesPlaceholder || sourcesLoading || notesLoading) return
    if (!contextPrefsQuery.isSuccess && !contextPrefsQuery.isError) return
    if (!notebookId || restoredActiveComboRef.current) return
    restoredActiveComboRef.current = true
    const active = getActiveCombo(notebookId)
    if (!active || active.dirty) return
    const combo = listCombos(notebookId).find(c => c.id === active.id)
    if (!combo) return
    const sourceIds = new Set((sources ?? []).map(s => s.id))
    const noteIds = new Set((notes ?? []).map(n => n.id))
    setContextSelections(prev => computeComboReplacement(combo, sourceIds, noteIds, prev))
  }, [folderScopeActive, sourcesPlaceholder, sourcesLoading, notesLoading, contextPrefsQuery.isSuccess, contextPrefsQuery.isError, notebookId, sources, notes])

  useEffect(() => {
    if (!folderScopeActive || sourcesPlaceholder) return
    if (contextPrefsQuery.isError) {
      // 每次失败只提示一次；范围查询重新进入加载态时允许再次提示
      if (!notifiedPrefErrorRef.current) {
        notifiedPrefErrorRef.current = true
        toast.error(t('chat.contextPrefLoadFailed'))
      }
    } else if (contextPrefsQuery.isSuccess) {
      notifiedPrefErrorRef.current = false
    } else {
      notifiedPrefErrorRef.current = false
      return
    }
    const sourceList = sources ?? []
    const inFolder = new Set(sourceList.map(s => s.id))
    setContextSelections(prev => {
      const scoped = scopedFolderSelections(
        sourceList,
        inFolder,
        savedPrefs ?? {},
        folderBulkAction ?? 'full',
      )
      // 上下文选择器可以勾选范围外的来源；这些显式选择在范围重建时原样
      // 保留，只有范围内来源按范围语义（默认/偏好）重建。
      const preserved: Record<string, ContextMode> = {}
      for (const [id, mode] of Object.entries(prev.sources)) {
        if (!inFolder.has(id)) preserved[id] = mode
      }
      return { ...prev, sources: { ...preserved, ...scoped } }
    })
  }, [folderScopeActive, contextPrefsQuery.isSuccess, contextPrefsQuery.isError, savedPrefs, sources, folderBulkAction, sourcesPlaceholder, t])

  // 切换浏览范围时重置会话内批量意图；从文件夹/未分组返回「全部」时按
  // 「全部」视图的默认意图整体重建一次，丢弃范围期留下的选择。占位数据
  // （上一范围列表）期间跳过，等真实列表到达后（sources 变化）再重建。
  const prevScopeRef = useRef(scopeKey)
  useEffect(() => {
    if (prevScopeRef.current === scopeKey) return
    if (sourcesPlaceholder) return
    prevScopeRef.current = scopeKey
    setFolderBulkAction(null)
    if (scopeKey !== 'all') return
    // 保留已有选择（含选择器在范围外勾选的来源），只为「全部」视图补默认。
    setContextSelections(prev => ({
      ...prev,
      sources: computeSourceSelections(prev.sources, sources ?? [], sourceContextDefault),
    }))
  }, [scopeKey, sources, sourceContextDefault, sourcesPlaceholder])

  useEffect(() => {
    if (notes && notes.length > 0) {
      setContextSelections(prev => ({
        ...prev,
        notes: computeNoteSelections(prev.notes, notes, noteContextDefault),
      }))
    }
  }, [notes, noteContextDefault])

  // 手动调整后的激活组合对账：不再脱离组合，而是记 dirty 位——勾选偏离激活
  // 组合快照置 true，改回一致清 false。组合语义只在「全部」视图成立（文件夹
  // 范围下 combosEnabled=false），范围重建不记 dirty。next 必须先算好再
  // setState，避免把 localStorage 写放进 StrictMode 会双调的函数式 updater。
  const syncActiveComboDirty = useCallback(
    (next: ContextSelections) => {
      if (folderScopeActive) return
      const active = getActiveCombo(notebookId)
      if (!active) return
      const combo = listCombos(notebookId).find(c => c.id === active.id)
      if (!combo) return
      // 并集口径（与弹窗的全量树池等价）：分页列表漏掉的弹窗勾选/组合条目
      // 也参与比对，否则 dirty 漏记、挂载恢复会静默丢弃弹窗里的改动
      const sourceIds = new Set([
        ...(sources ?? []).map(s => s.id),
        ...Object.keys(next.sources),
        ...Object.keys(combo.sources),
      ])
      const noteIds = new Set([
        ...(notes ?? []).map(n => n.id),
        ...Object.keys(next.notes),
        ...Object.keys(combo.notes),
      ])
      setActiveComboDirty(notebookId, !selectionsMatchCombo(next, combo, sourceIds, noteIds))
    },
    [folderScopeActive, notebookId, sources, notes],
  )

  const handleSourceContextModeChange = (sourceId: string, mode: ContextMode) => {
    const next: ContextSelections = {
      sources: { ...contextSelections.sources, [sourceId]: mode },
      notes: contextSelections.notes,
    }
    setContextSelections(next)
    syncActiveComboDirty(next)
    // 文件夹范围内的单来源调整按 (笔记本, 文件夹, 来源) 持久化；
    // 「全部」视图落在哨兵范围，重进笔记本时恢复。
    if (folderScopeActive) {
      persistFolderContext([{ source_id: sourceId, mode }])
    } else {
      persistAllScopeContext({ [sourceId]: mode })
    }
  }

  const handleNoteContextModeChange = (noteId: string, mode: NoteContextMode) => {
    const next: ContextSelections = {
      sources: contextSelections.sources,
      notes: { ...contextSelections.notes, [noteId]: mode },
    }
    setContextSelections(next)
    syncActiveComboDirty(next)
  }

  // Context picker: bulk-apply one action to a subset (one folder branch).
  // Same persistence semantics as the toolbar bulk action, but scoped.
  const handlePickerFolderApply = (
    items: Array<{ id: string; insights_count: number }>,
    action: SourceBulkAction,
  ) => {
    // Items carry their own insights_count: the dialog sees the whole notebook
    // (context-tree), including sources the paginated listing has not loaded.
    const next = applyBulkSourceContext({}, items, action)
    const nextSelections: ContextSelections = {
      sources: { ...contextSelections.sources, ...next },
      notes: contextSelections.notes,
    }
    setContextSelections(nextSelections)
    syncActiveComboDirty(nextSelections)
    if (folderScopeActive) {
      persistFolderContext(
        Object.entries(next).map(([source_id, mode]) => ({ source_id, mode })),
      )
    } else {
      persistAllScopeContext(next)
    }
  }

  // Context picker: apply a saved combo (whole-map replacement). Notes stay
  // session-only like handleNoteContextModeChange; the all-scope sources map
  // persists via a single queued PUT — never per-id calls. `comboId` present
  // means the apply came from a combo switch (record it as active); callers
  // that only pass a replacement leave the active record untouched.
  const handleApplyCombo = useCallback(
    (replacement: ContextSelections, comboId?: string | null) => {
      setContextSelections(replacement)
      if (comboId !== undefined) {
        setActiveComboId(notebookId, comboId)
      }
      if (!folderScopeActive) {
        persistAllScopeContext(replacement.sources)
      }
    },
    [folderScopeActive, persistAllScopeContext, notebookId],
  )

  // Context picker: exclude everything (loaded scope + picker-only picks).
  const handleClearAllContext = () => {
    const known = new Set<string>([
      ...Object.keys(contextSelections.sources),
      ...(sources ?? []).map(s => s.id),
    ])
    const nextSources: Record<string, ContextMode> = {}
    for (const id of known) nextSources[id] = 'off'
    const nextNotes: Record<string, NoteContextMode> = {}
    for (const note of notes ?? []) nextNotes[note.id] = 'off'
    const next: ContextSelections = { sources: nextSources, notes: nextNotes }
    setContextSelections(prev => ({ ...prev, ...next }))
    syncActiveComboDirty(next)
    if (folderScopeActive) {
      persistFolderContext(
        (sources ?? []).map(s => ({ source_id: s.id, mode: 'off' as ContextMode })),
      )
    } else {
      persistAllScopeContext(nextSources)
    }
  }

  // Bulk-apply a context action (insights-only / full / exclude) to every
  // source at once (#223). Also records the action as the default for sources
  // loaded later (#915). In a folder scope the action is persisted per source
  // instead of touching the unscoped "all" default. `items` lets callers pass
  // the full (context-tree) source list so the batch also covers sources the
  // paginated listing has not loaded; in a folder scope the paginated list
  // stays authoritative because that is the scoped listing.
  const handleBulkSourceContext = (action: SourceBulkAction, items?: BulkContextItem[]) => {
    if (folderScopeActive) {
      const sourceList = sources ?? []
      setFolderBulkAction(action)
      const next = applyBulkSourceContext({}, sourceList, action)
      const nextSelections: ContextSelections = {
        sources: next,
        notes: contextSelections.notes,
      }
      setContextSelections(nextSelections)
      syncActiveComboDirty(nextSelections)
      persistFolderContext(
        sourceList.map(s => ({ source_id: s.id, mode: next[s.id] })),
      )
      return
    }
    const sourceList = items ?? sources ?? []
    setSourceContextDefault(action)
    const nextSources = applyBulkSourceContext(contextSelections.sources, sourceList, action)
    const nextSelections: ContextSelections = {
      sources: nextSources,
      notes: contextSelections.notes,
    }
    setContextSelections(nextSelections)
    syncActiveComboDirty(nextSelections)
    persistAllScopeContext(nextSources)
  }

  // Bulk include/exclude every note from the chat context at once (#223).
  const handleBulkNoteContext = (action: NoteContextDefault) => {
    setNoteContextDefault(action)
    const next: ContextSelections = {
      sources: contextSelections.sources,
      notes: applyBulkNoteContext(contextSelections.notes, notes ?? [], action),
    }
    setContextSelections(next)
    syncActiveComboDirty(next)
  }

  if (notebookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!notebook) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">{t('notebooks.notFound')}</h1>
          <p className="text-muted-foreground">{t('notebooks.notFoundDesc')}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-shrink-0">
          <NotebookHeader notebook={notebook} />
        </div>

        {detailStyle === 'gemini_notebook' ? (
          <GeminiNotebookView
            notebookId={notebookId}
            notebook={notebook}
            sources={sources}
            sourcesLoading={sourcesLoading}
            refetchSources={refetchSources}
            notes={notes}
            notesLoading={notesLoading}
            sourceGrouping={sourceGrouping}
            setSourceGrouping={setSourceGrouping}
            contextSelections={contextSelections}
            handleSourceContextModeChange={handleSourceContextModeChange}
            handleBulkSourceContext={handleBulkSourceContext}
            handleNoteContextModeChange={handleNoteContextModeChange}
            setContextPickerOpen={setContextPickerOpen}
            combosEnabled={!folderScopeActive}
            onApplyCombo={handleApplyCombo}
          />
        ) : (
          <ClassicNotebookView
            notebookId={notebookId}
            notebook={notebook}
            sources={sources}
            sourcesLoading={sourcesLoading}
            refetchSources={refetchSources}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            notes={notes}
            notesLoading={notesLoading}
            sourceGrouping={sourceGrouping}
            setSourceGrouping={setSourceGrouping}
            contextSelections={contextSelections}
            handleSourceContextModeChange={handleSourceContextModeChange}
            handleNoteContextModeChange={handleNoteContextModeChange}
            handleBulkSourceContext={handleBulkSourceContext}
            handleBulkNoteContext={handleBulkNoteContext}
            setArtifactDialogOpen={setArtifactDialogOpen}
            setContextPickerOpen={setContextPickerOpen}
            combosEnabled={!folderScopeActive}
            onApplyCombo={handleApplyCombo}
          />
        )}

        <ContextPickerDialog
          open={contextPickerOpen}
          onOpenChange={setContextPickerOpen}
          notebookId={notebookId}
          viewId={sourceGrouping?.viewId ?? null}
          sources={sources ?? []}
          notes={(notes ?? []).map(n => ({ id: n.id, title: n.title }))}
          selections={contextSelections}
          onSourceModeChange={handleSourceContextModeChange}
          onFolderApply={handlePickerFolderApply}
          onNoteModeChange={handleNoteContextModeChange}
          onClearAll={handleClearAllContext}
          combosEnabled={!folderScopeActive}
          onApplyCombo={handleApplyCombo}
        />

        <GenerateArtifactDialog
          open={artifactDialogOpen}
          onOpenChange={setArtifactDialogOpen}
          notebookId={notebookId}
          contextSelections={contextSelections}
          sources={sources}
          notes={notes ?? []}
        />
      </div>
    </AppShell>
  )
}

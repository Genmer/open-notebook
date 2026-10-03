'use client'

import { useState, useEffect, useRef } from 'react'
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
  type SourceContextDefault,
  type SourceBulkAction,
  type NoteContextDefault,
} from '@/lib/utils/source-context'

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

  // Saved (notebook, folder, source) preferences for the browsed scope.
  const queryClient = useQueryClient()
  const contextPrefsQuery = useContextPreferences(
    notebookId,
    folderScopeActive ? prefFolderId : null,
    folderScopeActive,
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

  const handleSourceContextModeChange = (sourceId: string, mode: ContextMode) => {
    setContextSelections(prev => ({
      ...prev,
      sources: {
        ...prev.sources,
        [sourceId]: mode
      }
    }))
    // 文件夹范围内的单来源调整按 (笔记本, 文件夹, 来源) 持久化
    if (folderScopeActive) {
      persistFolderContext([{ source_id: sourceId, mode }])
    }
  }

  const handleNoteContextModeChange = (noteId: string, mode: NoteContextMode) => {
    setContextSelections(prev => ({
      ...prev,
      notes: {
        ...prev.notes,
        [noteId]: mode
      }
    }))
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
    setContextSelections(prev => ({
      ...prev,
      sources: { ...prev.sources, ...next },
    }))
    if (folderScopeActive) {
      persistFolderContext(
        Object.entries(next).map(([source_id, mode]) => ({ source_id, mode })),
      )
    }
  }

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
    setContextSelections(prev => ({ ...prev, sources: nextSources, notes: nextNotes }))
    if (folderScopeActive) {
      persistFolderContext(
        (sources ?? []).map(s => ({ source_id: s.id, mode: 'off' as ContextMode })),
      )
    }
  }

  // Bulk-apply a context action (insights-only / full / exclude) to every
  // source at once (#223). Also records the action as the default for sources
  // loaded later (#915). In a folder scope the action is persisted per source
  // instead of touching the unscoped "all" default.
  const handleBulkSourceContext = (action: SourceBulkAction) => {
    if (folderScopeActive) {
      const sourceList = sources ?? []
      setFolderBulkAction(action)
      const next = applyBulkSourceContext({}, sourceList, action)
      setContextSelections(prev => ({
        ...prev,
        sources: next,
      }))
      persistFolderContext(
        sourceList.map(s => ({ source_id: s.id, mode: next[s.id] })),
      )
      return
    }
    setSourceContextDefault(action)
    setContextSelections(prev => ({
      ...prev,
      sources: applyBulkSourceContext(prev.sources, sources ?? [], action),
    }))
  }

  // Bulk include/exclude every note from the chat context at once (#223).
  const handleBulkNoteContext = (action: NoteContextDefault) => {
    setNoteContextDefault(action)
    setContextSelections(prev => ({
      ...prev,
      notes: applyBulkNoteContext(prev.notes, notes ?? [], action),
    }))
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
            setContextPickerOpen={setContextPickerOpen}
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

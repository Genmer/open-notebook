'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { SourceListResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, FileText, Link2, ChevronDown, Loader2, ListChecks } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Checkbox } from '@/components/ui/checkbox'
import { BulkActionBar, chunkIds } from '@/components/sources/BulkActionBar'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { AddExistingSourceDialog } from '@/components/sources/AddExistingSourceDialog'
import { SourceCard } from '@/components/sources/SourceCard'
import { SourceBreadcrumb } from '@/components/sources/SourceBreadcrumb'
import { useDeleteSource, useRetrySource, useRemoveSourceFromNotebook, useUpdateSource, type NotebookSourceFilters } from '@/lib/hooks/use-sources'
import { useSourceViews, useViewGroups, useMoveToGroup, useCreateGroup, useCreateView, useUngroupMembers } from '@/lib/hooks/use-source-views'
import { getAncestorChain, getGroupDepth, MAX_GROUP_DEPTH } from '@/lib/utils/group-tree'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { GroupPickerDialog } from '@/components/sources/GroupPickerDialog'
import { GroupNameDialog } from '@/components/sources/GroupNameDialog'
import { RenameSourceDialog } from '@/components/sources/RenameSourceDialog'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { toast } from 'sonner'
import { ContextMode } from '../[id]/page'
import type { SourceBulkAction } from '@/lib/utils/source-context'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { displayViewName } from '@/lib/utils/view-display'

interface SourcesColumnProps {
  sources?: SourceListResponse[]
  isLoading: boolean
  notebookId: string
  notebookName?: string
  onRefresh?: () => void
  contextSelections?: Record<string, ContextMode>
  onContextModeChange?: (sourceId: string, mode: ContextMode) => void
  onBulkContextModeChange?: (action: SourceBulkAction) => void
  // 分组导航：由左侧 FoldersColumn（或移动端保留的面包屑）驱动
  grouping?: NotebookSourceFilters
  onGroupingChange?: (filters: NotebookSourceFilters) => void
  // Pagination props
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
}

export function SourcesColumn({
  sources,
  isLoading,
  notebookId,
  onRefresh,
  contextSelections,
  onContextModeChange,
  onBulkContextModeChange,
  grouping,
  onGroupingChange,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: SourcesColumnProps) {
  const { t } = useTranslation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addExistingDialogOpen, setAddExistingDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sourceToDelete, setSourceToDelete] = useState<string | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [sourceToRemove, setSourceToRemove] = useState<string | null>(null)
  const [rowAction, setRowAction] = useState<
    { kind: 'rename' | 'move'; source: SourceListResponse } | null
  >(null)
  // 新建文件夹弹窗：落点跟随当前浏览位置（根层=null，浏览文件夹 X 时=X）
  const [newFolder, setNewFolder] = useState<{ open: boolean; parentId: string | null }>({
    open: false,
    parentId: null,
  })
  // 批量选择：勾选卡片后底部出现批量操作栏，右键选中项时菜单作用于整个选中集
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)

  const { openModal } = useModalManager()
  const deleteSource = useDeleteSource()
  const retrySource = useRetrySource()
  const removeFromNotebook = useRemoveSourceFromNotebook()
  const updateSource = useUpdateSource()
  const moveToGroup = useMoveToGroup()
  const createGroup = useCreateGroup()
  const createView = useCreateView()
  const ungroupMembers = useUngroupMembers()

  // 右键/条目区组织操作落在哪个 view：优先当前筛选；未选时回退 custom 优先——
  // 落进 AI 视图的文件夹会在 Re-classify 时被覆盖，是"看不见还建不进"的根源之一
  const { data: views } = useSourceViews()
  const resolvedView = grouping?.viewId
    ? views?.find(v => v.id === grouping.viewId)
    : (views?.find(v => v.view_type === 'custom') ?? views?.find(v => v.is_default) ?? views?.[0])
  const resolvedViewId = resolvedView?.id
  const { data: viewGroups } = useViewGroups(resolvedViewId)
  // 归属语义只有在浏览具体文件夹时才明确（SourceListResponse 没有逐行归属字段）
  const browsingConcreteGroup =
    !!grouping?.viewId &&
    !!grouping?.group &&
    grouping.group !== 'all' &&
    grouping.group !== 'ungrouped'

  // 面包屑与条目区的定位输入：当前文件夹、祖先链、叶子标签
  const selectedGroupValue = grouping?.group ?? 'all'
  const currentFolderId =
    selectedGroupValue !== 'all' && selectedGroupValue !== 'ungrouped' ? selectedGroupValue : null
  const currentFolder = currentFolderId
    ? (viewGroups ?? []).find(g => g.id === currentFolderId)
    : undefined
  const breadcrumbChain = useMemo(
    () => (currentFolderId ? getAncestorChain(viewGroups ?? [], currentFolderId) : []),
    [viewGroups, currentFolderId]
  )
  const breadcrumbCurrentLabel =
    selectedGroupValue === 'ungrouped' ? t('sources.grouping.ungrouped') : currentFolder?.name ?? ''

  // 浏览中的视图/文件夹可能在他页或并发操作中被删：留在失效位置会呈现
  // 「面包屑空 leaf + 无名空态」的幽灵文件夹，自动退回根层/全部视图
  useEffect(() => {
    if (!onGroupingChange) return
    if (grouping?.viewId && views && !views.some(v => v.id === grouping.viewId)) {
      onGroupingChange({ viewId: undefined, group: 'all' })
      return
    }
    if (currentFolderId && viewGroups && !viewGroups.some(g => g.id === currentFolderId)) {
      onGroupingChange({ viewId: grouping?.viewId, group: 'all' })
    }
  }, [grouping, views, viewGroups, currentFolderId, onGroupingChange])

  const openNewFolder = () => {
    const parentId = browsingConcreteGroup ? grouping!.group! : null
    if (parentId && getGroupDepth(viewGroups ?? [], parentId) >= MAX_GROUP_DEPTH) {
      toast.error(t('apiErrors.groupDepthExceeded'))
      return
    }
    setNewFolder({ open: true, parentId })
  }

  // 新建弹窗的落点提示与同级列表（提交前防错）
  const newFolderLocationPath = useMemo(() => {
    const viewLabel = resolvedView ? displayViewName(resolvedView, t) : ''
    if (!newFolder.parentId) return viewLabel
    const chain = [
      ...getAncestorChain(viewGroups ?? [], newFolder.parentId).map(g => g.name),
      (viewGroups ?? []).find(g => g.id === newFolder.parentId)?.name,
    ].filter(Boolean)
    return [viewLabel, ...chain].filter(Boolean).join(' / ')
  }, [newFolder.parentId, viewGroups, resolvedView, t])
  const newFolderSiblingNames = useMemo(
    () =>
      (viewGroups ?? [])
        .filter(g => (g.parent_id ?? null) === newFolder.parentId)
        .map(g => g.name),
    [viewGroups, newFolder.parentId]
  )

  // Collapsible column state
  const { sourcesCollapsed, toggleSources } = useNotebookColumnsStore()
  const sourcesLabel = t('navigation.sources')
  const collapseButton = useMemo(
    () => createCollapseButton(toggleSources, sourcesLabel),
    [toggleSources, sourcesLabel]
  )

  // Scroll container ref for infinite scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !hasNextPage || isFetchingNextPage || !fetchNextPage) return

    const { scrollTop, scrollHeight, clientHeight } = container
    // Load more when user scrolls within 200px of the bottom
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])
  
  const handleDeleteClick = (sourceId: string) => {
    setSourceToDelete(sourceId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!sourceToDelete) return

    try {
      await deleteSource.mutateAsync(sourceToDelete)
      setDeleteDialogOpen(false)
      setSourceToDelete(null)
      onRefresh?.()
    } catch (error) {
      console.error('Failed to delete source:', error)
    }
  }

  const handleRemoveFromNotebook = (sourceId: string) => {
    setSourceToRemove(sourceId)
    setRemoveDialogOpen(true)
  }

  const handleRemoveConfirm = async () => {
    if (!sourceToRemove) return

    try {
      await removeFromNotebook.mutateAsync({
        notebookId,
        sourceId: sourceToRemove
      })
      setRemoveDialogOpen(false)
      setSourceToRemove(null)
    } catch (error) {
      console.error('Failed to remove source from notebook:', error)
      // Error toast is handled by the hook
    }
  }

  const handleRetry = async (sourceId: string) => {
    try {
      await retrySource.mutateAsync(sourceId)
    } catch (error) {
      console.error('Failed to retry source:', error)
    }
  }

  const handleSourceClick = (sourceId: string) => {
    openModal('source', sourceId)
  }

  const handleRenameConfirm = async (title: string) => {
    if (!rowAction?.source) return
    await updateSource.mutateAsync({ id: rowAction.source.id, data: { title } })
  }

  const handleMoveConfirm = async (targetGroupId: string | null) => {
    const target = rowAction
    setRowAction(null)
    if (!target || target.kind !== 'move' || !targetGroupId) return
    try {
      await moveToGroup.mutateAsync({ groupId: targetGroupId, sourceIds: [target.source.id] })
      const groupName = (viewGroups ?? []).find(g => g.id === targetGroupId)?.name ?? ''
      toast.success(t('sources.grouping.moveSuccessWithTarget', { count: 1, group: groupName }))
    } catch {
      // error toast comes from the mutation hook
    }
  }

  // 手动文件夹绝不落 AI 视图（Re-classify 会覆盖）：未选视图且没有自定义视图时先建一个
  const ensureCustomViewId = async (): Promise<string | undefined> => {
    const custom = views?.find(v => v.view_type === 'custom')
    if (custom) return custom.id
    try {
      const view = await createView.mutateAsync(t('sources.grouping.defaultCustomViewName'))
      return view.id
    } catch {
      return undefined // error toast by hook
    }
  }

  const resolveCreateViewId = async (): Promise<string | undefined> => {
    if (grouping?.viewId) return grouping.viewId
    if (resolvedView?.view_type === 'custom') return resolvedViewId
    return ensureCustomViewId()
  }

  // 弹窗内联新建：失败 resolve null 让输入保留可重试；错误 toast 由 hook 出
  const handlePickerCreateGroup = async (name: string): Promise<string | null> => {
    const viewId = await resolveCreateViewId()
    if (!viewId) return null
    try {
      const group = await createGroup.mutateAsync({ viewId, name, parentId: null })
      toast.success(t('sources.grouping.groupCreatedToast', { name }))
      return group.id
    } catch {
      return null
    }
  }

  const handleNewFolderConfirm = async (name: string) => {
    const viewId = await resolveCreateViewId()
    if (!viewId) throw new Error('no view available') // 弹窗保持打开，错误 toast 已由 hook 出
    const view = views?.find(v => v.id === viewId)
    await createGroup.mutateAsync({
      viewId,
      name,
      parentId: newFolder.parentId,
    })
    const parent = (viewGroups ?? []).find(g => g.id === newFolder.parentId)
    toast.success(
      parent
        ? t('sources.grouping.groupCreatedInFolder', { name, parent: parent.name })
        : t('sources.grouping.groupCreatedInView', {
            name,
            view: view ? displayViewName(view, t) : '',
          })
    )
    // 未选视图时新建：自动切入该视图，让新文件夹立刻出现在条目区
    if (!grouping?.viewId && onGroupingChange) {
      onGroupingChange({ viewId, group: 'all' })
    }
  }

  const handleUngroupFromFolder = async (sourceId: string) => {
    if (!grouping?.viewId) return
    try {
      await ungroupMembers.mutateAsync({ viewId: grouping.viewId, sourceIds: [sourceId] })
      toast.success(t('sources.grouping.ungroupSuccess', { count: 1 }))
    } catch {
      // error toast comes from the mutation hook
    }
  }

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds])
  const allLoadedSelected = (sources?.length ?? 0) > 0 && selectedIds.size === sources?.length

  // 分页/筛选刷新后选中集里可能已没有这些来源，及时修剪
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev
      const alive = new Set((sources ?? []).map(s => s.id))
      const next = new Set([...prev].filter(id => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [sources])

  // Esc 清空批量选择（与 /sources 页一致的操作直觉）
  useEffect(() => {
    if (selectedIds.size === 0) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIds(new Set())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIds.size])

  const toggleSelected = (sourceId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if ((sources?.length ?? 0) > 0 && prev.size === sources?.length) return new Set()
      return new Set((sources ?? []).map(s => s.id))
    })
  }

  // 右键作用于选中集的判定：右键的卡片在多选中（选中 1 项仍按单条处理，菜单语义不变）
  const isBulkTarget = (source: SourceListResponse) =>
    selectedIds.size > 1 && selectedIds.has(source.id)

  const summarizeBulk = (result: { succeeded: number; failed: number }, successKey: string) => {
    if (result.failed === 0) toast.success(t(successKey, { count: result.succeeded }))
    else toast.warning(t('sources.grouping.bulkPartial', { success: result.succeeded, failed: result.failed }))
  }

  const runChunked = async (ids: string[], run: (chunk: string[]) => Promise<unknown>) => {
    let succeeded = 0
    let failed = 0
    for (const chunk of chunkIds(ids)) {
      try {
        await run(chunk)
        succeeded += chunk.length
      } catch {
        failed += chunk.length
      }
    }
    return { succeeded, failed }
  }

  const handleBulkMoveConfirm = async (targetGroupId: string | null) => {
    setBulkMoveOpen(false)
    if (!targetGroupId || selectedIdList.length === 0) return
    const result = await runChunked(selectedIdList, chunk =>
      moveToGroup.mutateAsync({ groupId: targetGroupId, sourceIds: chunk })
    )
    summarizeBulk(result, 'sources.grouping.moveSuccess')
    clearSelection()
    onRefresh?.()
  }

  const handleBulkUngroup = async () => {
    const viewId = grouping?.viewId
    if (!viewId || selectedIdList.length === 0) return
    const result = await runChunked(selectedIdList, chunk =>
      ungroupMembers.mutateAsync({ viewId, sourceIds: chunk })
    )
    summarizeBulk(result, 'sources.grouping.ungroupSuccess')
    clearSelection()
    onRefresh?.()
  }

  const handleBatchDeleteConfirm = async () => {
    if (selectedIdList.length === 0) return
    let succeeded = 0
    let failed = 0
    for (const id of selectedIdList) {
      try {
        await deleteSource.mutateAsync(id)
        succeeded++
      } catch {
        failed++
      }
    }
    if (failed === 0) toast.success(t('sources.grouping.batchDeleteSuccess', { count: succeeded }))
    else toast.warning(t('sources.grouping.bulkPartial', { success: succeeded, failed }))
    clearSelection()
    setBatchDeleteOpen(false)
    onRefresh?.()
  }

  // 面包屑导航：跳到视图根层（all）、未分组或某个祖先文件夹
  const navigateToGroup = (target: string) => {
    if (grouping?.viewId) onGroupingChange?.({ viewId: grouping.viewId, group: target })
  }

  return (
    <>
      <CollapsibleColumn
        isCollapsed={sourcesCollapsed}
        onToggle={toggleSources}
        collapsedIcon={FileText}
        collapsedLabel={t('navigation.sources')}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {(sources?.length ?? 0) > 0 && (
                  <Checkbox
                    checked={allLoadedSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label={t('sources.grouping.selectAllLoaded')}
                    data-testid="select-all-sources"
                    className="mb-0.5"
                  />
                )}
                <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-sage" />
                  {t('navigation.sources')}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                {onBulkContextModeChange && sources && sources.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground" title={t('sources.bulkContext')}>
                        <ListChecks className="h-4 w-4" />
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('insights')}>
                        {t('sources.includeAllInsights')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('full')}>
                        {t('sources.includeAllFull')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('exclude')}>
                        {t('sources.excludeAllFromContext')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      {t('sources.addSource')}
                      <ChevronDown className="h-4 w-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setDropdownOpen(false); setAddDialogOpen(true); }}>
                      <Plus className="h-4 w-4 mr-2" />
                      {t('sources.addSource')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setDropdownOpen(false); setAddExistingDialogOpen(true); }}>
                      <Link2 className="h-4 w-4 mr-2" />
                      {t('sources.addExistingTitle')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {collapseButton}
              </div>
            </div>
          </CardHeader>

          <CardContent ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
            {grouping?.viewId && resolvedView && selectedGroupValue !== 'all' && (
              <div className="mb-2" data-testid="notebook-folder-nav">
                <SourceBreadcrumb
                  viewName={displayViewName(resolvedView, t)}
                  chain={breadcrumbChain}
                  currentLabel={breadcrumbCurrentLabel}
                  onNavigate={navigateToGroup}
                  isFileTypeView={false}
                />
              </div>
            )}
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !sources || sources.length === 0 ? (
              grouping?.viewId && (selectedGroupValue === 'ungrouped' || currentFolderId) ? (
                <EmptyState
                  icon={FileText}
                  title={t('sources.grouping.emptyFolderTitle', {
                    name:
                      selectedGroupValue === 'ungrouped'
                        ? t('sources.grouping.ungrouped')
                        : currentFolder?.name ?? '',
                  })}
                  description=""
                  action={
                    currentFolderId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 mt-4"
                        onClick={() => setAddDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                        {t('sources.addNew')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <EmptyState
                  icon={FileText}
                  title={t('sources.noSourcesYet')}
                  description={t('sources.createFirstSource')}
                />
              )
            ) : (
              <div className="space-y-2">
                {sources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onClick={handleSourceClick}
                    onDelete={isBulkTarget(source) ? () => setBatchDeleteOpen(true) : handleDeleteClick}
                    onRetry={handleRetry}
                    onRefreshContent={handleRetry}
                    onRemoveFromNotebook={handleRemoveFromNotebook}
                    onRefresh={onRefresh}
                    showRemoveFromNotebook={true}
                    contextMode={contextSelections?.[source.id]}
                    onContextModeChange={onContextModeChange
                      ? (mode) => onContextModeChange(source.id, mode)
                      : undefined
                    }
                    onOpenSource={handleSourceClick}
                    onRename={() => setRowAction({ kind: 'rename', source })}
                    onMoveToFolder={
                      isBulkTarget(source)
                        ? () => setBulkMoveOpen(true)
                        : () => setRowAction({ kind: 'move', source })
                    }
                    onNewFolder={resolvedViewId ? openNewFolder : undefined}
                    onUngroupFromFolder={
                      browsingConcreteGroup && grouping?.viewId
                        ? (id) =>
                            isBulkTarget(source)
                              ? handleBulkUngroup()
                              : handleUngroupFromFolder(id)
                        : undefined
                    }
                    menuContextKey={`${resolvedViewId ?? 'none'}:${grouping?.group ?? 'all'}`}
                    selectable={true}
                    selected={selectedIds.has(source.id)}
                    onToggleSelect={toggleSelected}
                  />
                ))}
                {/* Loading indicator for infinite scroll */}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleColumn>

      <AddSourceDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        defaultNotebookId={notebookId}
        defaultViewId={grouping?.viewId}
        defaultGroupId={currentFolderId ?? undefined}
      />

      <AddExistingSourceDialog
        open={addExistingDialogOpen}
        onOpenChange={setAddExistingDialogOpen}
        notebookId={notebookId}
        onSuccess={onRefresh}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('sources.delete')}
        description={t('sources.deleteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteSource.isPending}
        confirmVariant="destructive"
      />

      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title={t('sources.removeFromNotebook')}
        description={t('sources.removeConfirm')}
        confirmText={t('common.remove')}
        onConfirm={handleRemoveConfirm}
        isLoading={removeFromNotebook.isPending}
        confirmVariant="default"
      />

      <RenameSourceDialog
        open={rowAction?.kind === 'rename'}
        source={rowAction?.kind === 'rename' ? rowAction.source : null}
        onConfirm={handleRenameConfirm}
        onOpenChange={(open) => !open && setRowAction(null)}
      />

      <GroupPickerDialog
        open={rowAction?.kind === 'move'}
        onOpenChange={(open) => !open && setRowAction(null)}
        hideRootOption
        title={t('sources.grouping.moveToGroupTitle')}
        description={
          rowAction?.kind === 'move' && resolvedView
            ? `${
                rowAction.source.title || t('sources.untitledSource')
              } · ${t('sources.grouping.moveTargetViewHint', {
                view: displayViewName(resolvedView, t),
              })}`
            : undefined
        }
        groups={viewGroups ?? []}
        confirmText={t('sources.grouping.moveHere')}
        onCreateGroup={handlePickerCreateGroup}
        onConfirm={handleMoveConfirm}
      />

      <GroupNameDialog
        open={newFolder.open}
        mode="create"
        locationPath={newFolderLocationPath || undefined}
        siblingNames={newFolderSiblingNames}
        onOpenChange={(open) => setNewFolder(prev => ({ ...prev, open }))}
        onConfirm={handleNewFolderConfirm}
        isPending={createGroup.isPending}
      />

      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          loadedCount={sources?.length ?? 0}
          onMove={() => setBulkMoveOpen(true)}
          onCopy={() => setBulkMoveOpen(true)}
          onUngroup={handleBulkUngroup}
          onRename={() => setBulkMoveOpen(true)}
          onDelete={() => setBatchDeleteOpen(true)}
          onClear={clearSelection}
          hiddenActions={[
            'copy',
            'rename',
            // 笔记本列的归属语义只在浏览具体文件夹时明确（与右键菜单同一口径）
            ...(browsingConcreteGroup ? [] : (['ungroup'] as const)),
          ]}
        />
      )}

      <GroupPickerDialog
        open={bulkMoveOpen}
        onOpenChange={setBulkMoveOpen}
        hideRootOption
        title={t('sources.grouping.moveToGroupTitle')}
        description={
          resolvedView
            ? `${t('sources.grouping.selectedCount', { count: selectedIds.size })} · ${t(
                'sources.grouping.moveTargetViewHint',
                { view: displayViewName(resolvedView, t) }
              )}`
            : t('sources.grouping.selectedCount', { count: selectedIds.size })
        }
        groups={viewGroups ?? []}
        confirmText={t('sources.grouping.moveHere')}
        onCreateGroup={handlePickerCreateGroup}
        onConfirm={handleBulkMoveConfirm}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title={t('sources.grouping.batchDeleteConfirmTitle', { count: selectedIds.size })}
        description={t('sources.deleteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={handleBatchDeleteConfirm}
        isLoading={deleteSource.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}


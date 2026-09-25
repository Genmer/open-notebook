'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { sourcesApi, type SourceSortField } from '@/lib/api/sources'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useUpdateSource } from '@/lib/hooks/use-sources'
import { SourceListResponse } from '@/lib/types/api'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { AppShell } from '@/components/layout/AppShell'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FileText, Trash2, ArrowDown, ArrowUp, ArrowUpDown, Plus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { getApiErrorKey } from '@/lib/utils/error-handler'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { EmbedMissingPanel } from '@/components/sources/EmbedMissingPanel'
import { SourceViewTabs } from '@/components/sources/SourceViewTabs'
import { GroupTree } from '@/components/sources/GroupTree'
import { FolderGrid } from '@/components/sources/FolderGrid'
import { GroupPickerDialog } from '@/components/sources/GroupPickerDialog'
import { GroupNameDialog } from '@/components/sources/GroupNameDialog'
import { SourceContextMenuContent } from '@/components/sources/SourceContextMenu'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { BulkActionBar, chunkIds } from '@/components/sources/BulkActionBar'
import { SourceRowActionsMenu } from '@/components/sources/SourceRowActionsMenu'
import { RenameSourceDialog } from '@/components/sources/RenameSourceDialog'
import { BatchRenameDialog } from '@/components/sources/BatchRenameDialog'
import { SourceBreadcrumb } from '@/components/sources/SourceBreadcrumb'
import { getAncestorChain, getGroupDepth, MAX_GROUP_DEPTH } from '@/lib/utils/group-tree'
import { resolveDragIds, DND_SOURCES_TYPE } from '@/lib/utils/dnd-helpers'
import { displayViewName } from '@/lib/utils/view-display'
import { useSourceViews, useViewGroups, useSourceTypeGroups, useMoveToGroup, useUngroupMembers, useCopyToGroup, useCreateGroup, useUpdateGroup, useDeleteGroup, useCreateView, useUpdateView, useDeleteView, useClassifyView, useClassifyProgressWatcher } from '@/lib/hooks/use-source-views'
import {
  FILE_TYPE_VIEW_ID,
  resolveActiveViewId,
  resolveGroupSelection,
  useSourceViewStore,
  type GroupSelection,
} from '@/lib/stores/source-view-store'

type BulkDialogKind = 'move' | 'copy' | null

export default function SourcesPage() {
  const { t, language } = useTranslation()
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const failedToLoadMessage = t('sources.failedToLoad')
  const [sources, setSources] = useState<SourceListResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [sortBy, setSortBy] = useState<SourceSortField>('updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDialog, setBulkDialog] = useState<BulkDialogKind>(null)
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; source: SourceListResponse | null }>({
    open: false,
    source: null,
  })
  const [rowPicker, setRowPicker] = useState<{ kind: 'move' | 'copy'; source: SourceListResponse } | null>(null)
  const [batchRenameOpen, setBatchRenameOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; source: SourceListResponse | null }>({
    open: false,
    source: null
  })
  const router = useRouter()
  const tableRef = useRef<HTMLTableElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  // Shift-range selection anchor and drag-click suppression (dragend fires a click)
  const lastAnchorRef = useRef<string | null>(null)
  const shiftRangeRef = useRef(false)
  const suppressClickRef = useRef(false)
  const PAGE_SIZE = 30
  const queryClient = useQueryClient()
  const updateSource = useUpdateSource()

  // Grouping navigation state (persisted)
  const { activeViewId, selectedGroupByView, hasHydrated, setActiveView, setSelectedGroup } =
    useSourceViewStore()
  const { data: views } = useSourceViews()
  const classifyView = useClassifyView()
  useClassifyProgressWatcher(views)
  const isFileTypeView = activeViewId === FILE_TYPE_VIEW_ID
  // Read through resolveGroupSelection so persisted legacy values (e.g. 'file',
  // the removed whole-file group) fall back to 'all' before anything fetches.
  const selectedGroup: GroupSelection = isFileTypeView
    ? resolveGroupSelection(selectedGroupByView[activeViewId], activeViewId, [])
    : selectedGroupByView[activeViewId] ?? 'all'
  const { data: groups, isLoading: groupsLoading } = useViewGroups(isFileTypeView ? null : activeViewId)
  const { data: typeGroups, isLoading: typeGroupsLoading } = useSourceTypeGroups(isFileTypeView)

  const moveToGroup = useMoveToGroup()
  const ungroupMembers = useUngroupMembers()
  const copyToGroup = useCopyToGroup()
  const createView = useCreateView()
  const updateView = useUpdateView()
  const deleteView = useDeleteView()
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()
  const deleteGroup = useDeleteGroup()

  // Persisted ids can outlive their view/group — snap back to the virtual tab / 'all'
  useEffect(() => {
    if (!hasHydrated || !views) return
    const valid = resolveActiveViewId(activeViewId, views)
    if (valid !== activeViewId) setActiveView(valid)
  }, [hasHydrated, views, activeViewId, setActiveView])

  useEffect(() => {
    if (!hasHydrated || isFileTypeView || !groups) return
    const valid = resolveGroupSelection(selectedGroup, activeViewId, groups)
    if (valid !== selectedGroup) setSelectedGroup(activeViewId, valid)
  }, [hasHydrated, isFileTypeView, groups, activeViewId, selectedGroup, setSelectedGroup])

  const fetchSources = useCallback(async (reset = false) => {
    try {
      // 文件管理器范式：分组视图根层只看文件夹网格，不拉文件列表（计数来自分组接口）
      if (!isFileTypeView && selectedGroup === 'all') {
        setLoading(false)
        setLoadingMore(false)
        hasMoreRef.current = true
        return
      }

      // Check flags before proceeding
      if (!reset && (loadingMoreRef.current || !hasMoreRef.current)) {
        return
      }

      if (reset) {
        setLoading(true)
        offsetRef.current = 0
        setSources([])
        hasMoreRef.current = true
      } else {
        loadingMoreRef.current = true
        setLoadingMore(true)
      }

      const params: Parameters<typeof sourcesApi.list>[0] = {
        limit: PAGE_SIZE,
        offset: offsetRef.current,
        sort_by: sortBy,
        sort_order: sortOrder,
      }
      if (isFileTypeView) {
        if (selectedGroup !== 'all') {
          if (selectedGroup === 'link' || selectedGroup === 'text') {
            params.source_type = selectedGroup
          } else {
            params.file_ext = selectedGroup
          }
        }
      } else {
        params.view_id = activeViewId
        if (selectedGroup === 'ungrouped') params.ungrouped = true
        else if (selectedGroup !== 'all') params.group_id = selectedGroup
      }

      const data = await sourcesApi.list(params)

      if (reset) {
        setSources(data)
      } else {
        setSources(prev => [...prev, ...data])
      }

      // Check if we have more data
      const hasMoreData = data.length === PAGE_SIZE
      hasMoreRef.current = hasMoreData
      offsetRef.current += data.length
    } catch (err) {
      console.error('Failed to fetch sources:', err)
      setError(failedToLoadMessage)
      toast.error(failedToLoadMessage)
    } finally {
      setLoading(false)
      setLoadingMore(false)
      loadingMoreRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortOrder, failedToLoadMessage, isFileTypeView, activeViewId, selectedGroup, hasHydrated])

  // Initial load and when sort / grouping changes
  useEffect(() => {
    if (!hasHydrated) return
    fetchSources(true)
  }, [hasHydrated, sortBy, sortOrder, activeViewId, selectedGroup, fetchSources])

  // Selection is per listing; drop it when the visible set changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [activeViewId, selectedGroup, sortBy, sortOrder])

  useEffect(() => {
    // Focus the table when component mounts or sources change
    if (sources.length > 0 && tableRef.current) {
      tableRef.current.focus()
    }
  }, [sources])

  // Single toggle (also resets the shift anchor); range mode adds the closed
  // interval between the anchor and the clicked row without removing anything.
  const toggleSelected = useCallback((sourceId: string, opts?: { range?: boolean }) => {
    if (opts?.range && lastAnchorRef.current) {
      const anchorIndex = sources.findIndex((s) => s.id === lastAnchorRef.current)
      const targetIndex = sources.findIndex((s) => s.id === sourceId)
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        const rangeIds = sources.slice(from, to + 1).map((s) => s.id)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          rangeIds.forEach((id) => next.add(id))
          return next
        })
        return
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
    lastAnchorRef.current = sourceId
  }, [sources])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (sources.length === 0) return
      // Don't hijack typing in form fields (the new space toggle especially)
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      // Open dropdown menus and dialogs own the arrow keys while focused
      if (target?.closest?.('[role="menuitem"], [role="dialog"], [data-radix-popper-content-wrapper]')) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => {
            const newIndex = Math.min(prev + 1, sources.length - 1)
            // Scroll to keep selected row visible
            setTimeout(() => scrollToSelectedRow(newIndex), 0)
            return newIndex
          })
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => {
            const newIndex = Math.max(prev - 1, 0)
            // Scroll to keep selected row visible
            setTimeout(() => scrollToSelectedRow(newIndex), 0)
            return newIndex
          })
          break
        case 'Enter':
          e.preventDefault()
          if (sources[selectedIndex]) {
            router.push(`/sources/${sources[selectedIndex].id}`)
          }
          break
        case ' ':
          // Space toggles row selection; only in groupable (non-file-type) views
          e.preventDefault()
          if (!isFileTypeView && sources[selectedIndex]) {
            toggleSelected(sources[selectedIndex].id)
          }
          break
        case 'Home':
          e.preventDefault()
          setSelectedIndex(0)
          setTimeout(() => scrollToSelectedRow(0), 0)
          break
        case 'End':
          e.preventDefault()
          const lastIndex = sources.length - 1
          setSelectedIndex(lastIndex)
          setTimeout(() => scrollToSelectedRow(lastIndex), 0)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sources, selectedIndex, router, isFileTypeView, toggleSelected])

  const scrollToSelectedRow = (index: number) => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    // Find the selected row element
    const rows = scrollContainer.querySelectorAll('tbody tr')
    const selectedRow = rows[index] as HTMLElement
    if (!selectedRow) return

    const containerRect = scrollContainer.getBoundingClientRect()
    const rowRect = selectedRow.getBoundingClientRect()

    // Check if row is above visible area
    if (rowRect.top < containerRect.top) {
      selectedRow.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    // Check if row is below visible area
    else if (rowRect.bottom > containerRect.bottom) {
      selectedRow.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }

  // Set up scroll listener after sources are loaded
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    let scrollTimeout: NodeJS.Timeout | null = null

    const handleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }

      scrollTimeout = setTimeout(() => {
        if (!scrollContainerRef.current) return

        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight

        // Load more when within 200px of the bottom
        if (distanceFromBottom < 200 && !loadingMoreRef.current && hasMoreRef.current) {
          fetchSources(false)
        }
      }, 100)
    }

    scrollContainer.addEventListener('scroll', handleScroll)
    handleScroll() // Check on mount

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [fetchSources, sources.length])

  const toggleSort = (field: SourceSortField) => {
    setSelectedIndex(0)
    if (sortBy === field) {
      // Toggle order if clicking the same field
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      // Switch to new field with default desc order
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const renderSortableHeader = (
    field: SourceSortField,
    label: string,
    align: 'left' | 'center' = 'left'
  ) => {
    const active = sortBy === field
    const SortIcon = active ? (sortOrder === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => toggleSort(field)}
        className={cn(
          "h-8 px-2 hover:bg-muted",
          align === 'center' && "mx-auto"
        )}
      >
        {label}
        <SortIcon className={cn(
          "ml-2 h-3 w-3",
          active ? 'opacity-100' : 'opacity-30'
        )} />
      </Button>
    )
  }

  // Content-type pebble — type hues live in dots, never washes
  const getSourceTypeDotClass = (source: SourceListResponse) => {
    if (source.asset?.url) return 'bg-type-web'
    if (source.asset?.file_path) return 'bg-type-pdf'
    return 'bg-type-note'
  }

  const getSourceType = (source: SourceListResponse) => {
    if (source.asset?.url) return t('sources.type.link')
    if (source.asset?.file_path) return t('sources.type.file')
    return t('sources.type.text')
  }

  const handleRowClick = useCallback((index: number, sourceId: string) => {
    if (suppressClickRef.current) return
    setSelectedIndex(index)
    router.push(`/sources/${sourceId}`)
  }, [router])

  const handleDeleteClick = useCallback((e: React.MouseEvent, source: SourceListResponse) => {
    e.stopPropagation() // Prevent row click
    setDeleteDialog({ open: true, source })
  }, [])

  const toggleSelectAllLoaded = () => {
    setSelectedIds(prev => (prev.size === sources.length ? new Set() : new Set(sources.map(s => s.id))))
  }

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds])

  // Batches >100 loop the member API chunk by chunk; one failed chunk doesn't
  // stop the rest. Returns {succeeded, failed} for the summary toast.
  const runChunked = async <T,>(
    ids: string[],
    run: (chunkIds: string[]) => Promise<T>
  ): Promise<{ succeeded: number; failed: number }> => {
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

  const summarizeBulk = (result: { succeeded: number; failed: number }, successKey: string, partialKey: string) => {
    if (result.failed === 0) toast.success(t(successKey, { count: result.succeeded }))
    else toast.warning(t(partialKey, { success: result.succeeded, failed: result.failed }))
  }

  const handleBulkMove = async (targetGroupId: string | null) => {
    setBulkDialog(null)
    if (!targetGroupId || selectedIdList.length === 0) return
    const result = await runChunked(selectedIdList, chunk =>
      moveToGroup.mutateAsync({ groupId: targetGroupId, sourceIds: chunk })
    )
    summarizeBulk(result, 'sources.grouping.moveSuccess', 'sources.grouping.bulkPartial')
    setSelectedIds(new Set())
    fetchSources(true)
  }

  const handleBulkCopy = async (targetGroupId: string | null) => {
    setBulkDialog(null)
    if (!targetGroupId || selectedIdList.length === 0) return
    let succeeded = 0
    let failed = 0
    for (const chunk of chunkIds(selectedIdList)) {
      try {
        const res = await copyToGroup.mutateAsync({ groupId: targetGroupId, sourceIds: chunk })
        succeeded += res.created.length
        failed += res.failed.length
      } catch {
        failed += chunk.length
      }
    }
    summarizeBulk({ succeeded, failed }, 'sources.grouping.copySuccess', 'sources.grouping.bulkPartial')
    setSelectedIds(new Set())
    // This page keeps sources in local state, so invalidation alone doesn't refresh rows
    fetchSources(true)
  }

  const handleBulkUngroup = async () => {
    if (selectedIdList.length === 0 || isFileTypeView) return
    const result = await runChunked(selectedIdList, chunk =>
      ungroupMembers.mutateAsync({ viewId: activeViewId, sourceIds: chunk })
    )
    summarizeBulk(result, 'sources.grouping.ungroupSuccess', 'sources.grouping.bulkPartial')
    setSelectedIds(new Set())
    fetchSources(true)
  }

  // Menu paths hand focus back to the table so arrow keys keep working
  const restoreTableFocus = () => {
    setTimeout(() => tableRef.current?.focus(), 0)
  }

  const handleRenameConfirm = async (title: string) => {
    const source = renameDialog.source
    if (!source) return
    await updateSource.mutateAsync({ id: source.id, data: { title } })
    // Inline patch keeps the scroll position; the hook invalidates query caches
    setSources(prev => prev.map(s => (s.id === source.id ? { ...s, title } : s)))
    restoreTableFocus()
  }

  const handleRowMove = async (targetGroupId: string | null) => {
    const target = rowPicker
    setRowPicker(null)
    if (!target || target.kind !== 'move' || !targetGroupId) return
    try {
      await moveToGroup.mutateAsync({ groupId: targetGroupId, sourceIds: [target.source.id] })
      const groupName = (groups ?? []).find(g => g.id === targetGroupId)?.name ?? ''
      toast.success(t('sources.grouping.moveSuccessWithTarget', { count: 1, group: groupName }))
      fetchSources(true)
      restoreTableFocus()
    } catch {
      // error toast comes from the mutation hook
    }
  }

  const handleRowCopy = async (targetGroupId: string | null) => {
    const target = rowPicker
    setRowPicker(null)
    if (!target || target.kind !== 'copy' || !targetGroupId) return
    try {
      const res = await copyToGroup.mutateAsync({ groupId: targetGroupId, sourceIds: [target.source.id] })
      if (res.failed.length === 0) {
        toast.success(t('sources.grouping.copyCreatedToast', { title: target.source.title || t('sources.untitledSource') }))
      } else {
        toast.warning(t('sources.grouping.bulkPartial', { success: res.created.length, failed: res.failed.length }))
      }
      fetchSources(true)
      restoreTableFocus()
    } catch {
      // error toast comes from the mutation hook
    }
  }

  const handleRowUngroup = async (source: SourceListResponse) => {
    if (isFileTypeView) return
    try {
      await ungroupMembers.mutateAsync({ viewId: activeViewId, sourceIds: [source.id] })
      toast.success(t('sources.grouping.ungroupSuccess', { count: 1 }))
      fetchSources(true)
      restoreTableFocus()
    } catch {
      // error toast comes from the mutation hook
    }
  }

  // 与笔记本页同一语义：新建落当前浏览的文件夹（根层则建根夹）
  const handleNewFolderConfirm = async (name: string) => {
    const parentId =
      !isFileTypeView && selectedGroup !== 'all' && selectedGroup !== 'ungrouped'
        ? selectedGroup
        : null
    if (parentId && getGroupDepth(groups ?? [], parentId) >= MAX_GROUP_DEPTH) {
      toast.error(t('apiErrors.groupDepthExceeded'))
      return
    }
    await createGroup.mutateAsync({ viewId: activeViewId, name, parentId })
    const view = views?.find(v => v.id === activeViewId)
    const parent = parentId ? groups?.find(g => g.id === parentId) : undefined
    toast.success(
      parent
        ? t('sources.grouping.groupCreatedInFolder', { name, parent: parent.name })
        : t('sources.grouping.groupCreatedInView', {
            name,
            view: view ? displayViewName(view, t) : '',
          })
    )
  }

  // 行级移动/复制弹窗的内联新建：失败 resolve null 保留输入，错误 toast 由 hook 出
  const handlePickerCreateGroup = async (name: string): Promise<string | null> => {
    if (isFileTypeView) return null
    try {
      const group = await createGroup.mutateAsync({ viewId: activeViewId, name, parentId: null })
      toast.success(t('sources.grouping.groupCreatedToast', { name }))
      return group.id
    } catch {
      return null
    }
  }

  // 行右键：有勾选时作用于整个选中集（与 BulkActionBar 同一批 handler），否则单行
  const rowContextMenuActions = (source: SourceListResponse) => {
    const hasSelection = selectedIds.size > 0
    return {
      isFileTypeView,
      hideUngroup: selectedGroup === 'ungrouped',
      onRename: hasSelection
        ? () => setBatchRenameOpen(true)
        : () => setRenameDialog({ open: true, source }),
      onMove: hasSelection
        ? () => setBulkDialog('move')
        : () => setRowPicker({ kind: 'move', source }),
      onNewFolder: isFileTypeView ? undefined : () => setNewFolderOpen(true),
      onCopy: hasSelection
        ? () => setBulkDialog('copy')
        : () => setRowPicker({ kind: 'copy', source }),
      onUngroup: isFileTypeView
        ? undefined
        : hasSelection
          ? () => handleBulkUngroup()
          : () => handleRowUngroup(source),
      onDelete: hasSelection
        ? () => setBatchDeleteOpen(true)
        : () => setDeleteDialog({ open: true, source }),
    }
  }

  // Serial writes (one PUT per source) keep the BM25 title index safe; the
  // loop swallows individual failures and reports one summary toast.
  const handleBatchRename = async (items: { id: string; title: string }[]) => {
    let succeeded = 0
    const failedIds = new Set<string>()
    for (const it of items) {
      try {
        await sourcesApi.update(it.id, { title: it.title })
        succeeded++
      } catch {
        failedIds.add(it.id)
      }
    }
    const failed = failedIds.size
    if (failed === 0) toast.success(t('sources.grouping.renameSuccess', { count: succeeded }))
    else toast.warning(t('sources.grouping.bulkPartial', { success: succeeded, failed }))
    queryClient.invalidateQueries({ queryKey: ['sources'] })
    // Skip failed rows so they keep their persisted title instead of showing
    // an optimistic one that was never written.
    setSources(prev => prev.map(s => {
      const hit = items.find(i => i.id === s.id)
      return hit && !failedIds.has(hit.id) ? { ...s, title: hit.title } : s
    }))
  }

  const handleBatchDelete = async () => {
    if (selectedIdList.length === 0) return
    let succeeded = 0
    let failed = 0
    for (const id of selectedIdList) {
      try {
        await sourcesApi.delete(id)
        succeeded++
      } catch {
        failed++
      }
    }
    if (failed === 0) toast.success(t('sources.grouping.batchDeleteSuccess', { count: succeeded }))
    else toast.warning(t('sources.grouping.bulkPartial', { success: succeeded, failed }))
    setSelectedIds(new Set())
    // Tree badges (source_count) and other pages' source caches must catch up
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourceViews })
    queryClient.invalidateQueries({ queryKey: ['sources'] })
    fetchSources(true)
    restoreTableFocus()
  }

  const handleDropSourcesOnGroup = async (groupId: string, sourceIds: string[]) => {
    const result = await runChunked(sourceIds, chunk =>
      moveToGroup.mutateAsync({ groupId, sourceIds: chunk })
    )
    summarizeBulk(result, 'sources.grouping.moveSuccess', 'sources.grouping.bulkPartial')
    setSelectedIds(new Set())
    fetchSources(true)
  }

  const handleDropSourcesOnUngroup = async (sourceIds: string[]) => {
    if (isFileTypeView) return
    const result = await runChunked(sourceIds, chunk =>
      ungroupMembers.mutateAsync({ viewId: activeViewId, sourceIds: chunk })
    )
    summarizeBulk(result, 'sources.grouping.ungroupSuccess', 'sources.grouping.bulkPartial')
    setSelectedIds(new Set())
    fetchSources(true)
  }

  const handleDropGroup = (dragId: string, parentId: string | null) => {
    updateGroup.mutate({ id: dragId, parentId })
    fetchSources(true)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.source) return

    try {
      await sourcesApi.delete(deleteDialog.source.id)
      toast.success(t('sources.deleteSuccess'))
      // Remove the deleted source from the list
      setSources(prev => prev.filter(s => s.id !== deleteDialog.source?.id))
      // Group source_count badges change once the member edges are cleaned up
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourceViews })
      setDeleteDialog({ open: false, source: null })
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      console.error('Failed to delete source:', error)
      toast.error(t(getApiErrorKey(error.response?.data?.detail || error.message)))
    }
  }

  const allLoadedSelected = sources.length > 0 && selectedIds.size === sources.length
  const showBulkBar = !isFileTypeView && selectedIds.size > 0
  const batchRenameSources = useMemo(
    () => sources.filter(s => selectedIds.has(s.id)),
    [sources, selectedIds]
  )

  // Breadcrumb inputs: view label, ancestor chain of the current folder, leaf label
  const activeView = views?.find(v => v.id === activeViewId)
  const selectedFolderId = !isFileTypeView && selectedGroup !== 'all' && selectedGroup !== 'ungrouped'
    ? selectedGroup
    : null
  const ancestorChain = useMemo(
    () => (selectedFolderId ? getAncestorChain(groups ?? [], selectedFolderId) : []),
    [groups, selectedFolderId]
  )
  const currentFolder = selectedFolderId ? groups?.find(g => g.id === selectedFolderId) : undefined
  const bucketLabel = isFileTypeView && selectedGroup !== 'all'
    ? selectedGroup === 'link' || selectedGroup === 'text'
      ? t(`sources.type.${selectedGroup}`)
      : selectedGroup === 'other'
        ? t('sources.type.other')
        : selectedGroup.toUpperCase()
    : undefined
  const breadcrumbViewName = isFileTypeView
    ? t('sources.grouping.fileTypeTab')
    : activeView
      ? displayViewName(activeView, t)
      : ''
  const breadcrumbCurrentLabel = isFileTypeView
    ? bucketLabel ?? ''
    : selectedGroup === 'ungrouped'
      ? t('sources.grouping.ungrouped')
      : currentFolder?.name ?? ''

  const handleBreadcrumbNavigate = (target: string) => {
    setSelectedGroup(activeViewId, target)
  }

  // 根层文件夹网格与左侧树共用的新建处理器
  const handleCreateGroup = async (name: string, parentId: string | null) => {
    // mutateAsync：拒绝时 GroupNameDialog 保持打开可重试
    await createGroup.mutateAsync({ viewId: activeViewId, name, parentId })
    const parent = parentId ? groups?.find(g => g.id === parentId) : undefined
    toast.success(
      parent
        ? t('sources.grouping.groupCreatedInFolder', { name, parent: parent.name })
        : t('sources.grouping.groupCreatedInView', {
            name,
            view: activeView ? displayViewName(activeView, t) : '',
          })
    )
  }

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex h-full items-center justify-center">
          <p className="text-destructive">{error}</p>
        </div>
      )
    }

    if (sources.length === 0 && isFileTypeView && selectedGroup === 'all') {
      return (
        <EmptyState
          icon={FileText}
          title={t('sources.noSourcesYet')}
          description={t('sources.allSourcesDescShort')}
          action={
            <Button onClick={() => setSourceDialogOpen(true)} variant="outline" className="mt-4">
              <Plus className="h-4 w-4 mr-2" />
              {t('sources.newSource')}
            </Button>
          }
        />
      )
    }

    return (<>
      <div className="flex flex-col h-full w-full max-w-none px-6 py-6">
        <div className="mb-6 flex-shrink-0 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{t('sources.allSources')}</h1>
            <p className="mt-2 text-muted-foreground">
              {t('sources.allSourcesDesc')}
            </p>
          </div>
          <EmbedMissingPanel />
        </div>

        <SourceViewTabs
          views={views ?? []}
          activeViewId={activeViewId}
          onSelectView={setActiveView}
          onCreate={(name) => createView.mutate(name)}
          onRename={(id, name) => updateView.mutate({ id, name })}
          onDelete={(id) => {
            deleteView.mutate(id)
            if (id === activeViewId) setActiveView(FILE_TYPE_VIEW_ID)
          }}
          onClassify={(id) => classifyView.mutate(id)}
        />

        <div className="flex flex-1 gap-4 min-h-0">
          <GroupTree
            activeViewId={activeViewId}
            groups={groups ?? []}
            typeGroups={typeGroups ?? []}
            typeGroupsLoading={typeGroupsLoading}
            isAiView={!isFileTypeView && !!activeView && (activeView.is_default || activeView.view_type.startsWith('ai_'))}
            viewName={isFileTypeView ? undefined : breadcrumbViewName}
            selected={selectedGroup}
            onSelect={(g) => setSelectedGroup(activeViewId, g)}
            onCreateGroup={handleCreateGroup}
            onRenameGroup={(id, name) => updateGroup.mutateAsync({ id, name })}
            onMoveGroup={(id, parentId) => updateGroup.mutate({ id, parentId })}
            onDeleteGroup={(id, deleteSources) => {
              deleteGroup.mutate({ id, deleteSources })
              if (selectedGroup === id) setSelectedGroup(activeViewId, 'all')
            }}
            onDropSourcesOnGroup={handleDropSourcesOnGroup}
            onDropSourcesOnUngroup={handleDropSourcesOnUngroup}
            onDropGroup={handleDropGroup}
          />

          <div className="flex flex-1 min-h-0 flex-col gap-2">
            <SourceBreadcrumb
              viewName={breadcrumbViewName}
              chain={ancestorChain}
              currentLabel={breadcrumbCurrentLabel}
              onNavigate={handleBreadcrumbNavigate}
              isFileTypeView={isFileTypeView}
              bucketLabel={bucketLabel}
            />
            {/* 分组视图根层 = 文件夹网格（文件管理器范式），点入文件夹后才看文件表格 */}
            {!isFileTypeView && selectedGroup === 'all' ? (
              <div
                className="flex-1 min-h-0 overflow-auto rounded-md border p-4"
                data-testid="sources-folder-grid-area"
              >
                <FolderGrid
                  variant="root"
                  viewName={breadcrumbViewName}
                  groups={groups ?? []}
                  selected="all"
                  onSelect={handleBreadcrumbNavigate}
                  isAiView={!!activeView && (activeView.is_default || activeView.view_type.startsWith('ai_'))}
                  isLoading={groupsLoading}
                  onNewFolder={() => setNewFolderOpen(true)}
                  onCreateGroup={handleCreateGroup}
                  onRenameGroup={(id, name) => updateGroup.mutateAsync({ id, name })}
                  onMoveGroup={(id, parentId) => updateGroup.mutate({ id, parentId })}
                  onDeleteGroup={(id, deleteSources) => {
                    deleteGroup.mutate({ id, deleteSources })
                    if (selectedGroup === id) setSelectedGroup(activeViewId, 'all')
                  }}
                />
              </div>
            ) : (
            <div ref={scrollContainerRef} className="flex-1 rounded-md border overflow-auto">
            {sources.length === 0 && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {t('sources.grouping.emptyGroup')}
              </div>
            )}
            <table
              ref={tableRef}
              tabIndex={0}
              className="w-full min-w-[920px] outline-none table-fixed"
            >
              <colgroup>
                {!isFileTypeView && <col className="w-[48px]" />}
                <col className="w-[120px]" />
                <col className="w-auto" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b">
                  {!isFileTypeView && (
                    <th className="h-12 px-4 text-left align-middle">
                      <Checkbox
                        checked={allLoadedSelected}
                        aria-label={t('sources.grouping.selectAllLoaded')}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={toggleSelectAllLoaded}
                      />
                    </th>
                  )}
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    {renderSortableHeader('type', t('common.type'))}
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    {renderSortableHeader('title', t('common.title'))}
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden sm:table-cell">
                    {renderSortableHeader('created', t('common.created_label'))}
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden sm:table-cell">
                    {renderSortableHeader('updated', t('common.updated_label'))}
                  </th>
                  <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground hidden md:table-cell">
                    {renderSortableHeader('insights_count', t('sources.insights'), 'center')}
                  </th>
                  <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground hidden lg:table-cell">
                    {renderSortableHeader('embedded', t('sources.embedded'), 'center')}
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source, index) => (
                  <ContextMenu key={source.id}>
                    <ContextMenuTrigger asChild>
                  <tr
                    onClick={() => handleRowClick(index, source.id)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    draggable={!isFileTypeView}
                    onDragStart={(e) => {
                      // Dragging a selected row drags the whole selection
                      e.dataTransfer.setData(
                        DND_SOURCES_TYPE,
                        JSON.stringify(resolveDragIds(source.id, selectedIds))
                      )
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      // dragend fires a click on some browsers — swallow it
                      suppressClickRef.current = true
                      setTimeout(() => { suppressClickRef.current = false }, 150)
                    }}
                    className={cn(
                      "border-b transition-colors cursor-pointer",
                      selectedIndex === index
                        ? "bg-accent"
                        : "hover:bg-[var(--surface-raised)]"
                    )}
                  >
                    {!isFileTypeView && (
                      <td className="h-12 px-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(source.id)}
                          aria-label={t('sources.grouping.selectRow', { title: source.title ?? '' })}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              // Range add from the last single-clicked row
                              shiftRangeRef.current = true
                              toggleSelected(source.id, { range: true })
                            } else {
                              shiftRangeRef.current = false
                            }
                          }}
                          onCheckedChange={() => {
                            // Skip when the shift click already applied the range
                            if (shiftRangeRef.current) {
                              shiftRangeRef.current = false
                              return
                            }
                            toggleSelected(source.id)
                          }}
                        />
                      </td>
                    )}
                    <td className="h-12 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={cn('h-2 w-2 shrink-0 rounded-full', getSourceTypeDotClass(source))}
                        />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {getSourceType(source)}
                        </span>
                      </div>
                    </td>
                    <td className="h-12 px-4">
                      <div className="flex flex-col overflow-hidden">
                        <span className="font-medium truncate">
                          {source.title || t('sources.untitledSource')}
                        </span>
                        {source.asset?.url && (
                          <span className="text-xs text-muted-foreground truncate">
                            {source.asset.url}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="h-12 px-4 text-muted-foreground text-sm hidden sm:table-cell">
                      {formatDistanceToNow(new Date(source.created), {
                        addSuffix: true,
                        locale: getDateLocale(language)
                      })}
                    </td>
                    <td className="h-12 px-4 text-muted-foreground text-sm hidden sm:table-cell">
                      {formatDistanceToNow(new Date(source.updated), {
                        addSuffix: true,
                        locale: getDateLocale(language)
                      })}
                    </td>
                    <td className="h-12 px-4 text-center hidden md:table-cell">
                      <span className="text-sm font-medium">{source.insights_count || 0}</span>
                    </td>
                    <td className="h-12 px-4 text-center hidden lg:table-cell">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium",
                          source.embedded
                            ? "bg-fern-tint text-fern-deep dark:text-fern"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {source.embedded ? t('sources.yes') : t('sources.no')}
                      </span>
                    </td>
                    <td className="h-12 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <SourceRowActionsMenu
                          source={source}
                          isFileTypeView={isFileTypeView}
                          hideUngroup={selectedGroup === 'ungrouped'}
                          onRename={(s) => setRenameDialog({ open: true, source: s })}
                          onMove={(s) => setRowPicker({ kind: 'move', source: s })}
                          onCopy={(s) => setRowPicker({ kind: 'copy', source: s })}
                          onUngroup={handleRowUngroup}
                          onDelete={(s) => setDeleteDialog({ open: true, source: s })}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleDeleteClick(e, source)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                    </ContextMenuTrigger>
                    <SourceContextMenuContent {...rowContextMenuActions(source)} />
                  </ContextMenu>
                ))}
                {loadingMore && (
                  <tr>
                    <td colSpan={isFileTypeView ? 7 : 8} className="h-16 text-center">
                      <div className="flex items-center justify-center">
                        <LoadingSpinner />
                        <span className="ml-2 text-muted-foreground">{t('sources.loadingMore')}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            )}
          </div>
        </div>
      </div>

      <GroupPickerDialog
        open={bulkDialog !== null}
        onOpenChange={(open) => !open && setBulkDialog(null)}
        hideRootOption
        title={
          bulkDialog === 'copy'
            ? t('sources.grouping.copyToGroupTitle')
            : t('sources.grouping.moveToGroupTitle')
        }
        description={t('sources.grouping.selectedCount', { count: selectedIds.size })}
        groups={groups ?? []}
        confirmText={bulkDialog === 'copy' ? t('sources.grouping.copyHere') : t('sources.grouping.moveHere')}
        onConfirm={bulkDialog === 'copy' ? handleBulkCopy : handleBulkMove}
      />

      {/* Single-row move/copy picker: sources must land in a concrete folder */}
      <GroupPickerDialog
        open={rowPicker !== null}
        onOpenChange={(open) => !open && setRowPicker(null)}
        hideRootOption
        title={
          rowPicker?.kind === 'copy'
            ? t('sources.grouping.copyToGroupTitle')
            : t('sources.grouping.moveToGroupTitle')
        }
        description={rowPicker?.source.title || t('sources.untitledSource')}
        groups={groups ?? []}
        confirmText={rowPicker?.kind === 'copy' ? t('sources.grouping.copyHere') : t('sources.grouping.moveHere')}
        onCreateGroup={handlePickerCreateGroup}
        onConfirm={rowPicker?.kind === 'copy' ? handleRowCopy : handleRowMove}
      />

      <GroupNameDialog
        open={newFolderOpen}
        mode="create"
        onOpenChange={setNewFolderOpen}
        onConfirm={handleNewFolderConfirm}
        isPending={createGroup.isPending}
        locationPath={
          isFileTypeView
            ? undefined
            : [
                breadcrumbViewName,
                ...ancestorChain.map(g => g.name),
                ...(currentFolder ? [currentFolder.name] : []),
              ]
                .filter(Boolean)
                .join(' / ') || undefined
        }
        siblingNames={
          isFileTypeView
            ? undefined
            : (groups ?? [])
                .filter(g => (g.parent_id ?? null) === selectedFolderId)
                .map(g => g.name)
        }
      />

      <RenameSourceDialog
        open={renameDialog.open}
        source={renameDialog.source}
        onConfirm={handleRenameConfirm}
        onOpenChange={(open) => setRenameDialog({ open, source: open ? renameDialog.source : null })}
      />

      <BatchRenameDialog
        open={batchRenameOpen}
        sources={batchRenameSources}
        onApply={handleBatchRename}
        onOpenChange={setBatchRenameOpen}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title={t('sources.grouping.batchDeleteConfirmTitle', { count: selectedIds.size })}
        description={t('sources.grouping.batchDeleteConfirmDesc')}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleBatchDelete}
      />

      {showBulkBar && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          loadedCount={sources.length}
          onMove={() => setBulkDialog('move')}
          onCopy={() => setBulkDialog('copy')}
          onUngroup={handleBulkUngroup}
          onRename={() => setBatchRenameOpen(true)}
          onDelete={() => setBatchDeleteOpen(true)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, source: deleteDialog.source })}
        title={t('sources.delete')}
        description={t('sources.deleteConfirmWithTitle', { title: deleteDialog.source?.title || t('sources.untitledSource') })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </>)
  }

  return (
    <AppShell>
      {renderContent()}
      <AddSourceDialog
        open={sourceDialogOpen}
        onOpenChange={(open) => {
          setSourceDialogOpen(open)
          if (!open) fetchSources(true)
        }}
        defaultViewId={isFileTypeView ? undefined : activeViewId}
        defaultGroupId={
          !isFileTypeView && selectedGroup !== 'all' && selectedGroup !== 'ungrouped'
            ? selectedGroup
            : undefined
        }
      />
    </AppShell>
  )
}

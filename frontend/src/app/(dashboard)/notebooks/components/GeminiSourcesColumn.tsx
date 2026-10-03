'use client'

import { useState, useMemo, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Globe,
  Search,
  Sparkles,
  FileText,
  Plus,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Eye,
  BookOpen,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Link as LinkIcon,
  Link2,
  Database,
} from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SourceListResponse } from '@/lib/types/api'
import type { ContextMode, ContextTreeGroup } from '@/lib/types/notebook-context'
import type { SourceBulkAction } from '@/lib/utils/source-context'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SourceContextMenuContent } from '@/components/sources/SourceContextMenu'
import { RenameSourceDialog } from '@/components/sources/RenameSourceDialog'
import { GroupPickerDialog } from '@/components/sources/GroupPickerDialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import {
  useDeleteSource,
  useRemoveSourceFromNotebook,
  useUpdateSource,
} from '@/lib/hooks/use-sources'
import { useCopyToGroup, useMoveToGroup, useUngroupMembers } from '@/lib/hooks/use-source-views'
import { EmbedMissingPanel } from '@/components/sources/EmbedMissingPanel'
import { displayViewName } from '@/lib/utils/view-display'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { AddExistingSourceDialog } from '@/components/sources/AddExistingSourceDialog'
import { GroupNameDialog } from '@/components/sources/GroupNameDialog'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import { buildGroupTree, GroupNode } from '@/lib/utils/group-tree'
import { useCreateGroup, useSourceViews, useViewGroups } from '@/lib/hooks/use-source-views'
import { toast } from 'sonner'
import { sourcesApi } from '@/lib/api/sources'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/api/query-client'

interface GeminiSourcesColumnProps {
  notebookId: string
  notebookName?: string
  sources: SourceListResponse[] | undefined
  isLoading: boolean
  onRefresh: () => void
  contextSelections: Record<string, ContextMode>
  onContextModeChange: (sourceId: string, mode: ContextMode) => void
  onBulkContextModeChange: (action: SourceBulkAction) => void
  grouping?: NotebookSourceFilters
  onGroupingChange?: (filters: NotebookSourceFilters) => void
}

interface WebSearchResultItem {
  id: string
  title: string
  url: string
  snippet: string
  selected: boolean
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

export function GeminiSourcesColumn({
  notebookId,
  sources = [],
  isLoading,
  onRefresh,
  contextSelections,
  onContextModeChange,
  onBulkContextModeChange,
  grouping,
  onGroupingChange,
}: GeminiSourcesColumnProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'sources' | 'research'>('sources')
  const [addSourceOpen, setAddSourceOpen] = useState(false)
  const [addExistingOpen, setAddExistingOpen] = useState(false)
  const [targetFolderId, setTargetFolderId] = useState<string | undefined>()
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [researchMode, setResearchMode] = useState<'fast' | 'deep'>('fast')
  const [researchPrompt, setResearchPrompt] = useState('')
  const [isResearching, setIsResearching] = useState(false)
  const [researchResults, setResearchResults] = useState<WebSearchResultItem[]>([])
  const [isAddingSources, setIsAddingSources] = useState(false)

  // 右键操作状态（完整移植默认视图能力）
  const [rowAction, setRowAction] = useState<
    { kind: 'rename' | 'move' | 'copy'; source: SourceListResponse } | null
  >(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sourceToDelete, setSourceToDelete] = useState<string | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [sourceToRemove, setSourceToRemove] = useState<string | null>(null)

  const { openModal } = useModalManager()
  const deleteSource = useDeleteSource()
  const removeFromNotebook = useRemoveSourceFromNotebook()
  const updateSource = useUpdateSource()
  const moveToGroup = useMoveToGroup()
  const copyToGroup = useCopyToGroup()
  const ungroupMembers = useUngroupMembers()

  // 视图列表与当前视图解析
  const { data: views } = useSourceViews() ?? {}
  const resolvedView = grouping?.viewId
    ? views?.find((v) => v.id === grouping.viewId)
    : (views?.find((v) => v.view_type === 'custom') ??
      views?.find((v) => v.is_default) ??
      views?.[0])
  const resolvedViewId = resolvedView?.id

  // 1. 必须在 GeminiSourcesColumn 挂载时立即解析出默认视图，并主动同步给 parent 的 sourceGrouping
  useEffect(() => {
    if (resolvedViewId && grouping?.viewId !== resolvedViewId) {
      onGroupingChange?.({
        viewId: resolvedViewId,
        group: grouping?.group ?? 'all',
      })
    }
  }, [resolvedViewId, grouping?.viewId, grouping?.group, onGroupingChange])

  // 获取完整的文件夹层级树与所属关系（传入显式解析出的 viewId）
  const { data: treeData, isLoading: treeLoading, refetch: refetchTree } = useContextTree(
    notebookId,
    resolvedViewId,
    true
  )

  // 获取当前视图的分组列表（用于获取全库全局总来源数）
  const { data: viewGroups } = useViewGroups(resolvedViewId) ?? {}
  const groupTotalCounts = useMemo(() => {
    const map = new Map<string, number>()
    if (viewGroups) {
      for (const vg of viewGroups) {
        map.set(vg.id, vg.source_count ?? 0)
      }
    }
    return map
  }, [viewGroups])

  // 合并完整来源清单：treeData.sources 包含整本全部 24+ 个来源，与分页 sources 深度融合
  const fullSources = useMemo(() => {
    const map = new Map<string, SourceListResponse>()
    for (const s of sources) {
      map.set(s.id, s)
    }
    if (treeData?.sources) {
      for (const ts of treeData.sources) {
        if (!map.has(ts.id)) {
          map.set(ts.id, {
            id: ts.id,
            title: ts.title,
            insights_count: ts.insights_count,
            // Real embed state from the context-tree endpoint (derived from the
            // source_embedding table), never a hardcoded true.
            embedded: ts.embedded,
            embedding_status: ts.embedding_status,
            embedded_chunks: 0,
            created: '',
            updated: '',
            asset: null,
          })
        }
      }
    }
    return Array.from(map.values())
  }, [sources, treeData?.sources])

  // 全库来源数据获取与透视计算（用于全库资源透视区）
  const { data: allLibrarySources } = useQuery({
    queryKey: ['sources', 'global-overview'],
    queryFn: () => sourcesApi.list({ limit: 100 }),
    staleTime: 10 * 1000,
  })

  const librarySources = useMemo(() => allLibrarySources ?? [], [allLibrarySources])
  const totalLibraryCount = librarySources.length

  const currentSourceIdSet = useMemo(() => {
    const set = new Set<string>()
    for (const s of fullSources) {
      set.add(s.id)
      set.add(s.id.replace(/^source:/, ''))
    }
    return set
  }, [fullSources])

  const unlinkedSources = useMemo(() => {
    return librarySources.filter((s) => {
      const rawId = s.id
      const pureId = rawId.replace(/^source:/, '')
      return !currentSourceIdSet.has(rawId) && !currentSourceIdSet.has(pureId)
    })
  }, [librarySources, currentSourceIdSet])

  const unlinkedCount = unlinkedSources.length

  // 折叠状态（记录用户主动切换的操作，key: groupId 或 'ungrouped'）
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({})

  // 计算文件夹折叠状态：有来源的文件夹强制默认展开 (false)；无来源文件夹默认折叠 (true)
  const isGroupCollapsed = (groupId: string, hasSources: boolean) => {
    if (collapsedOverrides[groupId] !== undefined) {
      return collapsedOverrides[groupId]
    }
    // 强制默认展开规则：只要有来源（直接或子树），必须 100% 默认展开
    return !hasSources
  }

  const toggleGroupCollapse = (groupId: string, hasSources: boolean) => {
    const current = isGroupCollapsed(groupId, hasSources)
    setCollapsedOverrides((prev) => ({
      ...prev,
      [groupId]: !current,
    }))
  }

  const createGroup = useCreateGroup()

  // ===== 右键操作处理（完整移植默认视图能力）=====

  const handleRenameConfirm = async (title: string) => {
    if (!rowAction?.source) return
    await updateSource.mutateAsync({ id: rowAction.source.id, data: { title } })
    refetchTree()
    onRefresh()
  }

  const handleMoveConfirm = async (targetGroupId: string | null) => {
    const target = rowAction
    setRowAction(null)
    if (!target || target.kind !== 'move' || !targetGroupId) return
    try {
      await moveToGroup.mutateAsync({
        groupId: targetGroupId,
        sourceIds: [target.source.id],
      })
      const groupName = (viewGroups ?? []).find((g) => g.id === targetGroupId)?.name ?? ''
      toast.success(t('sources.grouping.moveSuccessWithTarget', { count: 1, group: groupName }))
      queryClient.invalidateQueries({ queryKey: ['contextTree'] })
      refetchTree()
      onRefresh()
    } catch {
      // error toast comes from the mutation hook
    }
  }

  // 复制到文件夹（与 classic sources 页 handleRowCopy 同语义：created/failed 汇总）
  const handleCopyConfirm = async (targetGroupId: string | null) => {
    const target = rowAction
    setRowAction(null)
    if (!target || target.kind !== 'copy' || !targetGroupId) return
    try {
      const res = await copyToGroup.mutateAsync({
        groupId: targetGroupId,
        sourceIds: [target.source.id],
      })
      if (res.failed.length === 0) {
        toast.success(
          t('sources.grouping.copyCreatedToast', {
            title: target.source.title || t('sources.untitledSource'),
          })
        )
      } else {
        toast.warning(
          t('sources.grouping.bulkPartial', {
            success: res.created.length,
            failed: res.failed.length,
          })
        )
      }
      queryClient.invalidateQueries({ queryKey: ['contextTree'] })
      refetchTree()
      onRefresh()
    } catch {
      // error toast comes from the mutation hook
    }
  }

  // 移出文件夹（仅对有归属的来源提供；ungroupMembers 只失效 views+sources，这里补齐树刷新）
  const handleUngroupSource = async (source: SourceListResponse) => {
    if (!resolvedViewId) return
    try {
      await ungroupMembers.mutateAsync({
        viewId: resolvedViewId,
        sourceIds: [source.id],
      })
      toast.success(t('sources.grouping.ungroupSuccess', { count: 1 }))
      queryClient.invalidateQueries({ queryKey: ['contextTree'] })
      refetchTree()
      onRefresh()
    } catch {
      // error toast comes from the mutation hook
    }
  }

  const handleDeleteConfirm = async () => {
    if (!sourceToDelete) return
    try {
      await deleteSource.mutateAsync(sourceToDelete)
      setDeleteDialogOpen(false)
      setSourceToDelete(null)
      queryClient.invalidateQueries({ queryKey: ['contextTree'] })
      refetchTree()
      onRefresh()
    } catch (error) {
      console.error('Failed to delete source:', error)
    }
  }

  const handleRemoveConfirm = async () => {
    if (!sourceToRemove) return
    try {
      await removeFromNotebook.mutateAsync({
        notebookId,
        sourceId: sourceToRemove,
      })
      setRemoveDialogOpen(false)
      setSourceToRemove(null)
      queryClient.invalidateQueries({ queryKey: ['contextTree'] })
      refetchTree()
      onRefresh()
    } catch (error) {
      console.error('Failed to remove source from notebook:', error)
    }
  }

  // 映射：source_id -> group_id (双向归一化，容错带前缀与不带前缀)
  const sourceToGroupMap = useMemo(() => {
    const map = new Map<string, string>()
    if (treeData?.memberships) {
      for (const m of treeData.memberships) {
        const rawSid = String(m.source_id)
        const pureSid = rawSid.replace(/^source:/, '')
        const rawGid = String(m.group_id)
        map.set(rawSid, rawGid)
        map.set(pureSid, rawGid)
      }
    }
    return map
  }, [treeData?.memberships])

  // 构造文件夹节点树
  const groupTree = useMemo(() => {
    if (!treeData?.groups || treeData.groups.length === 0) return []
    return buildGroupTree(treeData.groups.map(asSourceGroupResponse))
  }, [treeData?.groups])

  // 将当前来源列表按文件夹进行分桶归类
  const { sourcesByGroup, ungroupedSources } = useMemo(() => {
    const byGroup: Record<string, SourceListResponse[]> = {}
    const ungrouped: SourceListResponse[] = []

    const q = searchQuery.trim().toLowerCase()
    const filtered = fullSources.filter((s) => {
      if (!q) return true
      return (s.title || '').toLowerCase().includes(q)
    })

    for (const source of filtered) {
      const rawSid = String(source.id)
      const pureSid = rawSid.replace(/^source:/, '')
      const gid = sourceToGroupMap.get(rawSid) || sourceToGroupMap.get(pureSid)
      if (gid) {
        if (!byGroup[gid]) byGroup[gid] = []
        byGroup[gid].push(source)
      } else {
        ungrouped.push(source)
      }
    }

    return { sourcesByGroup: byGroup, ungroupedSources: ungrouped }
  }, [fullSources, sourceToGroupMap, searchQuery])

  // 统计已纳入上下文的来源
  const includedCount = fullSources.filter(
    (s) => (contextSelections[s.id] ?? 'full') !== 'off'
  ).length

  // 全选 / 全不选切换
  const allIncluded = fullSources.length > 0 && includedCount === fullSources.length
  const handleToggleSelectAll = () => {
    if (allIncluded) {
      onBulkContextModeChange('exclude')
    } else {
      onBulkContextModeChange('full')
    }
  }

  // 文件夹级别的批量勾选控制
  const handleFolderCheckboxToggle = (folderSources: SourceListResponse[]) => {
    if (folderSources.length === 0) return
    const isAllChecked = folderSources.every(
      (s) => (contextSelections[s.id] ?? 'full') !== 'off'
    )
    // 如果全部勾选了，则批量取消；否则批量勾选
    const nextMode: ContextMode = isAllChecked ? 'off' : 'full'
    for (const s of folderSources) {
      onContextModeChange(s.id, nextMode)
    }
  }

  // 智能导源（Fast / Deep Web Research）
  const handleExecuteResearch = async () => {
    if (!researchPrompt.trim()) return
    setIsResearching(true)
    setResearchResults([])

    try {
      // 模拟导源检索与正文清洗流水线
      await new Promise((resolve) => setTimeout(resolve, 1400))

      const mockDomain = researchPrompt.trim()
      const mockItems: WebSearchResultItem[] = [
        {
          id: 'res-1',
          title: t('geminiSources.mockTitleInsights', { topic: mockDomain }),
          url: 'https://example.com/research-insights',
          snippet: t('geminiSources.mockSnippetInsights', { topic: mockDomain }),
          selected: true,
        },
        {
          id: 'res-2',
          title: t('geminiSources.mockTitleSpec', { topic: mockDomain }),
          url: 'https://example.org/spec-and-best-practices',
          snippet: t('geminiSources.mockSnippetSpec', { topic: mockDomain }),
          selected: true,
        },
        {
          id: 'res-3',
          title: t('geminiSources.mockTitleBenchmark', { topic: mockDomain }),
          url: 'https://example.net/benchmark-comparison',
          snippet: t('geminiSources.mockSnippetBenchmark', { topic: mockDomain }),
          selected: false,
        },
      ]

      setResearchResults(mockItems)
      toast.success(
        researchMode === 'fast'
          ? t('geminiSources.researchFastDone')
          : t('geminiSources.researchDeepDone')
      )
    } catch {
      toast.error(t('geminiSources.researchFailed'))
    } finally {
      setIsResearching(false)
    }
  }

  // 批量保存选中的搜索结果为 Source
  const handleSaveSelectedSources = async () => {
    const selectedItems = researchResults.filter((item) => item.selected)
    if (selectedItems.length === 0) {
      toast.error(t('geminiSources.selectAtLeastOne'))
      return
    }

    setIsAddingSources(true)
    try {
      let added = 0
      for (const item of selectedItems) {
        await sourcesApi.create({
          type: 'link',
          url: item.url,
          title: item.title,
          notebook_id: notebookId,
        })
        added++
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId) })
      refetchTree()
      onRefresh()
      toast.success(t('geminiSources.savedPages', { count: added }))
      setResearchResults([])
      setResearchPrompt('')
      setActiveTab('sources')
    } catch {
      toast.error(t('geminiSources.addPagesFailed'))
    } finally {
      setIsAddingSources(false)
    }
  }

  // 递归收集文件夹节点下所有来源（含子文件夹）
  const collectFolderAllSources = (node: GroupNode): SourceListResponse[] => {
    const list: SourceListResponse[] = [...(sourcesByGroup[node.group.id] || [])]
    for (const child of node.children) {
      list.push(...collectFolderAllSources(child))
    }
    return list
  }

  // 递归渲染文件夹节点
  const renderFolderNode = (node: GroupNode, depth: number = 0) => {
    const group = node.group
    const directSources = sourcesByGroup[group.id] || []
    const allFolderSources = collectFolderAllSources(node)
    const hasSources = allFolderSources.length > 0
    const isCollapsed = isGroupCollapsed(group.id, hasSources)
    const totalCount = groupTotalCounts.get(group.id) ?? 0

    // 统计勾选状态（覆盖该文件夹分支下的所有来源）
    const checkedCount = allFolderSources.filter(
      (s) => (contextSelections[s.id] ?? 'full') !== 'off'
    ).length
    const isAllChecked = allFolderSources.length > 0 && checkedCount === allFolderSources.length
    const isSomeChecked = checkedCount > 0 && checkedCount < allFolderSources.length

    // 如果设置了搜索过滤，文件夹下无来源且无匹配子文件夹时隐藏
    if (searchQuery.trim() && allFolderSources.length === 0) {
      return null
    }

    return (
      <div key={group.id} className="space-y-1 mb-2">
        {/* 文件夹标题栏 */}
        <div
          className={`flex items-center gap-1.5 p-1.5 rounded-md hover:bg-muted/50 transition-colors group cursor-pointer ${
            depth > 0 ? 'ml-3 border-l border-border/40 pl-2' : ''
          }`}
          onClick={() => toggleGroupCollapse(group.id, hasSources)}
        >
          {/* 折叠箭头 */}
          <button
            type="button"
            className="h-4 w-4 p-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              toggleGroupCollapse(group.id, hasSources)
            }}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {/* 文件夹级批量勾选框 */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center"
          >
            <Checkbox
              checked={isSomeChecked ? 'indeterminate' : isAllChecked}
              onCheckedChange={() => handleFolderCheckboxToggle(allFolderSources)}
              disabled={allFolderSources.length === 0}
              className="h-3.5 w-3.5"
            />
          </div>

          {/* 文件夹图标与名称 */}
          {isCollapsed ? (
            <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" />
          )}

          <span className="text-xs font-semibold text-foreground truncate flex-1">
            {group.name}
          </span>

          {/* 双数字徽标：本笔记本数 / 知识库全局总数（解答"默认视图徽标是全局数"的困惑） */}
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground"
            title={
              totalCount > allFolderSources.length
                ? t('geminiSources.folderBadgeMixed', {
                    local: allFolderSources.length,
                    total: totalCount,
                    missing: totalCount - allFolderSources.length,
                  })
                : t('geminiSources.folderBadgeLocal', { count: allFolderSources.length })
            }
          >
            {allFolderSources.length}
            {totalCount > allFolderSources.length && (
              <span className="text-muted-foreground/60"> / {totalCount}</span>
            )}
          </Badge>
        </div>

        {/* 展开后的子来源列表 */}
        {!isCollapsed && (
          <div className="pl-6 space-y-1 border-l border-border/40 ml-3">
            {directSources.length === 0 && node.children.length === 0 ? (
              <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/20 border border-dashed border-border/60 text-[11px] text-muted-foreground my-1">
                <div className="flex items-center justify-between">
                  <span>{t('geminiSources.folderEmptyInNotebook')}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground">
                    {t('geminiSources.folderTotalCount', { count: totalCount })}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 pt-0.5">
                  <button
                    type="button"
                    className="not-italic text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                    onClick={() => {
                      setTargetFolderId(group.id)
                      setAddExistingOpen(true)
                    }}
                  >
                    <Link2 className="h-3 w-3" />
                    {t('geminiSources.addExisting')}
                  </button>
                  <button
                    type="button"
                    className="not-italic text-[11px] text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1 font-medium"
                    onClick={() => {
                      setTargetFolderId(group.id)
                      setAddSourceOpen(true)
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    {t('geminiSources.addNewResource')}
                  </button>
                </div>
              </div>
            ) : (
              directSources.map((source) => renderSourceItem(source))
            )}

            {/* 递归渲染子文件夹 */}
            {node.children.map((child) => renderFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // 渲染单条来源项（带右键菜单，完整移植默认视图能力）
  const renderSourceItem = (source: SourceListResponse) => {
    const mode = contextSelections[source.id] ?? 'full'
    const isChecked = mode !== 'off'
    const isLink = !!source.asset?.url
    // 嵌入三态（纯展示，绝不触发 embedding）：failed 红 / 未嵌入琥珀 / 其余不渲染
    const embedFailed = source.embedding_status === 'failed'
    const embedUnembedded = source.embedded === false && !embedFailed
    // 有文件夹归属才提供「移出文件夹」，避免对未归档来源假成功
    const isGrouped =
      sourceToGroupMap.has(source.id) ||
      sourceToGroupMap.has(source.id.replace(/^source:/, ''))

    return (
      <ContextMenu key={source.id}>
        <ContextMenuTrigger asChild>
          {/* 整行可点击打开详情（third arg 供 AI 解析保存链路的 nb 供数）；勾选与 hover 按钮自行 stopPropagation */}
          <div
            className={`group flex cursor-pointer items-center gap-2 p-1.5 px-2 rounded-md border transition-all ${
              isChecked
                ? 'bg-card border-border/80 hover:border-primary/40'
                : 'bg-muted/20 border-border/30 opacity-60'
            }`}
            onClick={() => openModal('source', source.id, { notebookId })}
          >
            {/* Checkbox 是唯一的勾选入口：包裹层 stopPropagation 防止点勾选冒泡弹详情 */}
            <div
              className="flex items-center shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={(checked) =>
                  onContextModeChange(source.id, checked ? 'full' : 'off')
                }
                aria-label={source.title ?? t('sources.untitledSource')}
                className="h-3.5 w-3.5 shrink-0"
              />
            </div>

            {isLink ? (
              <LinkIcon className="h-3.5 w-3.5 text-sky-500 shrink-0" />
            ) : (
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}

            <span
              className="text-xs font-medium text-foreground truncate flex-1 min-w-0 cursor-pointer"
              title={source.title ?? undefined}
            >
              {source.title || t('sources.untitledSource')}
            </span>

            {embedFailed ? (
              <span
                role="img"
                aria-label={t('sources.embedStateDot.failed')}
                title={t('sources.embedStateDot.failed')}
                className="h-2 w-2 rounded-full bg-destructive shrink-0"
              />
            ) : embedUnembedded ? (
              <span
                role="img"
                aria-label={t('sources.embedStateDot.unembedded')}
                title={t('sources.embedStateDot.unembedded')}
                className="h-2 w-2 rounded-full bg-amber-500 shrink-0"
              />
            ) : null}

            {/* hover 详情按钮：24px 命中区，悬停/键盘聚焦/组内聚焦时揭示 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto group-focus-within:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                openModal('source', source.id, { notebookId })
              }}
              aria-label={t('sources.details')}
              title={t('sources.details')}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </div>
        </ContextMenuTrigger>
        <SourceContextMenuContent
          onOpen={() => openModal('source', source.id, { notebookId })}
          onRename={() => setRowAction({ kind: 'rename', source })}
          onMove={() => setRowAction({ kind: 'move', source })}
          onCopy={() => setRowAction({ kind: 'copy', source })}
          onNewFolder={() => setNewFolderOpen(true)}
          onUngroup={
            isGrouped ? () => handleUngroupSource(source) : undefined
          }
          onRemoveFromNotebook={() => {
            setSourceToRemove(source.id)
            setRemoveDialogOpen(true)
          }}
          onDelete={() => {
            setSourceToDelete(source.id)
            setDeleteDialogOpen(true)
          }}
        />
      </ContextMenu>
    )
  }

  return (
    <Card className="h-full flex flex-col border-border/80 shadow-xs bg-card">
      <CardHeader className="p-3 pb-2 border-b border-border/60 space-y-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            <CardTitle className="text-sm font-semibold">
              {t('navigation.sources')}
            </CardTitle>
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 font-normal">
              {includedCount}/{sources.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs shadow-none px-2"
              onClick={() => setNewFolderOpen(true)}
              title={t('geminiSources.newFolder')}
              aria-label={t('geminiSources.newFolder')}
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs shadow-none px-2"
              onClick={() => setAddExistingOpen(true)}
              title={t('geminiSources.addExisting')}
              aria-label={t('geminiSources.addExisting')}
            >
              <Link2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs shadow-none px-2"
              onClick={() => setAddSourceOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('sources.addSource')}
            </Button>
          </div>
        </div>

        {/* 视图切换下拉选择器 */}
        {views && views.length > 1 && (
          <div className="mt-2">
            <Select
              value={resolvedViewId ?? 'none'}
              onValueChange={(value) =>
                onGroupingChange?.({ viewId: value === 'none' ? undefined : value, group: 'all' })
              }
            >
              <SelectTrigger className="h-7 w-full text-xs bg-muted/30">
                <SelectValue placeholder={t('sources.grouping.viewSelectLabel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('sources.grouping.familyMine')}</SelectLabel>
                  {views
                    .filter((v) => !(v.is_default || v.view_type.startsWith('ai_')))
                    .map((view) => (
                      <SelectItem key={view.id} value={view.id}>
                        {displayViewName(view, t)}
                      </SelectItem>
                    ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t('sources.grouping.familyAi')}</SelectLabel>
                  {views
                    .filter((v) => v.is_default || v.view_type.startsWith('ai_'))
                    .map((view) => (
                      <SelectItem key={view.id} value={view.id}>
                        {displayViewName(view, t)}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Tab 切换：已有来源（按文件夹层级） vs 智能网络导源 */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as 'sources' | 'research')}
          className="mt-2 w-full"
        >
          <TabsList className="grid grid-cols-2 w-full h-7 p-0.5 bg-muted/60">
            <TabsTrigger value="sources" className="text-xs h-6 gap-1.5">
              <Folder className="h-3 w-3" />
              {t('geminiSources.tabHierarchical', { count: sources.length })}
            </TabsTrigger>
            <TabsTrigger value="research" className="text-xs h-6 gap-1.5">
              <Globe className="h-3 w-3 text-primary" />
              {t('geminiSources.tabWebResearch')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        {activeTab === 'sources' ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 顶栏控制：全选与搜索 */}
            <div className="px-3 py-1.5 border-b border-border/40 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all-sources"
                  checked={allIncluded}
                  onCheckedChange={handleToggleSelectAll}
                  className="h-3.5 w-3.5"
                />
                <label
                  htmlFor="select-all-sources"
                  className="text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  {allIncluded ? t('geminiSources.deselectAll') : t('geminiSources.selectAllForChat')}
                </label>
              </div>
              <div className="relative flex-1 max-w-[150px]">
                <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder={t('geminiSources.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 text-xs pl-7 pr-2"
                />
              </div>
            </div>

            {/* 来源树形流：文件夹 + 未分组 */}
            <ScrollArea className="flex-1 min-h-0 p-3">
              {isLoading || treeLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  <span className="text-xs">{t('geminiSources.loadingTree')}</span>
                </div>
              ) : fullSources.length === 0 && groupTree.length === 0 ? (
                <div className="text-center py-10 px-4">
                  <Folder className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {t('geminiSources.empty')}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {/* 1. 文件夹树渲染 */}
                  {groupTree.map((node) => renderFolderNode(node, 0))}

                  {/* 2. 未分组来源（独立分类节点） */}
                  {ungroupedSources.length > 0 && (() => {
                    const isUngroupedCollapsed = isGroupCollapsed('ungrouped', ungroupedSources.length > 0)
                    return (
                      <div className="space-y-1 pt-1 mt-2 border-t border-border/40">
                        <div
                          className="flex items-center gap-1.5 p-1.5 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => toggleGroupCollapse('ungrouped', ungroupedSources.length > 0)}
                        >
                          <button
                            type="button"
                            className="h-4 w-4 p-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleGroupCollapse('ungrouped', ungroupedSources.length > 0)
                            }}
                          >
                            {isUngroupedCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>

                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center justify-center"
                          >
                            <Checkbox
                              checked={
                                ungroupedSources.every(
                                  (s) => (contextSelections[s.id] ?? 'full') !== 'off'
                                )
                                  ? true
                                  : ungroupedSources.some(
                                      (s) => (contextSelections[s.id] ?? 'full') !== 'off'
                                    )
                                  ? 'indeterminate'
                                  : false
                              }
                              onCheckedChange={() => handleFolderCheckboxToggle(ungroupedSources)}
                              className="h-3.5 w-3.5"
                            />
                          </div>

                          <span className="text-xs font-semibold text-muted-foreground truncate flex-1">
                            {t('geminiSources.ungrouped')}
                          </span>

                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground">
                            {ungroupedSources.length}
                          </Badge>
                        </div>

                        {/* 展开的未分组来源列表 */}
                        {!isUngroupedCollapsed && (
                          <div className="pl-6 space-y-1 border-l border-border/40 ml-3">
                            {ungroupedSources.map((source) => renderSourceItem(source))}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </ScrollArea>

            {/* 知识库全局资源概览 (全库资源透视区) */}
            <div className="p-3 border-t border-border/60 bg-muted/15 shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">
                    {t('sources.overview.title')}
                  </span>
                </div>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal text-muted-foreground">
                  {t('sources.overview.totalBadge', { count: totalLibraryCount })}
                </Badge>
              </div>

              {/* 未嵌入来源补嵌入口（compact 变体；确认后才触发 rebuild，绝不自动） */}
              <EmbedMissingPanel variant="compact" />

              {/* 数据透视指标 */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-1.5 rounded-md bg-background/80 border border-border/50">
                  <div className="text-[10px] text-muted-foreground">
                    {t('sources.overview.linkedLabel')}
                  </div>
                  <div className="text-xs font-semibold text-foreground mt-0.5">
                    {t('sources.overview.count', { count: fullSources.length })}
                  </div>
                </div>
                <div className="p-1.5 rounded-md bg-background/80 border border-border/50">
                  <div className="text-[10px] text-muted-foreground">
                    {t('sources.overview.pendingLabel')}
                  </div>
                  <div className="text-xs font-semibold text-primary mt-0.5 flex items-center justify-center gap-1">
                    <span>{t('sources.overview.count', { count: unlinkedCount })}</span>
                    {unlinkedCount > 0 && (
                      <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                </div>
              </div>

              {/* 快捷操作区 */}
              {unlinkedCount > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full h-7 text-xs gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-medium"
                  onClick={() => setAddExistingOpen(true)}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>{t('sources.overview.importAll', { count: unlinkedCount })}</span>
                </Button>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-muted-foreground/70 py-0.5 px-1">
                  <span>{t('sources.overview.allLinked')}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => setAddExistingOpen(true)}
                  >
                    {t('sources.overview.viewAll')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 智能网络导源 (Web Research) 面板 */
          <div className="flex-1 min-h-0 flex flex-col p-4 space-y-4 overflow-y-auto">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {t('geminiSources.webResearchTitle')}
                </span>
                <div className="flex rounded-md border p-0.5 bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setResearchMode('fast')}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                      researchMode === 'fast'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t('geminiSources.fastMode')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setResearchMode('deep')}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                      researchMode === 'deep'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t('geminiSources.deepMode')}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {researchMode === 'fast'
                  ? t('geminiSources.fastModeDesc')
                  : t('geminiSources.deepModeDesc')}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder={
                    researchMode === 'fast'
                      ? t('geminiSources.fastPlaceholder')
                      : t('geminiSources.deepPlaceholder')
                  }
                  value={researchPrompt}
                  onChange={(e) => setResearchPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExecuteResearch()}
                  disabled={isResearching}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={handleExecuteResearch}
                  disabled={isResearching || !researchPrompt.trim()}
                >
                  {isResearching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {/* 导源结果与选择器 */}
            {researchResults.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">
                    {t('geminiSources.foundSources', { count: researchResults.length })}
                  </span>
                  <Button
                    size="sm"
                    className="h-7 text-xs px-2.5 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleSaveSelectedSources}
                    disabled={isAddingSources}
                  >
                    {isAddingSources ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        {t('geminiSources.importing')}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {t('geminiSources.bulkAdd')}
                      </>
                    )}
                  </Button>
                </div>

                <div className="space-y-2">
                  {researchResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg border border-border bg-card/80 space-y-1.5"
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id={`res-${item.id}`}
                          checked={item.selected}
                          onCheckedChange={(checked) => {
                            setResearchResults((prev) =>
                              prev.map((r) =>
                                r.id === item.id ? { ...r, selected: !!checked } : r
                              )
                            )
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                          >
                            <span className="truncate">{item.title}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            {item.snippet}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AddSourceDialog
        open={addSourceOpen}
        onOpenChange={(open) => {
          setAddSourceOpen(open)
          if (!open) setTargetFolderId(undefined)
        }}
        defaultNotebookId={notebookId}
        defaultViewId={resolvedViewId}
        defaultGroupId={targetFolderId}
      />

      <AddExistingSourceDialog
        open={addExistingOpen}
        onOpenChange={setAddExistingOpen}
        notebookId={notebookId}
        onSuccess={() => {
          refetchTree()
          onRefresh()
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
          queryClient.invalidateQueries({ queryKey: ['sources', 'global-overview'] })
          queryClient.invalidateQueries({ queryKey: ['sources', 'all'] })
        }}
      />

      {/* 新建文件夹对话框 */}
      <GroupNameDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        mode="create"
        onConfirm={async (name: string) => {
          try {
            if (!resolvedViewId) {
              toast.error(t('geminiSources.noViewError'))
              return
            }
            await createGroup.mutateAsync({
              name,
              viewId: resolvedViewId,
            })
            refetchTree()
            toast.success(t('geminiSources.folderCreated'))
            setNewFolderOpen(false)
          } catch {
            toast.error(t('geminiSources.folderCreateFailed'))
          }
        }}
      />

      {/* 重命名来源对话框 */}
      <RenameSourceDialog
        open={rowAction?.kind === 'rename'}
        source={rowAction?.kind === 'rename' ? rowAction.source : null}
        onConfirm={handleRenameConfirm}
        onOpenChange={(open) => !open && setRowAction(null)}
      />

      {/* 移动/复制到文件夹对话框（copy 与 classic sources 页同一 GroupPicker 能力） */}
      <GroupPickerDialog
        open={rowAction?.kind === 'move' || rowAction?.kind === 'copy'}
        onOpenChange={(open) => !open && setRowAction(null)}
        hideRootOption
        title={
          rowAction?.kind === 'copy'
            ? t('sources.grouping.copyToGroupTitle')
            : t('sources.grouping.moveToGroupTitle')
        }
        description={
          (rowAction?.kind === 'move' || rowAction?.kind === 'copy') && resolvedView
            ? `${
                rowAction.source.title || t('sources.untitledSource')
              } · ${t('sources.grouping.moveTargetViewHint', {
                view: displayViewName(resolvedView, t),
              })}`
            : undefined
        }
        groups={viewGroups ?? []}
        confirmText={
          rowAction?.kind === 'copy'
            ? t('sources.grouping.copyHere')
            : t('sources.grouping.moveHere')
        }
        onConfirm={(targetGroupId: string | null) => {
          if (rowAction?.kind === 'copy') {
            handleCopyConfirm(targetGroupId)
          } else {
            handleMoveConfirm(targetGroupId)
          }
        }}
      />

      {/* 从笔记本移除确认 */}
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

      {/* 彻底删除确认 */}
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
    </Card>
  )
}

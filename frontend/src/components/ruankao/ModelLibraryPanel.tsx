'use client'

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BookMarked,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Folder,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useSourceViews } from '@/lib/hooks/use-source-views'
import {
  useCleanupDanglingMarks,
  useEssayMarksLibrary,
  useToggleEssayMark,
} from '@/lib/hooks/use-essay-marks'
import { displayViewName } from '@/lib/utils/view-display'
import type {
  EssayLibraryGroup,
  EssayLibrarySource,
  EssayMarkTargetType,
} from '@/lib/types/api'

// 文件夹树节点：服务端按 name 平铺返回文件夹，按 parent_id 组树（兄弟保序）。
// depth 仍是服务端算好的 1-based 深度（×16px 缩进），树形只负责可见性。
interface GroupNode extends EssayLibraryGroup {
  children: GroupNode[]
}

function buildGroupTree(groups: EssayLibraryGroup[]): GroupNode[] {
  const byId = new Map<string, GroupNode>()
  for (const group of groups) byId.set(group.id, { ...group, children: [] })
  const roots: GroupNode[] = []
  for (const group of groups) {
    const node = byId.get(group.id)
    if (!node) continue
    const parent = group.parent_id
    if (parent != null && byId.has(parent)) byId.get(parent)!.children.push(node)
    else roots.push(node)
  }
  return roots
}

// 标记开关按钮：两态文案 + aria-label；乐观翻转与失败回滚全在 hook 内
function MarkToggleButton({
  marked,
  targetId,
  targetType,
  markLabel,
  unmarkLabel,
  testid,
  onToggle,
}: {
  marked: boolean
  targetId: string
  targetType: EssayMarkTargetType
  markLabel: string
  unmarkLabel: string
  testid: string
  onToggle: (data: { target_type: EssayMarkTargetType; target_id: string }) => void
}) {
  return (
    <Button
      size="sm"
      variant={marked ? 'default' : 'outline'}
      data-testid={testid}
      aria-label={marked ? unmarkLabel : markLabel}
      onClick={() => onToggle({ target_type: targetType, target_id: targetId })}
    >
      {marked ? unmarkLabel : markLabel}
    </Button>
  )
}

// 来源行：平铺区与文件夹树共用一份渲染——徽标、阅读深链、标记开关完全一致。
// testIdPrefix 区分两处挂载点（平铺区沿用历史 testid 形状，树区带 -tree- 段），
// indent 是树区的深度缩进（平铺区传 0）。
function SourceRow({
  source,
  testIdPrefix,
  indent,
  onToggle,
}: {
  source: EssayLibrarySource
  testIdPrefix: string
  indent: number
  onToggle: (data: { target_type: EssayMarkTargetType; target_id: string }) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid={`${testIdPrefix}-item-${source.id}`}
      className="flex items-center gap-2 py-2 pl-3 pr-3"
    >
      {/* 内容簇去 flex-1（宽屏治理 L 线 §2.2 题库行同款机械套用）：单流后
          阅读/标记按钮紧跟内容，标题截断封顶使操作距离与视口宽度无关 */}
      <div
        className="flex min-w-0 items-center gap-2"
        style={{ paddingLeft: indent }}
      >
        <span className="min-w-0 max-w-md truncate text-sm font-medium lg:max-w-lg">
          {source.title || source.id.split(':').pop() || source.id}
        </span>
        {source.extension && (
          <Badge variant="outline" className="shrink-0">
            {source.extension}
          </Badge>
        )}
        {source.via_group_ids.length > 0 && (
          <Badge variant="secondary" className="shrink-0">
            {t('ruankao.essayMark.viaGroupBadge')}
          </Badge>
        )}
        {source.updated && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(source.updated).toLocaleDateString()}
          </span>
        )}
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          aria-label={t('ruankao.essay.home.readCard')}
          title={t('ruankao.essay.home.readCard')}
          data-testid={`${testIdPrefix}-read-${source.id}`}
          onClick={() => {
            // 跨 tab 跳转用整页导航 + 深链：page.tsx 的 activeTab 是本地
            // useState，?tab= 深链初始值是既有机制，页壳零改动（代价一次刷新）
            window.location.assign(
              `/ruankao?tab=essay&read=${encodeURIComponent(source.id)}`
            )
          }}
        >
          <BookOpen className="h-4 w-4" />
        </Button>
        <MarkToggleButton
          marked={source.marked_direct}
          targetId={source.id}
          targetType="source"
          markLabel={t('ruankao.essayMark.markSourceAction')}
          unmarkLabel={t('ruankao.essayMark.unmarkSourceAction')}
          testid={`${testIdPrefix}-toggle-${source.id}`}
          onToggle={onToggle}
        />
      </div>
    </div>
  )
}

// 范文库标记面板：统计 / 视图选择 / 文件夹树（可展开，行下挂载文件并标记）/
// 全库来源平铺标记 / 悬空清理。生效集合与派生计数全部由服务端计算，面板只
// 呈现与发起 toggle。
export function ModelLibraryPanel() {
  const { t } = useTranslation()
  const router = useRouter()
  const toggleMark = useToggleEssayMark()
  const cleanupDangling = useCleanupDanglingMarks()

  // 视图解析（GeminiSourcesColumn 同款）：第一个 custom ?? is_default ?? 第一个
  const { data: views } = useSourceViews()
  const resolvedViewId = useMemo(() => {
    const list = views ?? []
    return (
      list.find((v) => v.view_type === 'custom') ??
      list.find((v) => v.is_default) ??
      list[0]
    )?.id
  }, [views])

  // 初值 ''：首渲染即按后端默认视图（DEFAULT_AI_CONTENT_VIEW_ID）取数，避免闪空；
  // 解析出 resolvedViewId 后切换一次，用户手动选过后（viewId !== ''）不再覆盖
  const [viewId, setViewId] = useState('')
  useEffect(() => {
    if (resolvedViewId && viewId === '') setViewId(resolvedViewId)
  }, [resolvedViewId, viewId])

  const libraryQuery = useEssayMarksLibrary(viewId)
  const [query, setQuery] = useState('')

  const library = libraryQuery.data
  const groupTree = useMemo(
    () => buildGroupTree(library?.groups ?? []),
    [library?.groups]
  )
  // 文件夹 → 直接挂载的文件（按 source_group_ids 反查）。遍历保持服务端
  // updated DESC 序，所以每个文件夹里的文件序与平铺区一致。
  const filesByGroup = useMemo(() => {
    const map = new Map<string, EssayLibrarySource[]>()
    for (const source of library?.sources ?? []) {
      for (const gid of source.source_group_ids ?? []) {
        const list = map.get(gid) ?? []
        list.push(source)
        map.set(gid, list)
      }
    }
    return map
  }, [library?.sources])
  const filteredSources = useMemo(() => {
    const all = library?.sources ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter((s) => (s.title ?? '').toLowerCase().includes(needle))
  }, [library?.sources, query])

  // 树展开/收起：记录被收起的文件夹 id，空集合 = 全部展开（保持旧观感），
  // 状态仅本地（切视图/刷新后回到全展开）。
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const toggleExpanded = (groupId: string) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  if (libraryQuery.isPending) {
    return (
      <div
        className="flex items-center justify-center py-16"
        data-testid="ruankao-essay-library-root"
      >
        <LoadingSpinner />
      </div>
    )
  }

  if (libraryQuery.isError) {
    return (
      <div className="space-y-4" data-testid="ruankao-essay-library-root">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('ruankao.essayMark.loadFailed')}</AlertTitle>
          <AlertDescription>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => libraryQuery.refetch()}
            >
              {t('ruankao.essayMark.retryAction')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!library) return null

  // 空库（来源与文件夹皆空）：引导先去来源页导入范文
  if (library.sources.length === 0 && library.groups.length === 0) {
    return (
      <div data-testid="ruankao-essay-library-root">
        <EmptyState
          icon={BookMarked}
          title={t('ruankao.essayMark.sourcesEmpty')}
          description={t('sources.allSourcesDescShort')}
          action={
            <Button variant="outline" className="mt-4" onClick={() => router.push('/sources')}>
              {t('sources.allSources')}
            </Button>
          }
        />
      </div>
    )
  }

  // 文件夹树递归渲染：行（chevron + 名称 + 生效徽标 + 标记开关），展开时
  // 先挂直接子文件（与平铺区同款交互），再递归子文件夹；既无文件也无子
  // 文件夹的空文件夹展开后给一行空态提示。
  const renderGroupNode = (node: GroupNode): ReactNode => {
    const expanded = !collapsedIds.has(node.id)
    const files = filesByGroup.get(node.id) ?? []
    return (
      <Fragment key={node.id}>
        <div
          data-testid={`ruankao-essay-library-group-item-${node.id}`}
          className="flex items-center gap-2 py-2 pl-3 pr-3"
        >
          {/* 内容簇去 flex-1（题库行同款）：标记开关紧跟内容，文件夹名截断封顶 */}
          <div
            className="flex min-w-0 items-center gap-2"
            style={{ paddingLeft: node.depth * 16 }}
          >
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 shrink-0"
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? t('ruankao.essayMark.collapseFolderAction')
                  : t('ruankao.essayMark.expandFolderAction')
              }
              data-testid={`ruankao-essay-library-group-expand-${node.id}`}
              onClick={() => toggleExpanded(node.id)}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 max-w-md truncate text-sm font-medium lg:max-w-lg">
              {node.name}
            </span>
            <Badge variant="secondary" className="shrink-0">
              {t('ruankao.essayMark.groupEffectiveCount', {
                count: node.effective_count,
              })}
            </Badge>
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-2">
            <MarkToggleButton
              marked={node.marked}
              targetId={node.id}
              targetType="source_group"
              markLabel={t('ruankao.essayMark.markGroupAction')}
              unmarkLabel={t('ruankao.essayMark.unmarkGroupAction')}
              testid={`ruankao-essay-library-group-toggle-${node.id}`}
              onToggle={toggleMark.mutate}
            />
          </div>
        </div>
        {expanded && (
          <>
            {files.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                testIdPrefix="ruankao-essay-library-tree-source"
                indent={node.depth * 16 + 20}
                onToggle={toggleMark.mutate}
              />
            ))}
            {files.length === 0 && node.children.length === 0 && (
              <p
                className="py-2 text-sm text-muted-foreground"
                style={{ paddingLeft: node.depth * 16 + 20 }}
                data-testid={`ruankao-essay-library-group-empty-${node.id}`}
              >
                {t('ruankao.essayMark.folderEmptyHint')}
              </p>
            )}
            {node.children.map((child) => renderGroupNode(child))}
          </>
        )}
      </Fragment>
    )
  }

  return (
    <div className="space-y-6" data-testid="ruankao-essay-library-root">
      {/* ① 统计条：三项只读计数 */}
      <div
        className="flex flex-wrap items-center gap-x-8 gap-y-2"
        data-testid="ruankao-essay-library-stats"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {library.stats.marked_sources}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('ruankao.essayMark.statsSources')}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {library.stats.marked_groups}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('ruankao.essayMark.statsGroups')}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {library.stats.effective_total}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('ruankao.essayMark.statsEffective')}
          </span>
        </div>
      </div>

      {/* ② 视图选择：只有多视图才有切换意义（单视图即默认视图） */}
      {(views?.length ?? 0) > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t('ruankao.essayMark.viewLabel')}
          </span>
          <Select value={viewId} onValueChange={setViewId}>
            <SelectTrigger
              className="w-64"
              data-testid="ruankao-essay-library-view-select"
            >
              <SelectValue placeholder={t('ruankao.essayMark.viewLabel')} />
            </SelectTrigger>
            <SelectContent>
              {(views ?? []).map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {displayViewName(view, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ③ 文件夹树：可展开/收起，行下直接挂载该文件夹的文件（含子树递归），
          标记文件夹仍即覆盖其全部来源 */}
      {groupTree.length > 0 && (
        <section
          className="space-y-2"
          data-testid="ruankao-essay-library-groups"
        >
          <h3 className="text-sm font-medium text-muted-foreground">
            {t('ruankao.essayMark.groupsTitle')}
          </h3>
          <div className="divide-y divide-border rounded-md border">
            {groupTree.map((root) => renderGroupNode(root))}
          </div>
        </section>
      )}

      {/* ④ 来源列表：全库平铺（服务端 updated DESC），标题本地过滤——
          搜索场景的主入口，与上方文件夹树互不影响 */}
      <section className="space-y-2" data-testid="ruankao-essay-library-sources">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t('ruankao.essayMark.sourcesTitle')}
        </h3>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('ruankao.essayMark.sourcesSearchPlaceholder')}
          className="max-w-sm"
        />
        {filteredSources.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t('ruankao.essayMark.sourcesEmpty')}
          </p>
        ) : (
          <div className="divide-y divide-border rounded-md border">
            {filteredSources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                testIdPrefix="ruankao-essay-library-source"
                indent={0}
                onToggle={toggleMark.mutate}
              />
            ))}
          </div>
        )}
      </section>

      {/* ⑤ 悬空清理条：目标已删除的标记，事件级联之外的手动双保险 */}
      {library.dangling_marks.length > 0 && (
        <Alert data-testid="ruankao-essay-library-dangling">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {t('ruankao.essayMark.danglingTitle', {
              count: library.dangling_marks.length,
            })}
          </AlertTitle>
          <AlertDescription>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={cleanupDangling.isPending}
              data-testid="ruankao-essay-library-dangling-action"
              onClick={() => cleanupDangling.mutate()}
            >
              {t('ruankao.essayMark.danglingAction')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

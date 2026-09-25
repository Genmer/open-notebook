'use client'

import { useMemo } from 'react'
import { Folder, FolderPlus, FileStack, Loader2 } from 'lucide-react'
import { GroupBadge } from '@/components/sources/GroupBadge'
import { GroupDialogs } from '@/components/sources/GroupDialogs'
import { useGroupDialogs } from '@/components/sources/use-group-dialogs'
import { GroupContextMenuContent } from '@/components/sources/SourceContextMenu'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SourceGroupResponse } from '@/lib/types/api'
import { buildGroupTree, findTreeNode, MAX_GROUP_DEPTH } from '@/lib/utils/group-tree'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

interface FolderGridProps {
  viewName: string
  groups: SourceGroupResponse[]
  /** 'all' | 'ungrouped' | 文件夹 id；决定网格展示哪一层的子夹。 */
  selected: string
  onSelect: (target: string) => void
  /** root：视图第一层（大图标 + 未分组入口）；subfolder：文件夹内的子夹行（紧凑） */
  variant?: 'root' | 'subfolder'
  isAiView?: boolean
  isLoading?: boolean
  /** 新建成功后高亮的文件夹 id（约 2s，由调用方负责清除）。 */
  highlightId?: string | null
  /** 新建入口交给调用方页面级弹窗（带落点提示与同级列表）。 */
  onNewFolder: () => void
  onCreateGroup: (name: string, parentId: string | null) => void
  onRenameGroup: (id: string, name: string) => void
  onMoveGroup: (id: string, parentId: string | null) => void
  onDeleteGroup: (id: string, deleteSources: boolean) => void
}

// 文件管理器范式的文件夹网格：进入视图第一级只看文件夹（macOS/Windows 直觉），
// 点进去才看文件；与 /sources 的 GroupTree 共享 group-tree 工具、右键菜单与弹窗状态机。
export function FolderGrid({
  viewName,
  groups,
  selected,
  onSelect,
  variant = 'root',
  isAiView = false,
  isLoading = false,
  highlightId,
  onNewFolder,
  onCreateGroup,
  onRenameGroup,
  onMoveGroup,
  onDeleteGroup,
}: FolderGridProps) {
  const { t } = useTranslation()
  const dialogs = useGroupDialogs()
  const isRoot = variant === 'root'

  const tree = useMemo(() => buildGroupTree(groups), [groups])
  const currentNode = useMemo(
    () => (selected === 'all' || selected === 'ungrouped' ? undefined : findTreeNode(tree, selected)),
    [tree, selected]
  )
  // 浏览具体文件夹 = 只看它的子夹；根层（all/ungrouped/失效 id）= 根夹
  const levelNodes = currentNode ? currentNode.children : tree
  const canAddChildHere = !currentNode || currentNode.depth < MAX_GROUP_DEPTH

  const tileClass = (highlighted: boolean) =>
    cn(
      'group/tile flex flex-col items-center justify-start gap-1.5 rounded-lg border border-border bg-background text-foreground transition-colors',
      isRoot ? 'p-3.5' : 'p-2.5',
      'hover:border-primary/40 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      highlighted && 'ring-2 ring-primary'
    )

  return (
    <div
      data-testid="folder-grid"
      role="group"
      aria-label={t('sources.grouping.groupSelectLabel')}
      className={isRoot ? 'flex flex-col gap-3' : 'flex flex-col gap-2'}
    >
      {isAiView && (
        <p className="text-xs text-muted-foreground" data-testid="folder-grid-ai-hint">
          {t('sources.grouping.aiOverwriteHint')}
        </p>
      )}
      {isRoot && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {t('sources.grouping.folderRailTitle')}
        </span>
      )}
      {isLoading ? (
        <div className="flex items-center justify-center py-8" data-testid="folder-grid-loading">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div
            className={cn(
              'grid gap-2',
              isRoot
                ? 'grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))]'
                : 'grid-cols-[repeat(auto-fill,minmax(5rem,1fr))]'
            )}
          >
            {levelNodes.map((node) => (
              <ContextMenu key={node.group.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    className={tileClass(highlightId === node.group.id)}
                    data-testid={`folder-tile-${node.group.id}`}
                    data-highlight={highlightId === node.group.id ? 'true' : undefined}
                    onClick={() => onSelect(node.group.id)}
                    title={node.group.name}
                  >
                    <Folder
                      className={cn(
                        'shrink-0 text-primary/70 transition-colors group-hover/tile:text-primary',
                        isRoot ? 'h-10 w-10' : 'h-7 w-7'
                      )}
                      strokeWidth={1.5}
                    />
                    <span
                      className={cn(
                        'w-full truncate text-center',
                        isRoot ? 'text-xs font-medium' : 'text-[11px]'
                      )}
                    >
                      {node.group.name}
                    </span>
                    <GroupBadge count={node.group.source_count} />
                  </button>
                </ContextMenuTrigger>
                <GroupContextMenuContent
                  canHaveChildren={node.depth < MAX_GROUP_DEPTH}
                  onNewSubgroup={() => dialogs.openCreate(node.group.id)}
                  onRename={() => dialogs.openRename(node.group)}
                  onMove={() => dialogs.openMove(node.group)}
                  onDelete={() => dialogs.openDelete(node.group)}
                />
              </ContextMenu>
            ))}
            {isRoot && (selected === 'all' || selected === 'ungrouped') && (
              <button
                type="button"
                className={cn(
                  tileClass(false),
                  'border-dashed text-muted-foreground hover:text-foreground'
                )}
                data-testid="folder-tile-ungrouped"
                onClick={() => onSelect('ungrouped')}
                title={t('sources.grouping.ungrouped')}
              >
                <FileStack className={cn('shrink-0', isRoot ? 'h-10 w-10' : 'h-7 w-7')} strokeWidth={1.5} />
                <span className={cn('w-full text-center leading-tight', isRoot ? 'text-xs font-medium' : 'text-[11px]')}>
                  {t('sources.grouping.ungrouped')}
                </span>
              </button>
            )}
            <button
              type="button"
              className={cn(tileClass(false), 'border-dashed text-muted-foreground hover:text-foreground')}
              onClick={onNewFolder}
              disabled={!canAddChildHere}
              data-testid="folder-tile-new"
              title={
                canAddChildHere
                  ? t('sources.grouping.newGroup')
                  : t('apiErrors.groupDepthExceeded')
              }
            >
              <FolderPlus className={cn('shrink-0', isRoot ? 'h-10 w-10' : 'h-7 w-7')} strokeWidth={1.5} />
              <span className={cn('w-full text-center leading-tight', isRoot ? 'text-xs font-medium' : 'text-[11px]')}>
                {t('sources.grouping.newGroup')}
              </span>
            </button>
          </div>
          {!isRoot && levelNodes.length === 0 && (
            <span className="text-xs italic text-muted-foreground/70" data-testid="folder-grid-empty">
              {t('sources.grouping.noSubfolders')}
            </span>
          )}
        </>
      )}

      <GroupDialogs
        dialogs={dialogs}
        groups={groups}
        viewName={viewName}
        onCreateGroup={onCreateGroup}
        onRenameGroup={onRenameGroup}
        onMoveGroup={onMoveGroup}
        onDeleteGroup={onDeleteGroup}
      />
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import {
  ChevronRight,
  FileText,
  FolderPlus,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  FolderInput,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GroupBadge } from '@/components/sources/GroupBadge'
import { GroupContextMenuContent } from '@/components/sources/SourceContextMenu'
import { GroupDialogs } from '@/components/sources/GroupDialogs'
import { useGroupDialogs } from '@/components/sources/use-group-dialogs'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SourceGroupResponse, SourceTypeGroupResponse } from '@/lib/types/api'
import { buildGroupTree, findTreeNode, MAX_GROUP_DEPTH, type GroupNode } from '@/lib/utils/group-tree'
import { canDropGroup, DND_GROUP_TYPE, DND_SOURCES_TYPE } from '@/lib/utils/dnd-helpers'
import { FILE_TYPE_VIEW_ID, type GroupSelection } from '@/lib/stores/source-view-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface GroupTreeProps {
  activeViewId: string
  groups: SourceGroupResponse[]
  typeGroups?: SourceTypeGroupResponse[]
  typeGroupsLoading?: boolean
  selected: GroupSelection
  onSelect: (selection: GroupSelection) => void
  onCreateGroup: (name: string, parentId: string | null) => void
  onRenameGroup: (id: string, name: string) => void
  onMoveGroup: (id: string, parentId: string | null) => void
  onDeleteGroup: (id: string, deleteSources: boolean) => void
  /** Drop table rows onto a folder: file into the target group. */
  onDropSourcesOnGroup?: (groupId: string, sourceIds: string[]) => void
  /** Drop table rows onto the "not in a folder" anchor. */
  onDropSourcesOnUngroup?: (sourceIds: string[]) => void
  /** Drop a folder onto another folder (parentId null = root); callers own the API call. */
  onDropGroup?: (dragId: string, parentId: string | null) => void
  /** AI 视图激活时树顶常驻"重新分类会覆盖手动归档"警示。 */
  isAiView?: boolean
  /** 视图显示名，create 弹窗落点提示用。 */
  viewName?: string
}

export function GroupTree({
  activeViewId,
  groups,
  typeGroups,
  typeGroupsLoading,
  selected,
  onSelect,
  onCreateGroup,
  onRenameGroup,
  onMoveGroup,
  onDeleteGroup,
  onDropSourcesOnGroup,
  onDropSourcesOnUngroup,
  onDropGroup,
  isAiView = false,
  viewName,
}: GroupTreeProps) {
  const { t } = useTranslation()
  const tree = useMemo(() => buildGroupTree(groups), [groups])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dialogs = useGroupDialogs()

  const isFileTypeView = activeViewId === FILE_TYPE_VIEW_ID

  const parseSourceIds = (e: React.DragEvent): string[] | null => {
    const payload = e.dataTransfer.getData(DND_SOURCES_TYPE)
    if (!payload) return null
    try {
      const ids = JSON.parse(payload) as string[]
      return Array.isArray(ids) && ids.length > 0 ? ids : null
    } catch {
      return null
    }
  }

  const dropSources = (e: React.DragEvent, groupId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverId(null)
    const ids = parseSourceIds(e)
    if (ids) onDropSourcesOnGroup?.(groupId, ids)
  }

  const dropOnUngrouped = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverId(null)
    const ids = parseSourceIds(e)
    if (ids) onDropSourcesOnUngroup?.(ids)
  }

  const dropGroup = (e: React.DragEvent, targetId: string | null) => {
    const dragId = e.dataTransfer.getData(DND_GROUP_TYPE)
    if (!dragId) return
    e.preventDefault()
    setDragOverId(null)
    if (targetId !== null && !canDropGroup(groups, dragId, targetId)) {
      // Self/descendant drop — rejected locally, no doomed request
      toast.error(t('sources.grouping.dragInvalidTarget'))
      return
    }
    onDropGroup?.(dragId, targetId)
  }

  const dragOverGroup = (e: React.DragEvent, groupId: string) => {
    if (
      e.dataTransfer.types.includes(DND_SOURCES_TYPE) ||
      e.dataTransfer.types.includes(DND_GROUP_TYPE)
    ) {
      e.preventDefault()
      setDragOverId(groupId)
    }
  }

  const dnd = {
    dragOverId,
    onDragStartGroup: (e: React.DragEvent, groupId: string) => {
      e.dataTransfer.setData(DND_GROUP_TYPE, groupId)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOverGroup: dragOverGroup,
    onDragLeaveGroup: (_e: React.DragEvent, groupId: string) => {
      setDragOverId((prev) => (prev === groupId ? null : prev))
    },
    onDropGroup: (e: React.DragEvent, groupId: string) => {
      const ids = parseSourceIds(e)
      if (ids) dropSources(e, groupId)
      else dropGroup(e, groupId)
    },
  }

  const anchorClass = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
      active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
    )

  return (
    <aside
      className="flex h-full w-60 flex-shrink-0 flex-col gap-0.5 overflow-y-auto pr-1"
      data-testid="group-tree"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_GROUP_TYPE)) e.preventDefault()
      }}
      onDrop={(e) => {
        // Blank-area drop moves the folder to the root; node handlers stop propagation
        dropGroup(e, null)
      }}
    >
      {isFileTypeView ? (
        <>
          <button type="button" className={anchorClass(selected === 'all')} onClick={() => onSelect('all')}>
            {t('sources.grouping.all')}
          </button>
          <FileTypeAnchor icon={Globe} label={t('sources.type.link')} value="link" selected={selected} onSelect={onSelect} />
          <FileTypeAnchor icon={FileText} label={t('sources.type.text')} value="text" selected={selected} onSelect={onSelect} />
          {typeGroupsLoading ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" data-testid="type-groups-loading" />
          ) : (
            (typeGroups ?? []).map((group) => (
              <FileTypeAnchor
                key={group.key}
                icon={FileText}
                label={group.key === 'other' ? t('sources.type.other') : group.key.toUpperCase()}
                value={group.key}
                selected={selected}
                onSelect={onSelect}
              />
            ))
          )}
        </>
      ) : (
        <>
          {isAiView && (
            <p
              className="mb-1 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground"
              data-testid="group-tree-ai-hint"
            >
              {t('sources.grouping.aiOverwriteHint')}
            </p>
          )}
          <button type="button" className={anchorClass(selected === 'all')} onClick={() => onSelect('all')}>
            {t('sources.grouping.all')}
          </button>
          <button
            type="button"
            className={cn(
              anchorClass(selected === 'ungrouped'),
              dragOverId === 'ungrouped' && 'ring-1 ring-primary'
            )}
            onClick={() => onSelect('ungrouped')}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DND_SOURCES_TYPE)) {
                e.preventDefault()
                setDragOverId('ungrouped')
              }
            }}
            onDragLeave={() => setDragOverId((prev) => (prev === 'ungrouped' ? null : prev))}
            onDrop={dropOnUngrouped}
          >
            {t('sources.grouping.ungrouped')}
          </button>

          <div className="my-1 border-t" />

          {tree.map((node) => (
            <TreeNodes
              key={node.group.id}
              node={node}
              depth={0}
              collapsed={collapsed}
              toggleCollapsed={(id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))}
              selected={selected}
              onSelect={onSelect}
              dnd={dnd}
              onNewSubgroup={(parent) => dialogs.openCreate(parent)}
              onRename={(group) => dialogs.openRename(group)}
              onMove={(group) => dialogs.openMove(group)}
              onDelete={(group) => dialogs.openDelete(group)}
            />
          ))}

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 justify-start text-muted-foreground"
            // 与笔记本页同语义：建在当前浏览的文件夹里（树高亮处），根层则建根夹
            onClick={() =>
              dialogs.openCreate(
                selected !== 'all' && selected !== 'ungrouped' ? selected : null
              )
            }
            disabled={
              selected !== 'all' &&
              selected !== 'ungrouped' &&
              (findTreeNode(tree, selected)?.depth ?? 0) >= MAX_GROUP_DEPTH
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('sources.grouping.newGroup')}
          </Button>
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
    </aside>
  )
}

function FileTypeAnchor({
  icon: Icon,
  label,
  value,
  selected,
  onSelect,
}: {
  icon: typeof Globe
  label: string
  value: GroupSelection
  selected: GroupSelection
  onSelect: (value: GroupSelection) => void
}) {
  return (
    <button
      type="button"
      className={cn(
        anchorClassShared(selected === value),
        'justify-start'
      )}
      onClick={() => onSelect(value)}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function anchorClassShared(active: boolean) {
  return cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
    active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
  )
}

interface TreeDnd {
  dragOverId: string | null
  onDragStartGroup: (e: React.DragEvent, groupId: string) => void
  onDragOverGroup: (e: React.DragEvent, groupId: string) => void
  onDragLeaveGroup: (e: React.DragEvent, groupId: string) => void
  onDropGroup: (e: React.DragEvent, groupId: string) => void
}

function TreeNodes({
  node,
  depth,
  collapsed,
  toggleCollapsed,
  selected,
  onSelect,
  dnd,
  onNewSubgroup,
  onRename,
  onMove,
  onDelete,
}: {
  node: GroupNode
  depth: number
  collapsed: Record<string, boolean>
  toggleCollapsed: (id: string) => void
  selected: GroupSelection
  onSelect: (id: GroupSelection) => void
  dnd: TreeDnd
  onNewSubgroup: (parentId: string) => void
  onRename: (group: SourceGroupResponse) => void
  onMove: (group: SourceGroupResponse) => void
  onDelete: (group: SourceGroupResponse) => void
}) {
  const { t } = useTranslation()
  const group = node.group
  const isCollapsed = !!collapsed[group.id]
  const hasChildren = node.children.length > 0
  const canHaveChildren = node.depth < MAX_GROUP_DEPTH

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <div
        draggable
        onDragStart={(e) => dnd.onDragStartGroup(e, group.id)}
        onDragOver={(e) => dnd.onDragOverGroup(e, group.id)}
        onDragLeave={(e) => dnd.onDragLeaveGroup(e, group.id)}
        onDrop={(e) => dnd.onDropGroup(e, group.id)}
        className={cn(
          'group flex w-full items-center gap-1 rounded-md pr-1 transition-colors',
          selected === group.id ? 'bg-accent' : 'hover:bg-accent/60',
          dnd.dragOverId === group.id && 'ring-1 ring-primary'
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <button
          type="button"
          className={cn(
            'flex flex-1 items-center gap-1 py-1.5 text-left text-sm',
            selected === group.id ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onSelect(group.id)}
        >
          {hasChildren ? (
            <span
              role="button"
              tabIndex={-1}
              aria-expanded={!isCollapsed}
              className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center"
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapsed(group.id)
              }}
              onDragStart={(e) => e.stopPropagation()}
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform', !isCollapsed && 'rotate-90')}
              />
            </span>
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex-1 truncate">{group.name}</span>
          <GroupBadge count={group.source_count} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
              aria-label={t('sources.grouping.groupOptions', { name: group.name })}
              onDragStart={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {canHaveChildren && (
              <DropdownMenuItem onClick={() => onNewSubgroup(group.id)}>
                <FolderPlus className="mr-2 h-4 w-4" />
                {t('sources.grouping.newSubgroup')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onRename(group)}>
              <Pencil className="mr-2 h-4 w-4" />
              {t('common.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(group)}>
              <FolderInput className="mr-2 h-4 w-4" />
              {t('sources.grouping.moveTo')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(group)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </ContextMenuTrigger>
        <GroupContextMenuContent
          canHaveChildren={canHaveChildren}
          onNewSubgroup={() => onNewSubgroup(group.id)}
          onRename={() => onRename(group)}
          onMove={() => onMove(group)}
          onDelete={() => onDelete(group)}
        />
      </ContextMenu>
      {hasChildren && !isCollapsed &&
        node.children.map((child) => (
          <TreeNodes
            key={child.group.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            toggleCollapsed={toggleCollapsed}
            selected={selected}
            onSelect={onSelect}
            dnd={dnd}
            onNewSubgroup={onNewSubgroup}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
          />
        ))}
    </>
  )
}

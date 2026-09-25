'use client'

import { useEffect, useMemo, useState } from 'react'
import { Folder, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SourceGroupResponse } from '@/lib/types/api'
import { buildGroupTree, type GroupNode } from '@/lib/utils/group-tree'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

interface GroupPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  groups: SourceGroupResponse[]
  /** Group ids that cannot be picked (e.g. the group being moved). */
  disabledIds?: string[]
  /** Hide the root option for flows where a concrete folder is required (moving sources). */
  hideRootOption?: boolean
  confirmText?: string
  /** 传入后弹窗出现内联新建行：resolve 新组 id 或 null（失败），弹窗保持打开。 */
  onCreateGroup?: (name: string) => Promise<string | null>
  onConfirm: (targetGroupId: string | null) => void
}

// Shared target picker for move / copy / pick-parent: radio tree with a root option.
export function GroupPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  groups,
  disabledIds = [],
  hideRootOption = false,
  confirmText,
  onCreateGroup,
  onConfirm,
}: GroupPickerDialogProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)
  const tree = useMemo(() => buildGroupTree(groups), [groups])

  useEffect(() => {
    if (open) {
      setSelected(null)
      setNewGroupName('')
    }
  }, [open])

  // 失败时 resolve null：保留输入供重试，错误 toast 由调用方的 mutation hook 出。
  const submitNewGroup = async () => {
    const name = newGroupName.trim()
    if (!name || !onCreateGroup || creating) return
    setCreating(true)
    try {
      const id = await onCreateGroup(name)
      if (id) {
        setSelected(id)
        setNewGroupName('')
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto rounded-md border p-2">
          {!hideRootOption && (
            <PickerOption
              label={t('sources.grouping.rootOption')}
              depth={0}
              checked={selected === null}
              onSelect={() => setSelected(null)}
            />
          )}
          {tree.map((node) => (
            <PickerNode
              key={node.group.id}
              node={node}
              selected={selected}
              disabledIds={disabledIds}
              onSelect={setSelected}
            />
          ))}
          {groups.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">
              {onCreateGroup
                ? t('sources.grouping.noGroupsCreateHint')
                : t('sources.grouping.noGroups')}
            </p>
          )}
        </div>
        {onCreateGroup && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={newGroupName}
              maxLength={100}
              placeholder={t('sources.grouping.groupNamePlaceholder')}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitNewGroup()}
              data-testid="group-picker-create-input"
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={!newGroupName.trim() || creating}
              onClick={submitNewGroup}
              data-testid="group-picker-create-button"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('sources.grouping.inlineCreateLabel')
              )}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={hideRootOption && selected === null}
            onClick={() => onConfirm(selected)}
          >
            {confirmText || t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PickerNode({
  node,
  selected,
  disabledIds,
  onSelect,
}: {
  node: GroupNode
  selected: string | null
  disabledIds: string[]
  onSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  return (
    <>
      <PickerOption
        label={node.group.name}
        depth={node.depth}
        count={node.group.source_count}
        checked={selected === node.group.id}
        disabled={disabledIds.includes(node.group.id)}
        hasChildren={hasChildren}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onSelect={() => onSelect(node.group.id)}
      />
      {hasChildren && expanded &&
        node.children.map((child) => (
          <PickerNode
            key={child.group.id}
            node={child}
            selected={selected}
            disabledIds={disabledIds}
            onSelect={onSelect}
          />
        ))}
    </>
  )
}

function PickerOption({
  label,
  depth,
  count,
  checked,
  disabled,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  onSelect,
}: {
  label: string
  depth: number
  count?: number
  checked: boolean
  disabled?: boolean
  hasChildren?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  onSelect: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded px-2 py-1',
        disabled ? 'opacity-50' : 'hover:bg-accent'
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-expanded={expanded}
        >
          {expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
        <input
          type="radio"
          className="h-3.5 w-3.5 accent-primary"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
        />
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{label}</span>
        {typeof count === 'number' && (
          <span className="text-xs text-muted-foreground">{count}</span>
        )}
      </label>
    </div>
  )
}

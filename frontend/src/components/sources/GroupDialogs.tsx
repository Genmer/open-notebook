'use client'

import { useEffect, useMemo, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { GroupPickerDialog } from '@/components/sources/GroupPickerDialog'
import { GroupNameDialog } from '@/components/sources/GroupNameDialog'
import { SourceGroupResponse } from '@/lib/types/api'
import { collectDescendantIds, getAncestorChain, getGroupDepth, subtreeHeight, MAX_GROUP_DEPTH } from '@/lib/utils/group-tree'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { type GroupDialogsController } from './use-group-dialogs'

interface GroupDialogsProps {
  dialogs: GroupDialogsController
  groups: SourceGroupResponse[]
  /** 视图显示名，用于 create 弹窗的落点提示前缀。 */
  viewName?: string
  // 返回 Promise 时由 GroupNameDialog await：拒绝保持弹窗打开可重试
  onCreateGroup: (name: string, parentId: string | null) => void | Promise<void>
  onRenameGroup: (id: string, name: string) => void | Promise<void>
  onMoveGroup: (id: string, parentId: string | null) => void
  onDeleteGroup: (id: string, deleteSources: boolean) => void
}

// useGroupDialogs 的渲染件：一套 create/rename/move/delete（含级联二次确认）弹窗，
// GroupTree 与 FolderGrid 共用，避免两处各维护一份弹窗逻辑。
export function GroupDialogs({
  dialogs,
  groups,
  viewName,
  onCreateGroup,
  onRenameGroup,
  onMoveGroup,
  onDeleteGroup,
}: GroupDialogsProps) {
  const { t } = useTranslation()
  const { nameDialog, moveTarget, deleteTarget, pendingCascade } = dialogs
  const [deleteSourcesChecked, setDeleteSourcesChecked] = useState(false)

  // 换删除目标时回到未勾选，与原 GroupTree 内联行为一致
  useEffect(() => {
    setDeleteSourcesChecked(false)
  }, [deleteTarget])

  const locationPath = useMemo(() => {
    if (!nameDialog || nameDialog.kind !== 'create') return undefined
    const parentId = nameDialog.parentId
    if (!parentId) return viewName || undefined
    const parent = groups.find((g) => g.id === parentId)
    const chain = [...getAncestorChain(groups, parentId).map((g) => g.name), parent?.name]
      .filter(Boolean)
      .join(' / ')
    return [viewName, chain].filter(Boolean).join(' / ') || undefined
  }, [nameDialog, groups, viewName])

  const siblingNames = useMemo(() => {
    if (!nameDialog) return undefined
    if (nameDialog.kind === 'rename') {
      const parentId = nameDialog.group.parent_id ?? null
      return groups
        .filter((g) => g.id !== nameDialog.group.id && (g.parent_id ?? null) === parentId)
        .map((g) => g.name)
    }
    return groups
      .filter((g) => (g.parent_id ?? null) === nameDialog.parentId)
      .map((g) => g.name)
  }, [nameDialog, groups])

  return (
    <>
      <GroupNameDialog
        open={nameDialog !== null}
        mode={nameDialog?.kind === 'rename' ? 'rename' : 'create'}
        initialName={nameDialog?.kind === 'rename' ? nameDialog.group.name : ''}
        locationPath={locationPath}
        siblingNames={siblingNames}
        onConfirm={(name) => {
          if (!nameDialog) return
          // 必须返回调用方结果：拒绝时 GroupNameDialog 保持打开
          if (nameDialog.kind === 'create') return onCreateGroup(name, nameDialog.parentId)
          return onRenameGroup(nameDialog.group.id, name)
        }}
        onOpenChange={(open) => !open && dialogs.closeName()}
      />

      <GroupPickerDialog
        open={moveTarget !== null}
        onOpenChange={(open) => !open && dialogs.openMove(null)}
        title={t('sources.grouping.moveGroupTitle', { name: moveTarget?.name ?? '' })}
        groups={groups}
        disabledIds={
          moveTarget
            ? [
                moveTarget.id,
                ...collectDescendantIds(groups, moveTarget.id),
                // 目标层深度装不下整个子树的位置提前置灰，而不是吃后端 400
                ...groups
                  .filter(
                    (g) =>
                      getGroupDepth(groups, g.id) + subtreeHeight(groups, moveTarget.id) >
                      MAX_GROUP_DEPTH
                  )
                  .map((g) => g.id),
              ]
            : []
        }
        confirmText={t('sources.grouping.moveHere')}
        onConfirm={(parentId) => {
          if (moveTarget) onMoveGroup(moveTarget.id, parentId)
          dialogs.openMove(null)
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && dialogs.closeDelete()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('sources.grouping.deleteGroupTitle', { name: deleteTarget?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('sources.grouping.deleteGroupDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <Checkbox
              checked={deleteSourcesChecked}
              onCheckedChange={(v) => setDeleteSourcesChecked(v === true)}
            />
            <span className="text-destructive">{t('sources.grouping.deleteGroupWithSources')}</span>
          </label>
          {deleteSourcesChecked && (
            <p className="text-xs font-medium text-destructive">
              {t('sources.grouping.deleteGroupWithSourcesWarn')}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                deleteSourcesChecked && 'bg-destructive text-white hover:bg-destructive/90'
              )}
              onClick={() => {
                if (!deleteTarget) return
                if (deleteSourcesChecked) {
                  // Cascade needs a second confirmation before deleting sources.
                  dialogs.openCascade(deleteTarget.id)
                  dialogs.closeDelete()
                } else {
                  onDeleteGroup(deleteTarget.id, false)
                  dialogs.closeDelete()
                }
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={pendingCascade !== null}
        onOpenChange={(open) => !open && dialogs.closeCascade()}
        title={t('sources.grouping.cascadeConfirmTitle')}
        description={t('sources.grouping.cascadeConfirmDesc')}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={() => {
          if (pendingCascade) onDeleteGroup(pendingCascade, true)
          dialogs.closeCascade()
        }}
      />
    </>
  )
}

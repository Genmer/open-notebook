'use client'

import { useState } from 'react'
import { SourceGroupResponse } from '@/lib/types/api'

export type NameDialogState =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'rename'; group: SourceGroupResponse }
  | null

// 文件夹 create/rename/move/delete 弹窗状态机，GroupTree 与笔记本页 FolderGrid 共用。
export function useGroupDialogs() {
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null)
  const [moveTarget, setMoveTarget] = useState<SourceGroupResponse | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SourceGroupResponse | null>(null)
  const [pendingCascade, setPendingCascade] = useState<string | null>(null)

  return {
    nameDialog,
    moveTarget,
    deleteTarget,
    pendingCascade,
    openCreate: (parentId: string | null) => setNameDialog({ kind: 'create', parentId }),
    openRename: (group: SourceGroupResponse) => setNameDialog({ kind: 'rename', group }),
    closeName: () => setNameDialog(null),
    openMove: (group: SourceGroupResponse | null) => setMoveTarget(group),
    openDelete: (group: SourceGroupResponse) => setDeleteTarget(group),
    closeDelete: () => setDeleteTarget(null),
    openCascade: (id: string) => setPendingCascade(id),
    closeCascade: () => setPendingCascade(null),
  }
}

export type GroupDialogsController = ReturnType<typeof useGroupDialogs>

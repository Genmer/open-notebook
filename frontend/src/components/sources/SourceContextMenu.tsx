'use client'

import {
  Copy,
  ExternalLink,
  FileText,
  FolderInput,
  FolderPlus,
  FolderTree,
  HardDrive,
  Pencil,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SourceContextMenuContentProps {
  onOpen?: () => void
  onRename?: () => void
  onMove?: () => void
  onCopy?: () => void
  onCopyFileName?: () => void
  onCopyRelativePath?: () => void
  onCopyAbsolutePath?: () => void
  /** asset 既无 file_path 也无 url 时绝对路径无值可复制，置灰。 */
  disableCopyAbsolutePath?: boolean
  onNewFolder?: () => void
  onUngroup?: () => void
  onRemoveFromNotebook?: () => void
  onDelete?: () => void
  /** file_type 视图没有文件夹概念，文件夹相关项整体裁剪。 */
  isFileTypeView?: boolean
  /** 正在浏览 ungrouped 列表时没有可移出的归属。 */
  hideUngroup?: boolean
}

// 右键菜单的来源项集：每个回调可选，未传即不渲染，形状镜像 SourceRowActionsMenu。
// 重试/刷新内容两个状态相关低频项只留在 ⋮ 菜单，右键保持核心项集。
export function SourceContextMenuContent({
  onOpen,
  onRename,
  onMove,
  onCopy,
  onCopyFileName,
  onCopyRelativePath,
  onCopyAbsolutePath,
  disableCopyAbsolutePath = false,
  onNewFolder,
  onUngroup,
  onRemoveFromNotebook,
  onDelete,
  isFileTypeView = false,
  hideUngroup = false,
}: SourceContextMenuContentProps) {
  const { t } = useTranslation()
  const folderItemsHidden = isFileTypeView
  const showUngroup = !folderItemsHidden && !hideUngroup && !!onUngroup
  const hasTop =
    !!onOpen ||
    !!onRename ||
    (!!onMove && !folderItemsHidden) ||
    (!!onCopy && !folderItemsHidden) ||
    (!!onNewFolder && !folderItemsHidden)
  const hasCopyPaths = !!onCopyFileName || !!onCopyRelativePath || !!onCopyAbsolutePath
  const hasMiddle = showUngroup || !!onRemoveFromNotebook

  return (
    <ContextMenuContent>
      {onOpen && (
        <ContextMenuItem onClick={onOpen}>
          <ExternalLink className="h-4 w-4" />
          {t('sources.grouping.openSource')}
        </ContextMenuItem>
      )}
      {onRename && (
        <ContextMenuItem onClick={onRename}>
          <Pencil className="h-4 w-4" />
          {t('sources.grouping.renameSource')}
        </ContextMenuItem>
      )}
      {onMove && !folderItemsHidden && (
        <ContextMenuItem onClick={onMove}>
          <FolderInput className="h-4 w-4" />
          {t('sources.grouping.moveToFolder')}
        </ContextMenuItem>
      )}
      {onCopy && !folderItemsHidden && (
        <ContextMenuItem onClick={onCopy}>
          <Copy className="h-4 w-4" />
          {t('sources.grouping.copyTo')}
        </ContextMenuItem>
      )}
      {onNewFolder && !folderItemsHidden && (
        <ContextMenuItem onClick={onNewFolder}>
          <FolderPlus className="h-4 w-4" />
          {t('sources.grouping.newFolder')}
        </ContextMenuItem>
      )}
      {hasTop && hasCopyPaths && <ContextMenuSeparator />}
      {onCopyFileName && (
        <ContextMenuItem onClick={onCopyFileName}>
          <FileText className="h-4 w-4" />
          {t('sources.copyFileName')}
        </ContextMenuItem>
      )}
      {onCopyRelativePath && (
        <ContextMenuItem onClick={onCopyRelativePath}>
          <FolderTree className="h-4 w-4" />
          {t('sources.copyRelativePath')}
        </ContextMenuItem>
      )}
      {onCopyAbsolutePath && (
        <ContextMenuItem disabled={disableCopyAbsolutePath} onClick={onCopyAbsolutePath}>
          <HardDrive className="h-4 w-4" />
          {t('sources.copyAbsolutePath')}
        </ContextMenuItem>
      )}
      {(hasTop || hasCopyPaths) && hasMiddle && <ContextMenuSeparator />}
      {showUngroup && (
        <ContextMenuItem onClick={onUngroup}>
          <X className="h-4 w-4" />
          {t('sources.grouping.ungroupAction')}
        </ContextMenuItem>
      )}
      {onRemoveFromNotebook && (
        <ContextMenuItem onClick={onRemoveFromNotebook}>
          <Unlink className="h-4 w-4" />
          {t('sources.removeFromNotebook')}
        </ContextMenuItem>
      )}
      {onDelete && (hasTop || hasMiddle) && <ContextMenuSeparator />}
      {onDelete && (
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          {t('sources.deleteSource')}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  )
}

interface GroupContextMenuContentProps {
  canHaveChildren?: boolean
  onNewSubgroup?: () => void
  onRename?: () => void
  onMove?: () => void
  onDelete?: () => void
}

// 文件夹节点右键项集，与 GroupTree ⋯ 菜单同一组能力，仅换触发时机。
export function GroupContextMenuContent({
  canHaveChildren = false,
  onNewSubgroup,
  onRename,
  onMove,
  onDelete,
}: GroupContextMenuContentProps) {
  const { t } = useTranslation()

  return (
    <ContextMenuContent>
      {canHaveChildren && onNewSubgroup && (
        <ContextMenuItem onClick={onNewSubgroup}>
          <FolderPlus className="h-4 w-4" />
          {t('sources.grouping.newSubgroup')}
        </ContextMenuItem>
      )}
      {onRename && (
        <ContextMenuItem onClick={onRename}>
          <Pencil className="h-4 w-4" />
          {t('common.edit')}
        </ContextMenuItem>
      )}
      {onMove && (
        <ContextMenuItem onClick={onMove}>
          <FolderInput className="h-4 w-4" />
          {t('sources.grouping.moveTo')}
        </ContextMenuItem>
      )}
      {onDelete && (
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          {t('common.delete')}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  )
}

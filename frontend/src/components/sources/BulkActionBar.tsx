'use client'

import { FolderInput, FolderOutput, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'

/** Max sources per member API call; the caller chunks bigger batches. */
export const MEMBER_BATCH_SIZE = 100

/** Split into <=size chunks (order preserved) so bulk edits can loop the API. */
export function chunkIds(ids: string[], size: number = MEMBER_BATCH_SIZE): string[][] {
  if (size < 1) throw new Error('chunk size must be >= 1')
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

interface BulkActionBarProps {
  selectedCount: number
  loadedCount: number
  onMove: () => void
  onCopy: () => void
  onUngroup: () => void
  onRename: () => void
  onDelete: () => void
  onClear: () => void
  /** 调用方场景不适用的按钮（如笔记本列不提供复制/批量重命名） */
  hiddenActions?: Array<'move' | 'copy' | 'ungroup' | 'rename' | 'delete'>
}

/** Bottom action bar for multi-row selection on the sources page. */
export function BulkActionBar({
  selectedCount,
  loadedCount,
  onMove,
  onCopy,
  onUngroup,
  onRename,
  onDelete,
  onClear,
  hiddenActions = [],
}: BulkActionBarProps) {
  const { t } = useTranslation()
  const show = (action: 'move' | 'copy' | 'ungroup' | 'rename' | 'delete') =>
    !hiddenActions.includes(action)

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-lg"
      data-testid="bulk-action-bar"
    >
      <span className="text-sm font-medium">
        {t('sources.grouping.selectedCount', { count: selectedCount })}
        {loadedCount > selectedCount && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {t('sources.grouping.selectedPageHint', { loaded: loadedCount })}
          </span>
        )}
      </span>
      <span className="h-5 w-px bg-border" />
      {show('move') && (
        <Button variant="ghost" size="sm" onClick={onMove}>
          <FolderInput className="mr-2 h-4 w-4" />
          {t('sources.grouping.moveToGroup')}
        </Button>
      )}
      {show('copy') && (
        <Button variant="ghost" size="sm" onClick={onCopy}>
          <FolderOutput className="mr-2 h-4 w-4" />
          {t('sources.grouping.copyToGroup')}
        </Button>
      )}
      {show('ungroup') && (
        <Button variant="ghost" size="sm" onClick={onUngroup}>
          <X className="mr-2 h-4 w-4" />
          {t('sources.grouping.ungroupAction')}
        </Button>
      )}
      {show('rename') && (
        <Button variant="ghost" size="sm" onClick={onRename}>
          <Pencil className="mr-2 h-4 w-4" />
          {t('sources.grouping.batchRename')}
        </Button>
      )}
      {show('delete') && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('sources.grouping.batchDelete')}
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear} aria-label={t('common.cancel')}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

'use client'

import { Copy, FolderInput, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SourceListResponse } from '@/lib/types/api'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SourceRowActionsMenuProps {
  source: SourceListResponse
  isFileTypeView: boolean
  /** Hide the "remove from folder" item (e.g. already browsing the ungrouped list). */
  hideUngroup?: boolean
  onRename: (source: SourceListResponse) => void
  onMove: (source: SourceListResponse) => void
  onCopy: (source: SourceListResponse) => void
  onUngroup: (source: SourceListResponse) => void
  onDelete: (source: SourceListResponse) => void
}

// Hover menu for a single source row; folder actions only exist in groupable views.
export function SourceRowActionsMenu({
  source,
  isFileTypeView,
  hideUngroup = false,
  onRename,
  onMove,
  onCopy,
  onUngroup,
  onDelete,
}: SourceRowActionsMenuProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => e.stopPropagation()}
          aria-label={t('sources.grouping.rowActions', { title: source.title ?? '' })}
          data-testid="source-row-actions-trigger"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onRename(source)}>
          <Pencil className="mr-2 h-4 w-4" />
          {t('sources.grouping.renameSource')}
        </DropdownMenuItem>
        {!isFileTypeView && (
          <>
            <DropdownMenuItem onClick={() => onMove(source)}>
              <FolderInput className="mr-2 h-4 w-4" />
              {t('sources.grouping.moveTo')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCopy(source)}>
              <Copy className="mr-2 h-4 w-4" />
              {t('sources.grouping.copyTo')}
            </DropdownMenuItem>
            {!hideUngroup && (
              <DropdownMenuItem onClick={() => onUngroup(source)}>
                <X className="mr-2 h-4 w-4" />
                {t('sources.grouping.ungroupAction')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(source)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

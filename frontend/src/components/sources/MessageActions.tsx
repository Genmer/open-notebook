'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Save, Copy, Check, BookmarkPlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'
import { SaveNoteDialog } from './SaveNoteDialog'

interface MessageActionsProps {
  content: string
  notebookId?: string
  showTextLabel?: boolean
  /** 透传给保存弹窗，用于「存为来源」模式预选默认文件夹。 */
  sourceGrouping?: NotebookSourceFilters
  /** 删除该条消息（历史编辑入口，AI 消息操作行）。可选：不传则不渲染
   *  删除按钮，行为与之前完全一致；确认弹窗由上层（ChatPanel）负责。 */
  onDelete?: () => void
}

export function MessageActions({
  content,
  notebookId,
  showTextLabel = true,
  sourceGrouping,
  onDelete,
}: MessageActionsProps) {
  const { t } = useTranslation()
  const [copySuccess, setCopySuccess] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)

  const handleCopyToClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content)
        toast.success(t('common.copyToClipboard'))
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 2000)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = content
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        try {
          document.execCommand('copy')
          toast.success(t('common.copyToClipboard'))
          setCopySuccess(true)
          setTimeout(() => setCopySuccess(false), 2000)
        } catch {
          toast.error(t('common.error'))
        }
        document.body.removeChild(textArea)
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
      toast.error(t('common.error'))
    }
  }

  if (showTextLabel && notebookId) {
    return (
      <>
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted"
            onClick={() => setSaveOpen(true)}
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-primary" />
            <span>{t('common.save')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleCopyToClipboard}
          >
            {copySuccess ? (
              <Check className="h-3.5 w-3.5 mr-1" />
            ) : (
              <Copy className="h-3.5 w-3.5 mr-1" />
            )}
            <span>{copySuccess ? t('sources.copied') : t('sources.copy')}</span>
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              <span>{t('sessions.deleteMessage')}</span>
            </Button>
          )}
        </div>
        <SaveNoteDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          content={content}
          notebookId={notebookId}
          sourceGrouping={sourceGrouping}
        />
      </>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex gap-1">
        {notebookId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setSaveOpen(true)}
              >
                <Save className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('common.save')}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={handleCopyToClipboard}
            >
              {copySuccess ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('common.copyToClipboard')}</p>
          </TooltipContent>
        </Tooltip>
        {onDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                onClick={onDelete}
                aria-label={t('sessions.deleteMessage')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('sessions.deleteMessage')}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {notebookId && (
          <SaveNoteDialog
            open={saveOpen}
            onOpenChange={setSaveOpen}
            content={content}
            notebookId={notebookId}
            sourceGrouping={sourceGrouping}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

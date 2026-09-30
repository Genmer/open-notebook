'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Save, Copy, Loader2, Check, BookmarkPlus } from 'lucide-react'
import { useCreateNote } from '@/lib/hooks/use-notes'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useQueryClient } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/api/query-client'

interface MessageActionsProps {
  content: string
  notebookId?: string
  showTextLabel?: boolean
}

export function MessageActions({ content, notebookId, showTextLabel = true }: MessageActionsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [copySuccess, setCopySuccess] = useState(false)
  const createNote = useCreateNote()

  const handleSaveToNote = () => {
    if (!notebookId) {
      toast.error(t('sources.cannotSaveNoteNoNotebook'))
      return
    }

    createNote.mutate(
      {
        content,
        note_type: 'ai',
        notebook_id: notebookId,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
          toast.success('已成功保存至右侧笔记！')
        },
      }
    )
  }

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
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted"
          onClick={handleSaveToNote}
          disabled={createNote.isPending}
        >
          {createNote.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <BookmarkPlus className="h-3.5 w-3.5 text-primary" />
          )}
          <span>保存为笔记</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={handleCopyToClipboard}
        >
          {copySuccess ? (
            <Check className="h-3.5 w-3.5 text-fern mr-1" />
          ) : (
            <Copy className="h-3.5 w-3.5 mr-1" />
          )}
          <span>{copySuccess ? '已复制' : '复制'}</span>
        </Button>
      </div>
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
                onClick={handleSaveToNote}
                disabled={createNote.isPending}
              >
                {createNote.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('common.saveToNote')}</p>
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
              disabled={createNote.isPending}
            >
              {copySuccess ? (
                <Check className="h-3.5 w-3.5 text-fern" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('common.copyToClipboard')}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}


'use client'

import { useEffect, useMemo, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { parseFlashcards } from '@/lib/utils/artifact-context'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { FlashcardViewer } from './FlashcardViewer'

interface ArtifactViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  note?: { title: string | null; content: string | null }
}

/**
 * Read-only rendering for study artifacts stored as notes: flashcard notes
 * render as click-to-flip cards, everything else as Markdown.
 */
export function ArtifactViewDialog({ open, onOpenChange, note }: ArtifactViewDialogProps) {
  const { t } = useTranslation()
  const [isFullscreen, setIsFullscreen] = useState(false)

  const flashcards = useMemo(() => parseFlashcards(note?.content), [note?.content])

  // 关闭时复位全屏态，下次打开回到普通弹窗
  useEffect(() => {
    if (!open) setIsFullscreen(false)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-2xl max-h-[85vh] overflow-y-auto',
          // ! 前缀覆盖 ui/dialog.tsx 基类的 sm:max-w-[calc(100%-2rem)]（同 NoteEditorDialog 先例）
          isFullscreen && '!max-w-screen !max-h-screen w-screen h-screen border-none rounded-none'
        )}
        onEscapeKeyDown={(event) => {
          // Radix 的 Escape 关闭走 DismissableLayer，内容层 onKeyDown 不可靠：
          // 全屏态拦截先退全屏，非全屏放行让 Radix 正常关窗。
          if (isFullscreen) {
            event.preventDefault()
            setIsFullscreen(false)
          }
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-16 top-4 h-7 w-7 text-muted-foreground"
          onClick={() => setIsFullscreen((value) => !value)}
          aria-label={isFullscreen ? t('artifacts.exitFullscreen') : t('artifacts.enterFullscreen')}
          title={isFullscreen ? t('artifacts.exitFullscreen') : t('artifacts.enterFullscreen')}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <DialogTitle className="pr-8 break-words">
          {note?.title || t('artifacts.readOnlyView')}
        </DialogTitle>
        {!note?.content ? null : (
          <div className={cn(isFullscreen && 'max-w-prose mx-auto w-full')}>
            {flashcards ? (
              <FlashcardViewer cards={flashcards} />
            ) : (
              <MarkdownRenderer>{note.content}</MarkdownRenderer>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

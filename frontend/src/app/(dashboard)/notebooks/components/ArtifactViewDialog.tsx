'use client'

import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, Maximize2, Minimize2, Pencil } from 'lucide-react'
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
  /** 打开编辑器改写这条笔记（阅读弹窗由调用方负责关闭）。 */
  onEdit?: () => void
  /** 把这条笔记内容转成 text 来源加入笔记本（阅读弹窗由调用方负责关闭）。 */
  onSaveAsSource?: () => void
}

/**
 * Read-only rendering for study artifacts stored as notes: flashcard notes
 * render as click-to-flip cards, everything else as Markdown.
 */
export function ArtifactViewDialog({ open, onOpenChange, note, onEdit, onSaveAsSource }: ArtifactViewDialogProps) {
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
        {/* 底部操作栏独立于内容条件渲染：空内容笔记也能进编辑器（恰是最需
            写内容的场景），全屏态自行套 prose 容器与正文对齐。 */}
        {!!(onEdit || onSaveAsSource) && (
          <div className={cn('flex gap-2 pt-2', isFullscreen && 'max-w-prose mx-auto w-full')}>
            {onEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onEdit}
                data-testid="artifact-view-edit"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('artifacts.editNote')}
              </Button>
            )}
            {onSaveAsSource && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onSaveAsSource}
                data-testid="artifact-view-save-as-source"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                {t('notebooks.saveAsSource.action')}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

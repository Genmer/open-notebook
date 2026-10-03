'use client'

import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, Maximize2, Minimize2, Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { parseFlashcards } from '@/lib/utils/artifact-context'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { NoteResponse } from '@/lib/types/api'
import { cn } from '@/lib/utils'
import { FlashcardViewer } from './FlashcardViewer'
import { ArtifactSidePanels } from '@/components/common/ArtifactSidePanels'

interface ArtifactViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  note?: { title: string | null; content: string | null }
  /** 打开编辑器改写这条笔记（阅读弹窗由调用方负责关闭）。 */
  onEdit?: () => void
  /** 把这条笔记内容转成 text 来源加入笔记本（阅读弹窗由调用方负责关闭）。 */
  onSaveAsSource?: () => void
  /** 笔记本上下文：有值时全屏态提供来源/笔记侧栏（来源点开详情走 nb 供数）。 */
  notebookId?: string
  /** 右侧笔记侧栏列表（调用方已有的笔记缓存，面板不重复拉取）。 */
  notes?: NoteResponse[]
  /** 当前阅读的笔记 id（侧栏高亮）。 */
  activeNoteId?: string | null
  /** 点击侧栏笔记切换阅读对象。 */
  onNoteSelect?: (note: NoteResponse) => void
  /** 点击侧栏来源打开详情弹窗。 */
  onOpenSource?: (sourceId: string) => void
}

/**
 * Read-only rendering for study artifacts stored as notes: flashcard notes
 * render as click-to-flip cards, everything else as Markdown.
 */
export function ArtifactViewDialog({
  open,
  onOpenChange,
  note,
  onEdit,
  onSaveAsSource,
  notebookId,
  notes,
  activeNoteId,
  onNoteSelect,
  onOpenSource,
}: ArtifactViewDialogProps) {
  const { t } = useTranslation()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)

  const flashcards = useMemo(() => parseFlashcards(note?.content), [note?.content])

  // 关闭时复位全屏与侧栏态，下次打开回到普通弹窗
  useEffect(() => {
    if (!open) {
      setIsFullscreen(false)
      setLeftOpen(false)
      setRightOpen(false)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-2xl max-h-[85vh]',
          !isFullscreen && 'overflow-y-auto',
          // sm:max-w-none/sm:max-h-none 覆盖 ui/dialog.tsx 基类的
          // sm:max-w-[calc(100%-2rem)] 与上行的 sm:max-w-2xl/max-h-[85vh]
          //（Tailwind v4 中 sm: 变体在样式表里排在裸工具类之后，必胜；
          // 原 !max-w-screen 是 v3 前缀 important 语法且该工具类 v4 不存在，
          // 不生成任何 CSS，全屏因此曾被基类 max-width 锁死）。
          // 全屏态把基类 grid 变成三行模板：标题 auto / 正文滚动层 1fr / 底部操作栏 auto。
          // 依赖全屏态恰好三个流内子级（DialogTitle、正文层、操作栏）——全屏按钮与
          // X（ui/dialog.tsx 基类）均 absolute 不占流；新增流内子级须同步改此模板。
          // overflow 条件互斥输出，不依赖 cn/twMerge 的追加顺序（两个方向都安全）。
          isFullscreen &&
            'sm:max-w-none sm:max-h-none w-screen h-screen border-none rounded-none overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto]'
        )}
        onEscapeKeyDown={(event) => {
          // Radix 的 Escape 关闭走 DismissableLayer，内容层 onKeyDown 不可靠：
          // 三段式——侧栏开着先关侧栏，其次退全屏，非全屏放行让 Radix 正常关窗。
          if (isFullscreen && (leftOpen || rightOpen)) {
            event.preventDefault()
            setLeftOpen(false)
            setRightOpen(false)
          } else if (isFullscreen) {
            event.preventDefault()
            setIsFullscreen(false)
          }
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-16 top-4 z-30 h-7 w-7 text-muted-foreground"
          onClick={() => setIsFullscreen((value) => !value)}
          aria-label={isFullscreen ? t('artifacts.exitFullscreen') : t('artifacts.enterFullscreen')}
          title={isFullscreen ? t('artifacts.exitFullscreen') : t('artifacts.enterFullscreen')}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <DialogTitle className="pr-8 break-words">
          {note?.title || t('artifacts.readOnlyView')}
        </DialogTitle>
        {/* 全屏态：正文包进滚动层（1fr 行轨 + min-h-0 使其可收缩滚动）+ prose
            容器与操作栏对齐；操作栏独立成第三行常驻可见。非全屏无包裹、无
            prose 容器，DOM 与无模板时一致。key 取当前笔记 id：切笔记时
            FlashcardViewer 重挂（翻面态按 index 存）。 */}
        {/* 全屏态滚动包裹层恒渲染（空内容也要占住 1fr 行轨），否则 grid 自动
            放置会把操作栏吸进中间行、贴着标题并拉伸；key 取当前笔记 id：
            切笔记时 FlashcardViewer 重挂（翻面态按 index 存）。 */}
        {isFullscreen ? (
          <div className="min-h-0 overflow-y-auto">
            {!!note?.content && (
              <div className="max-w-prose mx-auto w-full" key={activeNoteId ?? note.title ?? 'note'}>
                {flashcards ? (
                  <FlashcardViewer cards={flashcards} />
                ) : (
                  <MarkdownRenderer>{note.content}</MarkdownRenderer>
                )}
              </div>
            )}
          </div>
        ) : !note?.content ? null : (
          <div key={activeNoteId ?? note.title ?? 'note'}>
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

        {/* 全屏阅读侧栏与拉手：absolute 挂在 DialogContent 上（其 translate 使
            其成为定位包含块、overflow-hidden 裁剪），面板不随正文滚动；挂 fixed
            无效——transform 祖先会退化 fixed 定位。 */}
        {isFullscreen && !!notebookId && (
          <>
            {/* 左拉手（面板开时隐藏） */}
            {!leftOpen && (
              <button
                type="button"
                className="group absolute inset-y-0 left-0 top-12 z-20 flex w-6 items-center justify-start"
                onClick={() => setLeftOpen(true)}
                aria-label={t('artifacts.openSourcesPanel')}
                title={t('artifacts.openSourcesPanel')}
                data-testid="artifact-handle-left"
              >
                <span className="h-16 w-1 rounded-r bg-border transition-colors group-hover:bg-primary/60" />
              </button>
            )}
            {/* 右拉手（面板开时隐藏；top-12 避开 X 的 right-4 top-4 点击带） */}
            {!rightOpen && (
              <button
                type="button"
                className="group absolute inset-y-0 right-0 top-12 z-20 flex w-6 items-center justify-end"
                onClick={() => setRightOpen(true)}
                aria-label={t('artifacts.openNotesPanel')}
                title={t('artifacts.openNotesPanel')}
                data-testid="artifact-handle-right"
              >
                <span className="h-16 w-1 rounded-l bg-border transition-colors group-hover:bg-primary/60" />
              </button>
            )}
            <ArtifactSidePanels
              notebookId={notebookId}
              notes={notes}
              activeNoteId={activeNoteId ?? null}
              leftOpen={leftOpen}
              rightOpen={rightOpen}
              onLeftOpenChange={setLeftOpen}
              onRightOpenChange={setRightOpen}
              onExitFullscreen={() => setIsFullscreen(false)}
              onOpenSource={onOpenSource}
              onNoteSelect={onNoteSelect}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  FolderTargetSection,
  defaultFolderTarget,
  type FolderTargetValue,
} from '@/components/sources/FolderTargetSection'
import { useCreateNote } from '@/lib/hooks/use-notes'
import { useCreateSource, type NotebookSourceFilters } from '@/lib/hooks/use-sources'
import { useInvalidateGrouping } from '@/lib/hooks/use-source-views'
import { createTextSourceWithFiling } from '@/lib/utils/save-as-source'
import { useTranslation } from '@/lib/hooks/use-translation'

type SaveMode = 'source' | 'note'

interface SaveNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  content: string
  notebookId: string
  /** 当前分组浏览范围，用于「存为来源」模式预选默认文件夹；缺省即无文件夹。 */
  sourceGrouping?: NotebookSourceFilters
  /** 打开时预选的模式（如 AI 解析结果默认「存为笔记」）；缺省 'source'。 */
  initialMode?: SaveMode
}

// 本地生成默认标题：首个非空行去掉常见 Markdown 记号后截前 40 字符（无 AI 调用）。
// 笔记直接属于笔记本（不属于文件夹体系），需要文件夹组织时切「存为来源」模式。
function defaultNoteTitle(content: string): string {
  const firstLine =
    content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  return firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/^([>*+-]\s*)+/, '')
    .trim()
    .slice(0, 40)
}

// 对话回答「保存」的双模式弹窗：存为来源（默认，转 text 来源可入文件夹）或
// 存为笔记（原 SaveNoteDialog 行为）；结构照 RenameSourceDialog 的受控弹窗骨架。
export function SaveNoteDialog({
  open,
  onOpenChange,
  content,
  notebookId,
  sourceGrouping,
  initialMode,
}: SaveNoteDialogProps) {
  const { t } = useTranslation()
  const createNote = useCreateNote()
  const createSource = useCreateSource()
  const invalidateGrouping = useInvalidateGrouping()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<SaveMode>('source')
  const [folderTarget, setFolderTarget] = useState<FolderTargetValue | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 组件持续挂载（open=false 也渲染），每次打开按当前内容重新预填，并重置为
  // 默认模式（initialMode，缺省「存为来源」）与文件夹选择，不留残留
  // （frontend/AGENTS.md 约定 Dialog 不自动重置）。initialMode 必须在 effect
  // 内消费：useState 初始化器只在首次挂载执行一次，会被这里的 setMode 覆盖。
  useEffect(() => {
    if (!open) return
    setName(defaultNoteTitle(content))
    setMode(initialMode ?? 'source')
    setFolderTarget(defaultFolderTarget(sourceGrouping))
  }, [open, content, sourceGrouping, initialMode])

  const trimmed = name.trim()

  const submit = async () => {
    // 来源模式与 SaveAsSourceDialog 同一空内容守卫；笔记模式允许空内容（维持现状）
    if (!trimmed || submitting || (mode === 'source' && !content.trim())) return
    setSubmitting(true)
    try {
      if (mode === 'source') {
        await createTextSourceWithFiling({
          createSource,
          queryClient,
          invalidateGrouping,
          t,
          notebookId,
          title: trimmed,
          content,
          folderTarget,
        })
      } else {
        await createNote.mutateAsync({
          title: trimmed,
          content,
          note_type: 'ai',
          notebook_id: notebookId,
        })
      }
      onOpenChange(false)
    } catch {
      // useCreateSource / useCreateNote 已负责错误 toast，弹窗保持打开供重试
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('notebooks.saveNote.title')}</DialogTitle>
          <DialogDescription>{t('notebooks.saveNote.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <span className="text-sm font-medium leading-none">{t('notebooks.saveNote.typeLabel')}</span>
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as SaveMode)}
            className="flex items-center gap-4"
            data-testid="save-note-mode-group"
          >
            <Label
              htmlFor="save-mode-source"
              className="flex cursor-pointer items-center gap-2 text-sm font-normal"
            >
              <RadioGroupItem id="save-mode-source" value="source" data-testid="save-mode-source" />
              {t('notebooks.saveNote.modeSource')}
            </Label>
            <Label
              htmlFor="save-mode-note"
              className="flex cursor-pointer items-center gap-2 text-sm font-normal"
            >
              <RadioGroupItem id="save-mode-note" value="note" data-testid="save-mode-note" />
              {t('notebooks.saveNote.modeNote')}
            </Label>
          </RadioGroup>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium leading-none" htmlFor="save-note-name">
            {t('notebooks.saveNote.nameLabel')}
          </label>
          <Input
            id="save-note-name"
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('notebooks.saveNote.namePlaceholder')}
            data-testid="save-note-name-input"
          />
          {mode === 'source' && (
            <p className="text-xs text-muted-foreground">{t('notebooks.saveAsSource.noEmbedHint')}</p>
          )}
        </div>
        {mode === 'source' && (
          <FolderTargetSection
            value={folderTarget}
            onChange={setFolderTarget}
            defaultViewId={sourceGrouping?.viewId}
            collapsible={true}
          />
        )}
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!trimmed || submitting || (mode === 'source' && !content.trim())}
            onClick={submit}
            data-testid="save-note-submit"
          >
            {submitting ? <LoadingSpinner size="sm" /> : t('notebooks.saveNote.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

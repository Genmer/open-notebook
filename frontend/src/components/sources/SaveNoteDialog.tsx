'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateNote } from '@/lib/hooks/use-notes'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SaveNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  content: string
  notebookId: string
}

// 本地生成默认标题：首个非空行去掉常见 Markdown 记号后截前 40 字符（无 AI 调用）。
// 笔记直接属于笔记本（不属于文件夹体系），需要文件夹组织时走「存为来源」。
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

// 对话回答「保存为笔记」的命名弹窗：显式传 title，所见即所得，不依赖后端
// LLM 自动起名；结构照 RenameSourceDialog 的受控弹窗骨架。
export function SaveNoteDialog({ open, onOpenChange, content, notebookId }: SaveNoteDialogProps) {
  const { t } = useTranslation()
  const createNote = useCreateNote()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 组件持续挂载（open=false 也渲染），每次打开按当前内容重新预填，不留残留
  useEffect(() => {
    if (open) setName(defaultNoteTitle(content))
  }, [open, content])

  const trimmed = name.trim()

  const submit = async () => {
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await createNote.mutateAsync({
        title: trimmed,
        content,
        note_type: 'ai',
        notebook_id: notebookId,
      })
      onOpenChange(false)
    } catch {
      // useCreateNote 已负责错误 toast，弹窗保持打开供重试
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('notebooks.saveNote.title')}</DialogTitle>
          <DialogDescription>{t('notebooks.saveNote.description')}</DialogDescription>
        </DialogHeader>
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
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!trimmed || submitting} onClick={submit} data-testid="save-note-submit">
            {submitting ? <LoadingSpinner size="sm" /> : t('notebooks.saveNote.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

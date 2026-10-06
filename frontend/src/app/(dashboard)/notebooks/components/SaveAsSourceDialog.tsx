'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import {
  FolderTargetSection,
  defaultFolderTarget,
  type FolderTargetValue,
} from '@/components/sources/FolderTargetSection'
import { useCreateSource, type NotebookSourceFilters } from '@/lib/hooks/use-sources'
import { useInvalidateGrouping } from '@/lib/hooks/use-source-views'
import { createTextSourceWithFiling } from '@/lib/utils/save-as-source'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { NoteResponse } from '@/lib/types/api'

interface SaveAsSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: NoteResponse
  sourceGrouping?: NotebookSourceFilters
}

// 把一条笔记的内容转成 text 来源挂进本笔记本（embed:false 不排队嵌入），
// 可选归档到文件夹；结构照 RenameSourceDialog 的受控弹窗骨架。
export function SaveAsSourceDialog({
  open,
  onOpenChange,
  notebookId,
  note,
  sourceGrouping,
}: SaveAsSourceDialogProps) {
  const { t } = useTranslation()
  const createSource = useCreateSource()
  const invalidateGrouping = useInvalidateGrouping()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [folderTarget, setFolderTarget] = useState<FolderTargetValue | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 组件持续挂载（open=false 也渲染），打开时重置表单，避免残留上一条笔记
  // 的名称与文件夹选择（frontend/AGENTS.md 约定 Dialog 不自动重置）。
  useEffect(() => {
    if (!open) return
    setName(note?.title || (note?.content ?? '').slice(0, 40))
    setFolderTarget(defaultFolderTarget(sourceGrouping))
  }, [open, note, sourceGrouping])

  // Hooks 全部在前：note 缺失时只跳过渲染，不改变 hooks 数量
  if (!note) return null

  const trimmed = name.trim()

  const submit = async () => {
    if (!trimmed || !note.content?.trim() || submitting) return
    setSubmitting(true)
    try {
      await createTextSourceWithFiling({
        createSource,
        queryClient,
        invalidateGrouping,
        t,
        notebookId,
        title: trimmed,
        content: note.content,
        folderTarget,
      })
      onOpenChange(false)
    } catch {
      // useCreateSource 已负责错误 toast，弹窗保持打开供重试
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('notebooks.saveAsSource.title')}</DialogTitle>
          <DialogDescription>{t('notebooks.saveAsSource.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-sm font-medium leading-none" htmlFor="save-as-source-name">
            {t('notebooks.saveAsSource.nameLabel')}
          </label>
          <Input
            id="save-as-source-name"
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('notebooks.saveAsSource.namePlaceholder')}
            data-testid="save-as-source-name-input"
          />
          <p className="text-xs text-muted-foreground">
            {t('notebooks.saveAsSource.noEmbedHint')}
          </p>
        </div>
        <FolderTargetSection
          value={folderTarget}
          onChange={setFolderTarget}
          defaultViewId={sourceGrouping?.viewId}
          collapsible={true}
        />
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!trimmed || !note.content?.trim() || submitting}
            onClick={submit}
            data-testid="save-as-source-submit"
          >
            {submitting ? <LoadingSpinner size="sm" /> : t('notebooks.saveAsSource.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

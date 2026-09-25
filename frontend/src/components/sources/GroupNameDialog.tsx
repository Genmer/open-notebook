'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

interface GroupNameDialogProps {
  open: boolean
  mode?: 'create' | 'rename'
  initialName?: string
  onConfirm: (name: string) => void | Promise<void>
  onOpenChange: (open: boolean) => void
  isPending?: boolean
  /** 落点路径（视图名[/文件夹链]），create 模式下显示"将创建在：…"。 */
  locationPath?: string
  /** 同级现有文件夹名，用于只读提示与提交前重名防错；rename 时自身名字不算冲突。 */
  siblingNames?: string[]
}

// 右键入口的文件夹命名弹窗（create/rename 二态）。onConfirm 拒绝时保持打开，
// 让调用方的错误 toast 可以重试；成功由调用方关流（这里 resolve 后关闭）。
export function GroupNameDialog({
  open,
  mode = 'create',
  initialName = '',
  onConfirm,
  onOpenChange,
  isPending = false,
  locationPath,
  siblingNames,
}: GroupNameDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  const trimmed = name.trim()
  const busy = submitting || isPending
  const duplicate = !!trimmed && !!siblingNames?.includes(trimmed) && trimmed !== initialName

  const submit = async () => {
    if (!trimmed || busy || duplicate) return
    setSubmitting(true)
    try {
      await onConfirm(trimmed)
      onOpenChange(false)
    } catch {
      // error toast comes from the caller; keep the dialog open for retry
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === 'rename'
              ? t('sources.grouping.renameGroupTitle')
              : t('sources.grouping.newGroupTitle')}
          </DialogTitle>
        </DialogHeader>
        {mode === 'create' && locationPath && (
          <p className="text-sm text-muted-foreground" data-testid="group-location-hint">
            {t('sources.grouping.createInLabel', { path: locationPath })}
          </p>
        )}
        {!!siblingNames?.length && (
          <div className="space-y-1" data-testid="sibling-folders">
            <p className="text-xs font-medium text-muted-foreground">
              {t('sources.grouping.siblingFoldersLabel')}
            </p>
            <div className="flex flex-wrap gap-1" data-testid="sibling-folder-chips">
              {siblingNames.map((sibling) => (
                <span
                  key={sibling}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs',
                    sibling === trimmed && trimmed !== initialName
                      ? 'border-destructive/50 bg-destructive/10 text-destructive'
                      : 'text-muted-foreground'
                  )}
                >
                  {sibling}
                </span>
              ))}
            </div>
          </div>
        )}
        <Input
          autoFocus
          value={name}
          maxLength={100}
          placeholder={t('sources.grouping.groupNamePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          data-testid="group-name-input"
        />
        {duplicate && (
          <p className="text-xs font-medium text-destructive" data-testid="group-name-duplicate">
            {t('sources.grouping.duplicateNameInline')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!trimmed || busy || duplicate} onClick={submit} data-testid="group-name-save">
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

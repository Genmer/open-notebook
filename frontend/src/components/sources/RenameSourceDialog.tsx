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
import { SourceListResponse } from '@/lib/types/api'
import { useTranslation } from '@/lib/hooks/use-translation'

interface RenameSourceDialogProps {
  open: boolean
  source: SourceListResponse | null
  onConfirm: (title: string) => void | Promise<void>
  onOpenChange: (open: boolean) => void
}

// Rename dialog for a single source; stays open when onConfirm rejects so the
// caller's error toast can be acted on.
export function RenameSourceDialog({ open, source, onConfirm, onOpenChange }: RenameSourceDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setTitle(source?.title ?? '')
  }, [open, source])

  const trimmed = title.trim()

  const submit = async () => {
    if (!trimmed || !source) return
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
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('sources.grouping.renameSourceTitle')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          data-testid="rename-source-input"
        />
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!trimmed || submitting} onClick={submit} data-testid="rename-source-save">
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

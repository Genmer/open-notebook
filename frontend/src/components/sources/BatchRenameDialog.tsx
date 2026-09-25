'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SourceListResponse } from '@/lib/types/api'
import { transformTitle, type RenameRules } from '@/lib/utils/title-transform'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

// Above this count the caller writes titles one by one, so warn about the wait.
const SLOW_HINT_THRESHOLD = 50

interface BatchRenameDialogProps {
  open: boolean
  sources: SourceListResponse[]
  onApply: (items: { id: string; title: string }[]) => void | Promise<void>
  onOpenChange: (open: boolean) => void
}

interface PreviewRow {
  id: string
  from: string
  to: string
  changed: boolean
}

// Rule inputs with a live old -> new preview; only changed items are applied.
export function BatchRenameDialog({ open, sources, onApply, onOpenChange }: BatchRenameDialogProps) {
  const { t } = useTranslation()
  const [rules, setRules] = useState<RenameRules>({ prefix: '', suffix: '', find: '', replace: '' })
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (open) setRules({ prefix: '', suffix: '', find: '', replace: '' })
  }, [open])

  const preview: PreviewRow[] = useMemo(
    () =>
      sources.map((s) => {
        const from = s.title ?? ''
        const to = transformTitle(from, rules)
        return { id: s.id, from, to, changed: to !== from }
      }),
    [sources, rules]
  )
  const changedItems = preview.filter((p) => p.changed)
  const hasChanges = changedItems.length > 0

  const apply = async () => {
    if (!hasChanges || applying) return
    setApplying(true)
    try {
      await onApply(changedItems.map(({ id, to }) => ({ id, title: to })))
      onOpenChange(false)
    } catch {
      // keep the dialog open for retry; the caller surfaces the error
    } finally {
      setApplying(false)
    }
  }

  const ruleField = (
    key: keyof RenameRules,
    labelKey: string,
    testId: string
  ) => (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t(labelKey)}</span>
      <Input
        value={rules[key] ?? ''}
        onChange={(e) => setRules((r) => ({ ...r, [key]: e.target.value }))}
        data-testid={testId}
      />
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !applying && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sources.grouping.batchRenameTitle')}</DialogTitle>
          <DialogDescription>
            {t('sources.grouping.batchRenameDesc', { count: sources.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {ruleField('prefix', 'sources.grouping.prefixLabel', 'batch-rename-prefix')}
          {ruleField('suffix', 'sources.grouping.suffixLabel', 'batch-rename-suffix')}
          {ruleField('find', 'sources.grouping.findLabel', 'batch-rename-find')}
          {ruleField('replace', 'sources.grouping.replaceLabel', 'batch-rename-replace')}
        </div>

        {sources.length > SLOW_HINT_THRESHOLD && (
          <p className="text-xs text-muted-foreground" data-testid="batch-rename-slow-hint">
            {t('sources.grouping.renameSlowHint')}
          </p>
        )}

        <div className="rounded-md border" data-testid="batch-rename-preview">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {hasChanges
              ? t('sources.grouping.previewLabel', { changed: changedItems.length, count: sources.length })
              : t('sources.grouping.noChanges')}
          </div>
          <div className="max-h-52 overflow-y-auto">
            {preview.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-1.5 text-sm"
                data-testid="batch-rename-preview-row"
              >
                <span className="min-w-0 flex-1 truncate">{p.from || t('sources.untitledSource')}</span>
                <span aria-hidden className="shrink-0 text-muted-foreground">→</span>
                <span
                  className={cn('min-w-0 flex-1 truncate', p.changed ? 'font-medium' : 'text-muted-foreground')}
                  data-changed={p.changed}
                >
                  {p.changed ? p.to : t('sources.grouping.previewUnchanged')}
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!hasChanges || applying} onClick={apply} data-testid="batch-rename-apply">
            {t('sources.grouping.applyRename')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

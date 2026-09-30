'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { ImportDecisionInput, ImportScanResponse } from '@/lib/api/dataTransfer'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

type ConflictAction = 'skip' | 'overwrite'

interface ImportConflictDialogProps {
  open: boolean
  scan: ImportScanResponse | null
  isLoading?: boolean
  onCancel: () => void
  onConfirm: (decisions: ImportDecisionInput[]) => void
}

// Display order of the per-side summary fields; backend summaries only carry
// these keys. Literal i18n keys so the locale unused-key scanner sees them.
const FIELD_ORDER: Record<'credential' | 'model', string[]> = {
  credential: ['name', 'provider', 'api_key', 'model_count'],
  model: ['name', 'provider', 'type', 'credential'],
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'dataManagement.import.conflict.fields.name',
  provider: 'dataManagement.import.conflict.fields.provider',
  type: 'dataManagement.import.conflict.fields.type',
  api_key: 'dataManagement.import.conflict.fields.api_key',
  credential: 'dataManagement.import.conflict.fields.credential',
  model_count: 'dataManagement.import.conflict.fields.model_count',
}

function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export function ImportConflictDialog({
  open,
  scan,
  isLoading = false,
  onCancel,
  onConfirm,
}: ImportConflictDialogProps) {
  const { t } = useTranslation()
  const [choices, setChoices] = useState<Record<string, ConflictAction>>({})

  useEffect(() => {
    // New scan → every conflict defaults to skip (the backend default too).
    if (!scan) return
    setChoices(
      Object.fromEntries(scan.conflicts.map((item) => [item.id, item.default_action]))
    )
  }, [scan])

  if (!scan) return null

  const conflicts = scan.conflicts

  const setAll = (action: ConflictAction) => {
    setChoices(Object.fromEntries(conflicts.map((item) => [item.id, action])))
  }

  const handleConfirm = () => {
    onConfirm(
      conflicts.map((item) => ({
        kind: item.kind,
        id: item.id,
        action: choices[item.id] ?? item.default_action,
      }))
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('dataManagement.import.conflict.title')}</DialogTitle>
          <DialogDescription>
            {t('dataManagement.import.conflict.description', { count: conflicts.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAll('skip')}>
            {t('dataManagement.import.conflict.skipAll')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAll('overwrite')}>
            {t('dataManagement.import.conflict.overwriteAll')}
          </Button>
        </div>

        <ScrollArea className="max-h-[50vh] pr-3">
          <div className="space-y-3">
            {conflicts.map((item) => {
              const diff = new Set(item.diff_fields)
              return (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline">
                        {item.kind === 'credential'
                          ? t('dataManagement.import.conflict.kindCredential')
                          : t('dataManagement.import.conflict.kindModel')}
                      </Badge>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {item.id}
                      </span>
                    </div>
                    <RadioGroup
                      value={choices[item.id] ?? item.default_action}
                      onValueChange={(value) =>
                        setChoices((prev) => ({ ...prev, [item.id]: value as ConflictAction }))
                      }
                      className="flex flex-row gap-4"
                    >
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <RadioGroupItem value="skip" />
                        {t('dataManagement.import.conflict.skip')}
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <RadioGroupItem value="overwrite" />
                        {t('dataManagement.import.conflict.overwrite')}
                      </label>
                    </RadioGroup>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                    {(
                      [
                        ['local', item.local],
                        ['package', item.package],
                      ] as const
                    ).map(([side, row]) => (
                      <div key={side} className="min-w-0">
                        <p className="font-medium text-muted-foreground">
                          {side === 'local'
                            ? t('dataManagement.import.conflict.localColumn')
                            : t('dataManagement.import.conflict.packageColumn')}
                        </p>
                        <dl className="mt-1 space-y-0.5">
                          {FIELD_ORDER[item.kind].map((field) => (
                            <div key={field} className="flex gap-2">
                              <dt
                                className={cn(
                                  'w-24 shrink-0 text-muted-foreground',
                                  diff.has(field) && 'font-medium text-destructive'
                                )}
                              >
                                {t(FIELD_LABEL_KEYS[field] ?? field)}
                              </dt>
                              <dd
                                className={cn(
                                  'min-w-0 break-all',
                                  diff.has(field) && 'font-medium text-destructive'
                                )}
                              >
                                {fieldValue(row[field])}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>

        {(scan.counts?.default_models ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('dataManagement.import.conflict.defaultNote')}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('dataManagement.import.conflict.startImport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

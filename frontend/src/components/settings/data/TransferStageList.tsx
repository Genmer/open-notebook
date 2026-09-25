'use client'

import { Check, Loader2, X } from 'lucide-react'

import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

// Full i18n keys are carried per stage (not built from a prefix) so the
// locale unused-key scanner can see every literal key.
export interface TransferStage {
  id: string
  labelKey: string
}

interface TransferStageListProps {
  stages: readonly TransferStage[]
  /** Backend stage id; unknown ids highlight nothing (the message line carries the detail). */
  current?: string
  failed?: boolean
}

export function TransferStageList({ stages, current, failed }: TransferStageListProps) {
  const { t } = useTranslation()
  const currentIndex = current ? stages.findIndex((stage) => stage.id === current) : -1

  return (
    <ol className="space-y-1">
      {stages.map((stage, index) => {
        const isDone = currentIndex >= 0 && index < currentIndex
        const isCurrent = stage.id === current

        return (
          <li
            key={stage.id}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1 text-sm',
              isCurrent && !failed && 'bg-muted font-medium',
              isCurrent && failed && 'bg-destructive-tint font-medium text-destructive',
              !isCurrent && !isDone && 'text-muted-foreground'
            )}
          >
            {isDone ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-fern" />
            ) : isCurrent ? (
              failed ? (
                <X className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              )
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
            )}
            {t(stage.labelKey)}
          </li>
        )
      })}
    </ol>
  )
}

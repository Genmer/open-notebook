'use client'

import { CalendarRange } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import type { accentOf } from './env-accent'

export interface EnvTimelineProps {
  start: string | null
  end: string | null
  months: number | null
  accent: ReturnType<typeof accentOf>
}

// DialogHeader meta 行内的周期段。轨道纯装饰（信息全在两侧文本标签），填充用
// accent.dot 实心类——ribbon 是纵向渐变，贴在横条上方向不匹配。
export function EnvTimeline({ start, end, months, accent }: EnvTimelineProps) {
  const { t } = useTranslation()
  if (!start && !end) return null
  return (
    <span
      data-testid="env-detail-timeline"
      className="inline-flex min-w-0 flex-1 basis-56 items-center gap-2"
    >
      <CalendarRange className="size-3 shrink-0" aria-hidden />
      {start && <span className="shrink-0 font-mono tabular-nums">{start}</span>}
      {start && end && (
        <span aria-hidden className="relative h-1.5 min-w-8 flex-1 rounded-full bg-muted">
          <span className={cn('absolute inset-0 rounded-full opacity-70', accent.dot)} />
          <span
            className={cn(
              'absolute left-0 top-1/2 size-2 -translate-y-1/2 rounded-full ring-2 ring-background',
              accent.dot
            )}
          />
          <span
            className={cn(
              'absolute right-0 top-1/2 size-2 -translate-y-1/2 rounded-full ring-2 ring-background',
              accent.dot
            )}
          />
        </span>
      )}
      {end && <span className="shrink-0 font-mono tabular-nums">{end}</span>}
      {months !== null && (
        <span
          className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', accent.tile)}
        >
          {t('projectEnvs.spanMonths', { count: months })}
        </span>
      )}
    </span>
  )
}

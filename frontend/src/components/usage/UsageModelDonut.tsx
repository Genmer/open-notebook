'use client'

import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useTranslation } from '@/lib/hooks/use-translation'
import { UsageByModel } from '@/lib/types/api'
import { formatCompact, getModelSlices, OTHER_COLOR, usePrefersReducedMotion } from './chart-shared'

interface UsageModelDonutProps {
  byModel: UsageByModel[]
  locale: string
}

interface DonutEntry {
  name: string
  value: number
  color: string
  estimated: boolean
}

export default function UsageModelDonut({ byModel, locale }: UsageModelDonutProps) {
  const { t } = useTranslation()
  const reducedMotion = usePrefersReducedMotion()

  const { entries, total } = useMemo(() => {
    const { slices, otherTotal, otherEstimated } = getModelSlices(byModel)
    const entries: DonutEntry[] = slices.map((s) => ({
      name: s.name,
      value: s.totalTokens,
      color: s.color,
      estimated: s.estimatedTokens > 0,
    }))
    if (otherTotal > 0) {
      entries.push({
        name: t('usage.other'),
        value: otherTotal,
        color: OTHER_COLOR,
        estimated: otherEstimated > 0,
      })
    }
    const total = entries.reduce((sum, e) => sum + e.value, 0)
    return { entries, total }
  }, [byModel, t])

  if (byModel.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        {t('usage.empty')}
      </div>
    )
  }

  return (
    <div
      className="flex flex-col items-center gap-6 sm:flex-row"
      role="img"
      aria-label={t('usage.modelShareAria')}
    >
      <div className="relative h-60 w-60 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={entries}
              dataKey="value"
              nameKey="name"
              innerRadius="70%"
              outerRadius="92%"
              strokeWidth={1}
              stroke="var(--card)"
              isAnimationActive={!reducedMotion}
              animationDuration={300}
            >
              {entries.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip locale={locale} total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" title={total.toLocaleString()}>
            {formatCompact(total, locale)}
          </span>
          <span className="text-xs text-muted-foreground">{t('usage.totalTokens')}</span>
        </div>
      </div>
      <ul className="w-full flex-1 space-y-1.5">
        {entries.map((entry) => {
          const pct = total > 0 ? Math.round((entry.value / total) * 1000) / 10 : 0
          return (
            <li key={entry.name} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="truncate" title={entry.name}>
                {entry.name}
                {entry.estimated && (
                  <span className="ml-1 text-muted-foreground" title={t('usage.estimatedHint')}>
                    ≈
                  </span>
                )}
              </span>
              <span className="ml-auto shrink-0 pl-4 font-mono text-xs">
                {formatCompact(entry.value, locale)}
              </span>
              <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{pct}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function DonutTooltip({
  active,
  payload,
  total,
  locale,
}: {
  active?: boolean
  // recharts passes a single-element payload per pie sector, so the share
  // must come from the chart total instead of summing the payload.
  payload?: Array<{ name?: string | number; value?: string | number }>
  total?: number
  locale: string
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  const value = Number(entry.value ?? 0)
  const pct = total && total > 0 ? Math.round((value / total) * 1000) / 10 : 0
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <span className="text-muted-foreground">{entry.name}: </span>
      <span className="font-mono">{pct}%</span>
      <span className="text-muted-foreground"> · </span>
      <span className="font-mono">{value.toLocaleString(locale)}</span>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTranslation } from '@/lib/hooks/use-translation'
import { UsageByModel, UsageDayModel } from '@/lib/types/api'
import {
  dateSequenceLocal,
  formatCompact,
  getModelSlices,
  OTHER_COLOR,
  usePrefersReducedMotion,
} from './chart-shared'

interface UsageTrendChartProps {
  days: number
  dailyByModel: UsageDayModel[]
  byModel: UsageByModel[]
  locale: string
  isPlaceholder?: boolean
}

const OTHER_KEY = '__other__'

function formatDayLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(`${day}T00:00:00`)
  )
}

function formatMonthYear(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(
    new Date(`${day}T00:00:00`)
  )
}

export default function UsageTrendChart({
  days,
  dailyByModel,
  byModel,
  locale,
  isPlaceholder = false,
}: UsageTrendChartProps) {
  const { t } = useTranslation()
  const reducedMotion = usePrefersReducedMotion()
  // Hidden series are tracked by model name so toggles survive re-ranking.
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  // While keepPreviousData serves the previous range, keep rendering the last
  // real (days, data) pair: the x-axis and the series then switch together
  // instead of re-bucketing old data onto the new range with fake tail zeros.
  const lastRealRef = useRef({ days, dailyByModel, byModel })
  useEffect(() => {
    if (!isPlaceholder) lastRealRef.current = { days, dailyByModel, byModel }
  })
  const effective = isPlaceholder ? lastRealRef.current : { days, dailyByModel, byModel }

  const { data, series, crossYear } = useMemo(() => {
    const { slices, otherTotal } = getModelSlices(effective.byModel)
    const topNames = new Set(slices.map((s) => s.name))
    const hasOther = otherTotal > 0

    const pivot = new Map<string, Map<string, number>>()
    for (const row of effective.dailyByModel) {
      const name = row.model_name ?? '-'
      let perDay = pivot.get(name)
      if (!perDay) {
        perDay = new Map()
        pivot.set(name, perDay)
      }
      perDay.set(row.day, (perDay.get(row.day) ?? 0) + (row.total_tokens ?? 0))
    }

    // Days without rows must be zero-filled or the areas drop to baseline.
    const data = dateSequenceLocal(effective.days).map((day) => {
      const point: Record<string, string | number> = { day }
      slices.forEach((s, i) => {
        point[`s${i}`] = pivot.get(s.name)?.get(day) ?? 0
      })
      if (hasOther) {
        let sum = 0
        for (const [name, perDay] of pivot) {
          if (!topNames.has(name)) sum += perDay.get(day) ?? 0
        }
        point[OTHER_KEY] = sum
      }
      return point
    })

    const series = [
      ...slices.map((s, i) => ({ key: `s${i}`, name: s.name, color: s.color })),
      ...(hasOther ? [{ key: OTHER_KEY, name: t('usage.other'), color: OTHER_COLOR }] : []),
    ]
    const first = String(data[0]?.day ?? '')
    const last = String(data[data.length - 1]?.day ?? '')
    return { data, series, crossYear: first.slice(0, 4) !== last.slice(0, 4) }
  }, [effective.days, effective.dailyByModel, effective.byModel, t])

  if (effective.byModel.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        {t('usage.empty')}
      </div>
    )
  }

  const formatTick = (day: string) =>
    effective.days >= 90 || crossYear ? formatMonthYear(day, locale) : day.slice(5)

  const seriesTotal = (key: string) =>
    data.reduce((sum, point) => sum + Number(point[key] ?? 0), 0)

  const toggleSeries = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div role="img" aria-label={t('usage.trendAria', { days: effective.days })}>
      {/* Clickable legend: reads the series colors without hovering. */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s) => {
          const isHidden = hidden.has(s.name)
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggleSeries(s.name)}
              className={`flex cursor-pointer items-center gap-1.5 text-xs transition-opacity ${
                isHidden ? 'opacity-40' : ''
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="max-w-[10rem] truncate" title={s.name}>
                {s.name}
              </span>
              <span className="font-mono text-muted-foreground">
                {formatCompact(seriesTotal(s.key), locale)}
              </span>
            </button>
          )
        })}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatTick}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatCompact(v, locale)}
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              content={<TrendTooltip locale={locale} totalLabel={t('usage.dailyTotal')} />}
              cursor={{ stroke: 'var(--border)' }}
            />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stackId="1"
                stroke={s.color}
                strokeWidth={1.5}
                fill={`url(#grad-${s.key})`}
                hide={hidden.has(s.name)}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                isAnimationActive={!reducedMotion}
                animationDuration={300}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

interface TooltipEntry {
  dataKey?: string | number
  name?: string | number
  value?: string | number
  color?: string
}

export function TrendTooltip({
  active,
  payload,
  label,
  locale,
  totalLabel,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  locale: string
  totalLabel: string
}) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0)
  return (
    <div className="max-w-xs rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{formatDayLabel(String(label ?? ''), locale)}</p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="truncate text-muted-foreground" title={String(entry.name)}>
            {entry.name}
          </span>
          <span className="ml-auto shrink-0 pl-4 font-mono">
            {formatCompact(Number(entry.value ?? 0), locale)}
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t pt-1 font-medium">
        <span>{totalLabel}</span>
        <span className="font-mono">{formatCompact(total, locale)}</span>
      </div>
    </div>
  )
}

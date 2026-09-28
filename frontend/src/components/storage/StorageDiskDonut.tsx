'use client'

import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useTranslation } from '@/lib/hooks/use-translation'
import { StorageDiskSection } from '@/lib/api/storage'
import { OTHER_COLOR } from '@/components/usage/chart-shared'

// Literal i18n keys: the unused-key test greps source for these strings.
const SECTION_KEYS: Record<string, string> = {
  uploads: 'storage.sections.uploads',
  podcasts: 'storage.sections.podcasts',
  exports: 'storage.sections.exports',
  tiktoken_cache: 'storage.sections.tiktoken_cache',
  sqlite: 'storage.sections.sqlite',
  other: 'storage.sections.other',
}

const SECTION_COLORS = [
  'var(--chart-1)', // uploads
  'var(--chart-2)', // podcasts
  'var(--chart-3)', // exports
  'var(--chart-4)', // tiktoken cache
  'var(--chart-5)', // sqlite
  OTHER_COLOR, // other
]

const SECTION_ORDER = ['uploads', 'podcasts', 'exports', 'tiktoken_cache', 'sqlite']

interface StorageDiskDonutProps {
  sections: Record<string, StorageDiskSection>
  root: string
  formatSize: (bytes: number) => string
}

export default function StorageDiskDonut({
  sections,
  root,
  formatSize,
}: StorageDiskDonutProps) {
  const { t } = useTranslation()

  const { entries, total } = useMemo(() => {
    const names = [...SECTION_ORDER, 'other'].filter(
      (key) => key === 'other' || sections[key]
    )
    const entries = names.map((key, i) => ({
      key,
      name: t(SECTION_KEYS[key] ?? key),
      value: sections[key]?.bytes ?? 0,
      color: SECTION_COLORS[i % SECTION_COLORS.length],
    }))
    const total = entries.reduce((sum, e) => sum + e.value, 0)
    return { entries, total }
  }, [sections, t])

  if (total <= 0) {
    return (
      <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
        {t('storage.disk.diskEmpty')}
      </div>
    )
  }

  return (
    <div
      className="flex flex-col items-center gap-6"
      role="img"
      aria-label={t('storage.disk.diskShareAria')}
    >
      <div className="relative h-52 w-52">
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
              isAnimationActive={false}
            >
              {entries.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip formatSize={formatSize} total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold">{formatSize(total)}</span>
          <span className="text-xs text-muted-foreground">{t('storage.disk.diskTotal')}</span>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {entries.map((entry) => {
          const pct = total > 0 ? Math.round((entry.value / total) * 1000) / 10 : 0
          return (
            <li key={entry.key} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate">{entry.name}</span>
              <span className="ml-auto shrink-0 pl-4 font-mono text-xs">
                {formatSize(entry.value)}
              </span>
              <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
                {pct}%
              </span>
            </li>
          )
        })}
      </ul>
      <p className="w-full truncate text-center text-xs text-muted-foreground" title={root}>
        {t('storage.disk.diskRootPath', { path: root })}
      </p>
    </div>
  )
}

function DonutTooltip({
  active,
  payload,
  total,
  formatSize,
}: {
  active?: boolean
  payload?: Array<{ name?: string | number; value?: string | number }>
  total?: number
  formatSize: (bytes: number) => string
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
      <span className="font-mono">{formatSize(value)}</span>
    </div>
  )
}

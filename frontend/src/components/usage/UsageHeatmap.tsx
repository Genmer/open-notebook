'use client'

import { useMemo } from 'react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { UsageByDay } from '@/lib/types/api'
import { dateSequenceLocal, HEATMAP_DAYS } from './chart-shared'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface UsageHeatmapProps {
  byDay: UsageByDay[]
  locale: string
  isLoading?: boolean
}

const CELL_SIZE = 12
const CELL_GAP = 3
// color-mix keeps both themes correct: dark mode re-resolves var(--fern) to
// its lightened value, which keeps level 1 visibly above the muted level 0.
const LEVEL_MIX = [0, 25, 50, 75, 100] as const

function cellBackground(level: number): string {
  if (level <= 0) return 'var(--muted)'
  return `color-mix(in srgb, var(--fern) ${LEVEL_MIX[level]}%, var(--muted))`
}

export default function UsageHeatmap({ byDay, locale, isLoading = false }: UsageHeatmapProps) {
  const { t } = useTranslation()

  const { cells, maxTokens, mondayOffset, monthLabels } = useMemo(() => {
    const tokensByDay = new Map(byDay.map((row) => [row.day, row.total_tokens ?? 0]))
    const cells = dateSequenceLocal(HEATMAP_DAYS).map((day) => ({
      day,
      tokens: tokensByDay.get(day) ?? 0,
    }))
    const maxTokens = cells.reduce((max, c) => Math.max(max, c.tokens), 0)

    // grid-flow-col + 7 rows lays weeks left→right; pad the first week so the
    // column starts on Monday.
    const firstDay = cells[0].day
    const mondayOffset = (new Date(`${firstDay}T00:00:00`).getDay() + 6) % 7

    const weekCount = Math.ceil((mondayOffset + cells.length) / 7)
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' })
    const labels: Array<{ week: number; label: string }> = []
    let previousMonth = -1
    for (let week = 0; week < weekCount; week++) {
      const cellIndex = week * 7 - mondayOffset
      const anchor = cellIndex >= 0 ? cells[cellIndex].day : cells[0].day
      const date = new Date(`${anchor}T00:00:00`)
      if (date.getMonth() !== previousMonth) {
        previousMonth = date.getMonth()
        labels.push({ week, label: monthFormatter.format(date) })
      }
    }
    return { cells, maxTokens, mondayOffset, monthLabels: labels }
  }, [byDay, locale])

  const weekCount = Math.ceil((mondayOffset + cells.length) / 7)

  if (isLoading) {
    return (
      <div className="overflow-x-auto pb-1" aria-busy="true">
        <div
          className="grid w-fit animate-pulse grid-flow-col gap-[3px]"
          style={{ gridTemplateRows: `repeat(7, ${CELL_SIZE}px)` }}
        >
          {cells.map(({ day }) => (
            <div key={day} className="h-3 w-3 rounded-sm" style={{ backgroundColor: 'var(--muted)' }} />
          ))}
        </div>
      </div>
    )
  }

  // No early return on empty data: a gray half-year grid keeps the layout
  // stable, GitHub-style, with a muted note on top.
  return (
    <TooltipProvider>
      {byDay.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">{t('usage.heatmapNoData')}</p>
      )}
      <div className="overflow-x-auto pb-1">
        <div className="w-fit">
          <div
            className="mb-1 grid"
            style={{
              gridTemplateColumns: `repeat(${weekCount}, ${CELL_SIZE}px)`,
              gap: `${CELL_GAP}px`,
            }}
          >
            {monthLabels.map(({ week, label }) => (
              <span
                key={week}
                className="whitespace-nowrap text-[10px] leading-none text-muted-foreground"
                style={{ gridColumn: `${week + 1} / ${week + 2}`, gridRow: 1 }}
              >
                {label}
              </span>
            ))}
          </div>
          <div
            className="grid grid-flow-col gap-[3px]"
            style={{ gridTemplateRows: `repeat(7, ${CELL_SIZE}px)` }}
          >
            {Array.from({ length: mondayOffset }, (_, i) => (
              <div key={`pad-${i}`} className="h-3 w-3 rounded-sm" />
            ))}
            {cells.map(({ day, tokens }) => {
              const level =
                tokens === 0 || maxTokens === 0 ? 0 : Math.max(1, Math.ceil((tokens / maxTokens) * 4))
              const hint = t('usage.heatmapCellHint', {
                day,
                tokens: tokens.toLocaleString(locale),
              })
              return (
                <Tooltip key={day}>
                  <TooltipTrigger asChild>
                    <div
                      tabIndex={0}
                      aria-label={hint}
                      className="h-3 w-3 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ backgroundColor: cellBackground(level) }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{hint}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-end gap-1">
            <span className="text-[10px] text-muted-foreground">{t('usage.less')}</span>
            {LEVEL_MIX.map((mix) => (
              <div
                key={mix}
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: cellBackground(LEVEL_MIX.indexOf(mix)) }}
              />
            ))}
            <span className="text-[10px] text-muted-foreground">{t('usage.more')}</span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

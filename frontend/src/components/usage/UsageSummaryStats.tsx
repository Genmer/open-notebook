'use client'

import { TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { UsageSummaryResponse } from '@/lib/types/api'
import { formatCompact, todayLocal } from './chart-shared'
import { cn } from '@/lib/utils'

interface UsageSummaryStatsProps {
  summary: UsageSummaryResponse
  locale: string
  isPlaceholder?: boolean
}

export default function UsageSummaryStats({
  summary,
  locale,
  isPlaceholder = false,
}: UsageSummaryStatsProps) {
  const { t } = useTranslation()
  const totals = summary.totals
  const previousTotal = summary.previous_totals?.total_tokens

  const todayTokens =
    summary.by_day.find((row) => row.day === todayLocal())?.total_tokens ?? 0

  // Token volume has no good/bad semantics — the badge stays neutral (no
  // red/green), it only signals direction.
  const changePct =
    previousTotal === undefined || previousTotal === 0
      ? null
      : Math.round(((totals.total_tokens - previousTotal) / previousTotal) * 1000) / 10
  const changeUp = (changePct ?? 0) >= 0

  const estimated = totals.estimated_tokens ?? 0

  const secondaryStats: Array<{ key: string; value: string }> = [
    { key: 'usage.today', value: formatCompact(todayTokens, locale) },
    { key: 'usage.totalCalls', value: (totals.calls ?? 0).toLocaleString(locale) },
    { key: 'usage.inputTokens', value: formatCompact(totals.input_tokens ?? 0, locale) },
    { key: 'usage.outputTokens', value: formatCompact(totals.output_tokens ?? 0, locale) },
  ]

  return (
    <Card>
      <CardContent
        className={cn('grid gap-6 py-5 sm:grid-cols-2 lg:grid-cols-6', 'transition-opacity')}
        aria-busy={isPlaceholder || undefined}
        data-placeholder={isPlaceholder || undefined}
      >
        <div className={cn('lg:col-span-2', isPlaceholder && 'opacity-60')}>
          <p className="text-xs text-muted-foreground">{t('usage.totalTokens')}</p>
          <p
            className="mt-1 font-display text-4xl font-bold tracking-tight tabular-nums"
            title={(totals.total_tokens ?? 0).toLocaleString(locale)}
            aria-label={(totals.total_tokens ?? 0).toLocaleString(locale)}
          >
            {formatCompact(totals.total_tokens ?? 0, locale)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {changePct === null ? (
              <span className="text-xs text-muted-foreground">{t('usage.noPrevPeriod')}</span>
            ) : (
              <>
                <Badge variant="outline" className="gap-1 tabular-nums">
                  {changeUp ? (
                    <TrendingUp className="h-3 w-3" aria-hidden />
                  ) : (
                    <TrendingDown className="h-3 w-3" aria-hidden />
                  )}
                  {changeUp ? '+' : ''}
                  {changePct.toLocaleString(locale)}%
                </Badge>
                <span className="text-xs text-muted-foreground">{t('usage.vsPrevPeriod')}</span>
              </>
            )}
          </div>
          {estimated > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('usage.estimatedNote', { tokens: formatCompact(estimated, locale) })}
            </p>
          )}
        </div>
        {secondaryStats.map((stat) => (
          <div key={stat.key} className="group">
            <p className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              {t(stat.key)}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{stat.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

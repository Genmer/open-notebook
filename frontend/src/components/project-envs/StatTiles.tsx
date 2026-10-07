'use client'

import { TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { StatItem } from '@/lib/utils/env-structure'

export interface StatTilesProps {
  items: StatItem[]
}

// 趋势方向只由图标形状承载，箭头颜色恒 fern（方向≠好坏，UsageSummaryStats 先例）。
export function StatTiles({ items }: StatTilesProps) {
  const { t } = useTranslation()
  if (items.length < 2) return null
  return (
    <section data-testid="env-detail-metrics">
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">
        {t('projectEnvs.detailMetrics')}
      </h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item, i) => (
          <div
            key={`${item.value}-${i}`}
            data-testid={item.trendFrom ? 'env-detail-metric-trend' : 'env-detail-metric-card'}
            // label 有前10后6截断，完整语境挂 title（趋势卡带完整 from→to）
            title={
              item.trendFrom
                ? `${item.trendFrom} → ${item.value} ${item.label}`
                : item.label
            }
            className="rounded-lg border bg-card p-2.5"
          >
            {item.trendFrom ? (
              <span
                role="img"
                aria-label={t('projectEnvs.detailMetricTrendAria', {
                  from: item.trendFrom,
                  to: item.value,
                })}
                className="flex items-center gap-1 font-mono text-lg font-semibold leading-none tabular-nums"
              >
                {item.direction === 'down' ? (
                  <TrendingDown className="size-3.5 shrink-0 text-fern" aria-hidden />
                ) : (
                  <TrendingUp className="size-3.5 shrink-0 text-fern" aria-hidden />
                )}
                {item.trendFrom}
                <span className="text-xs text-muted-foreground" aria-hidden>
                  →
                </span>
                {item.value}
              </span>
            ) : (
              <p className="font-mono text-lg font-semibold leading-none tabular-nums">
                {item.value}
                {item.unit}
              </p>
            )}
            <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

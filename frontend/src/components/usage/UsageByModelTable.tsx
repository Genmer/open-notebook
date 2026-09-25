'use client'

import { useMemo } from 'react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { UsageByModel } from '@/lib/types/api'
import { assignModelColors } from './chart-shared'

interface UsageByModelTableProps {
  byModel: UsageByModel[]
  locale: string
}

// Rows use the shared table conventions (h-12 px-4, hover surface, tabular
// numbers right-aligned); the inline share bar turns the token-sorted table
// into a lightweight model ranking.
export default function UsageByModelTable({ byModel, locale }: UsageByModelTableProps) {
  const { t } = useTranslation()

  const colors = useMemo(
    () => assignModelColors(byModel.map((row) => row.model_name ?? '-')),
    [byModel]
  )
  const maxTokens = useMemo(
    () => byModel.reduce((max, row) => Math.max(max, row.total_tokens ?? 0), 0),
    [byModel]
  )

  if (byModel.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('usage.empty')}</p>
  }

  const fmt = (value?: number | null) => (value ?? 0).toLocaleString(locale)

  return (
    <div className="overflow-x-auto">
      <table className="w-full caption-bottom text-sm">
        <thead>
          <tr className="border-b">
            <th scope="col" className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('usage.model')}
            </th>
            <th scope="col" className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('usage.provider')}
            </th>
            <th scope="col" className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('usage.calls')}
            </th>
            <th scope="col" className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('usage.inputTokens')}
            </th>
            <th scope="col" className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('usage.outputTokens')}
            </th>
            <th scope="col" className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('usage.totalTokens')}
            </th>
          </tr>
        </thead>
        <tbody>
          {byModel.map((row, index) => {
            const name = row.model_name ?? '-'
            const share = maxTokens > 0 ? ((row.total_tokens ?? 0) / maxTokens) * 100 : 0
            return (
              <tr
                key={`${row.provider ?? '-'}:${row.model_name ?? '-'}:${index}`}
                className="h-12 border-b px-4 align-middle transition-colors last:border-b-0 hover:bg-[var(--surface-raised)]"
              >
                <td className="h-12 px-4 align-middle">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate" title={name}>
                      {name}
                    </span>
                    {(row.estimated_tokens ?? 0) > 0 && (
                      <span className="text-muted-foreground" title={t('usage.estimatedHint')}>
                        ≈
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 w-full max-w-[16rem] rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${share}%`,
                        backgroundColor: colors.get(name),
                      }}
                    />
                  </div>
                </td>
                <td className="h-12 px-4 align-middle">{row.provider ?? '-'}</td>
                <td className="h-12 px-4 text-right align-middle tabular-nums">{fmt(row.calls)}</td>
                <td className="h-12 px-4 text-right align-middle tabular-nums">{fmt(row.input_tokens)}</td>
                <td className="h-12 px-4 text-right align-middle tabular-nums">{fmt(row.output_tokens)}</td>
                <td className="h-12 px-4 text-right align-middle tabular-nums font-medium">
                  {fmt(row.total_tokens)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

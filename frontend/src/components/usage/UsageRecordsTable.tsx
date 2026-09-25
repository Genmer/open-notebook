'use client'

import { AlertCircle } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { UsageRecord } from '@/lib/types/api'

interface UsageRecordsTableProps {
  records: UsageRecord[]
  total: number
  language: string
  onLoadMore?: () => void
  isLoadingMore?: boolean
}

export default function UsageRecordsTable({
  records,
  total,
  language,
  onLoadMore,
  isLoadingMore = false,
}: UsageRecordsTableProps) {
  const { t } = useTranslation()
  const canLoadMore = Boolean(onLoadMore) && records.length < total

  const fmtToken = (value?: number | null) =>
    value === null || value === undefined ? '-' : value.toLocaleString(language)

  return (
    <div>
      {records.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('usage.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b">
                <th scope="col" className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t('usage.created')}
                </th>
                <th scope="col" className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t('usage.callType')}
                </th>
                <th scope="col" className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t('usage.model')}
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
                <th scope="col" className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t('usage.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((row, index) => (
                <tr
                  key={row.id ?? `${row.created}:${row.call_type}:${index}`}
                  className="h-12 border-b px-4 align-middle transition-colors last:border-b-0 hover:bg-[var(--surface-raised)]"
                >
                  <td className="h-12 whitespace-nowrap px-4 align-middle">
                    {row.created ? new Date(row.created).toLocaleString(language) : '-'}
                  </td>
                  <td className="h-12 px-4 align-middle">{row.call_type ?? '-'}</td>
                  <td className="h-12 px-4 align-middle">
                    <span className="inline-flex items-center gap-1">
                      <span className="truncate" title={row.model_name ?? undefined}>
                        {row.model_name ?? '-'}
                      </span>
                      {row.is_estimated && (
                        <span className="text-muted-foreground" title={t('usage.estimatedHint')}>
                          ≈
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="h-12 px-4 text-right align-middle tabular-nums">{fmtToken(row.input_tokens)}</td>
                  <td className="h-12 px-4 text-right align-middle tabular-nums">{fmtToken(row.output_tokens)}</td>
                  <td className="h-12 px-4 text-right align-middle tabular-nums">{fmtToken(row.total_tokens)}</td>
                  <td className="h-12 px-4 align-middle">
                    {row.success ? (
                      <Badge variant="default">{t('usage.success')}</Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1" title={row.error ?? undefined}>
                        <AlertCircle className="h-3 w-3" aria-hidden />
                        {t('usage.failure')}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canLoadMore && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t('usage.recordsShown', { shown: records.length, total })}
          </span>
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore && <LoadingSpinner size="sm" className="mr-2" />}
            {t('usage.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}

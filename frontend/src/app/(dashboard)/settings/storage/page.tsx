'use client'

import { useMemo } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Database,
  FileArchive,
  Files,
  HardDrive,
  RefreshCw,
} from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useStorageSummary } from '@/lib/hooks/use-storage'
import { formatBytes } from '@/lib/utils/format'
import { cn } from '@/lib/utils'
import StorageDiskDonut from '@/components/storage/StorageDiskDonut'

// Literal i18n keys: the unused-key test greps source for these strings.
const CATEGORY_KEYS: Record<string, string> = {
  sources: 'storage.categories.sources',
  insights: 'storage.categories.insights',
  notes: 'storage.categories.notes',
  embeddings: 'storage.categories.embeddings',
}

/** Minimal placeholder block; the app has no shared Skeleton component. */
function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export default function StoragePage() {
  const { t } = useTranslation()
  const { data, isLoading, isError, refetch, isRefetching } = useStorageSummary()

  const formatSize = useMemo(() => (bytes: number) => formatBytes(bytes), [])

  const statCards = useMemo(() => {
    if (!data) return []
    const recordCount =
      data.database.sources.count +
      data.database.insights.count +
      data.database.notes.count
    const lastRealExport = data.export_estimate.basis === 'last_package'
    return [
      {
        key: 'database',
        icon: Database,
        label: t('storage.stats.database'),
        value: formatBytes(data.totals.database_bytes),
        hint: t('storage.stats.databaseHint'),
      },
      {
        key: 'disk',
        icon: HardDrive,
        label: t('storage.stats.disk'),
        value: formatBytes(data.totals.disk_bytes),
        hint: t('storage.stats.diskHint'),
      },
      {
        key: 'export',
        icon: FileArchive,
        label: t('storage.stats.export'),
        value: formatBytes(data.export_estimate.estimated_bytes),
        hint: lastRealExport
          ? t('storage.stats.exportHintLast')
          : t('storage.stats.exportHintEstimate'),
      },
      {
        key: 'records',
        icon: Files,
        label: t('storage.stats.records'),
        value: recordCount.toLocaleString(),
        hint: t('storage.stats.recordsHint', {
          vectors: data.database.embeddings.count,
          dimensions: data.database.embeddings.dimensions,
        }),
      },
    ]
  }, [data, t])

  const categories = useMemo(() => {
    if (!data) return []
    const db = data.database
    const total = Math.max(1, db.estimated_bytes)
    return [
      { key: 'sources', ...db.sources },
      { key: 'insights', ...db.insights },
      { key: 'notes', ...db.notes },
      { key: 'embeddings', ...db.embeddings },
    ].map((entry) => ({
      ...entry,
      pct: Math.round((entry.estimated_bytes / total) * 1000) / 10,
    }))
  }, [data])

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
                {t('storage.title')}
              </h1>
              <p className="text-muted-foreground mt-1">{t('storage.description')}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefetching && 'animate-spin')} />
              {t('storage.refresh')}
            </Button>
          </div>

          {isError ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t('storage.loadFailed')}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {isLoading || statCards.length === 0
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <Card key={i}>
                        <CardContent className="space-y-2 pt-6">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-8 w-28" />
                          <Skeleton className="h-3 w-36" />
                        </CardContent>
                      </Card>
                    ))
                  : statCards.map((card) => (
                      <Card key={card.key}>
                        <CardContent className="pt-6">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <card.icon className="h-4 w-4" aria-hidden="true" />
                            {card.label}
                          </div>
                          <p className="mt-2 font-display text-2xl font-bold tabular-nums">
                            {card.value}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
                        </CardContent>
                      </Card>
                    ))}
              </div>

              {/* Breakdown + disk donut */}
              <div className="grid gap-4 lg:grid-cols-3 2xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
                <Card className="lg:col-span-2 2xl:col-span-1">
                  <CardHeader>
                    <CardTitle>{t('storage.breakdown.title')}</CardTitle>
                    <CardDescription>{t('storage.breakdown.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isLoading || !data ? (
                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : (
                      <ul className="space-y-4">
                        {categories.map((entry) => (
                          <li key={entry.key}>
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                              <span className="font-medium">
                                {t(CATEGORY_KEYS[entry.key] ?? entry.key)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t('storage.recordCount', { count: entry.count })}
                              </span>
                              <span className="ml-auto font-mono text-xs tabular-nums">
                                {formatBytes(entry.estimated_bytes)}
                              </span>
                              <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                                {entry.pct}%
                              </span>
                            </div>
                            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-teal transition-all"
                                style={{ width: `${Math.min(100, entry.pct)}%` }}
                                role="presentation"
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-4 text-xs text-muted-foreground">
                      {t('storage.breakdown.estimateNote')}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('storage.disk.title')}</CardTitle>
                    <CardDescription>{t('storage.disk.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isLoading || !data ? (
                      <Skeleton className="h-52 w-52" />
                    ) : (
                      <StorageDiskDonut
                        sections={data.disk.sections}
                        root={data.disk.root}
                        formatSize={formatSize}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Download, Gauge, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useSettings, useUpdateSettings } from '@/lib/hooks/use-settings'
import { useClearUsage, useUsageRecords, useUsageSummary } from '@/lib/hooks/use-usage'
import UsageTrendChart from '@/components/usage/UsageTrendChart'
import UsageModelDonut from '@/components/usage/UsageModelDonut'
import UsageHeatmap from '@/components/usage/UsageHeatmap'
import UsageToolbar from '@/components/usage/UsageToolbar'
import UsageSummaryStats from '@/components/usage/UsageSummaryStats'
import UsageByModelTable from '@/components/usage/UsageByModelTable'
import UsageRecordsTable from '@/components/usage/UsageRecordsTable'
import UsageSkeleton from '@/components/usage/UsageSkeleton'
import UsageErrorState from '@/components/usage/UsageErrorState'
import {
  buildUsageCsv,
  buildUsageJson,
  downloadUsageFile,
  usageExportFilename,
} from '@/components/usage/export-usage'
import { HEATMAP_DAYS, localTzOffsetMinutes } from '@/components/usage/chart-shared'
import { cn } from '@/lib/utils'

const RECORDS_LIMIT_STEP = 100
const RECORDS_LIMIT_MAX = 500

export default function UsagePage() {
  const { t, language } = useTranslation()
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const [days, setDays] = useState(30)
  const [callType, setCallType] = useState('')
  const [recordsLimit, setRecordsLimit] = useState(RECORDS_LIMIT_STEP)
  const [clearOpen, setClearOpen] = useState(false)

  // Only feeds the queries, never markup — no hydration mismatch risk from
  // server/client timezone differences.
  const tzOffset = useMemo(() => localTzOffsetMinutes(), [])

  const summaryQuery = useUsageSummary(days, callType, tzOffset)
  // The heatmap spans half a year regardless of the selected range, but keeps
  // the same call-type filter; its loading must not gate the page.
  const heatmapQuery = useUsageSummary(HEATMAP_DAYS, callType, tzOffset)
  const recordsQuery = useUsageRecords(recordsLimit, 0, callType)
  const clearUsage = useClearUsage()

  const summary = summaryQuery.data
  const records = recordsQuery.data
  const isPlaceholder = summaryQuery.isPlaceholderData

  // Gate the whole page on first load only; range/filter switches keep the
  // previous data on screen via keepPreviousData (dimmed + aria-busy).
  const isLoading =
    settingsLoading ||
    (summaryQuery.isLoading && !summary) ||
    (recordsQuery.isLoading && !records)

  const isEmpty =
    Boolean(summary) && (summary?.totals.calls ?? 0) === 0 && (summary?.by_model.length ?? 0) === 0
  // A type filter or half-year heatmap data means records exist somewhere —
  // keep the toolbar reachable instead of showing the full-page empty guide.
  const heatmapHasData = (heatmapQuery.data?.totals.calls ?? 0) > 0
  const isFilteredEmpty = isEmpty && (callType !== '' || heatmapHasData)

  const resetFilters = () => {
    setDays(30)
    setCallType('')
    setRecordsLimit(RECORDS_LIMIT_STEP)
  }

  const handleExport = (format: 'csv' | 'json') => {
    if (!summary) return
    const input = { summary, days, callType }
    if (format === 'csv') {
      downloadUsageFile(buildUsageCsv(input), usageExportFilename('csv'), 'text/csv;charset=utf-8')
    } else {
      downloadUsageFile(
        buildUsageJson(input),
        usageExportFilename('json'),
        'application/json;charset=utf-8'
      )
    }
  }

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
          <Gauge className="h-5 w-5 text-muted-foreground" />
          {t('usage.title')}
        </h1>
        <p className="text-muted-foreground mt-1">{t('usage.description')}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={!summary || isEmpty}>
            <Download className="mr-2 h-4 w-4" />
            {t('usage.exportButton')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport('csv')}>
            {t('usage.exportCsv')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('json')}>
            {t('usage.exportJson')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const privacyCard = (
    <Card>
      <CardHeader>
        <CardTitle>{t('usage.privacyTitle')}</CardTitle>
        <CardDescription>{t('usage.privacyDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="usage_tracking_enabled"
            checked={settings?.usage_tracking_enabled ?? true}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ usage_tracking_enabled: checked === true })
            }
            disabled={updateSettings.isPending}
          />
          <Label htmlFor="usage_tracking_enabled">{t('usage.trackingEnabled')}</Label>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setClearOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('usage.clear')}
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {header}

          {isLoading ? (
            <UsageSkeleton />
          ) : summaryQuery.isError || recordsQuery.isError ? (
            <UsageErrorState
              onRetry={() => {
                summaryQuery.refetch()
                recordsQuery.refetch()
              }}
            />
          ) : isFilteredEmpty ? (
            <>
              <UsageToolbar
                days={days}
                onDaysChange={setDays}
                callType={callType}
                onCallTypeChange={(value) => {
                  setCallType(value)
                  setRecordsLimit(RECORDS_LIMIT_STEP)
                }}
              />
              <Card>
                <CardContent>
                  <EmptyState
                    icon={Gauge}
                    title={t('usage.filteredEmptyTitle')}
                    description={t('usage.filteredEmptyDesc')}
                    action={
                      <Button variant="outline" size="sm" onClick={resetFilters}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {t('usage.resetFilters')}
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('usage.heatmapTitle')}</CardTitle>
                  <CardDescription>{t('usage.heatmapDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <UsageHeatmap
                    byDay={heatmapQuery.data?.by_day ?? []}
                    locale={language}
                    isLoading={heatmapQuery.isLoading && !heatmapQuery.data}
                  />
                </CardContent>
              </Card>
              {privacyCard}
            </>
          ) : isEmpty ? (
            <>
              <EmptyState
                icon={Gauge}
                title={t('usage.emptyTitle')}
                description={t('usage.emptyDesc')}
              />
              {privacyCard}
            </>
          ) : (
            <>
              <UsageToolbar
                days={days}
                onDaysChange={setDays}
                callType={callType}
                onCallTypeChange={(value) => {
                  setCallType(value)
                  setRecordsLimit(RECORDS_LIMIT_STEP)
                }}
              />

              {summary && (
                <UsageSummaryStats summary={summary} locale={language} isPlaceholder={isPlaceholder} />
              )}

              <div
                className={cn(
                  'grid gap-6 transition-opacity lg:grid-cols-3',
                  isPlaceholder && 'opacity-60'
                )}
                aria-busy={isPlaceholder || undefined}
              >
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>{t('usage.trend')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <UsageTrendChart
                      days={days}
                      dailyByModel={summary?.daily_by_model ?? []}
                      byModel={summary?.by_model ?? []}
                      locale={language}
                      isPlaceholder={isPlaceholder}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('usage.modelShare')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <UsageModelDonut byModel={summary?.by_model ?? []} locale={language} />
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t('usage.heatmapTitle')}</CardTitle>
                  <CardDescription>{t('usage.heatmapDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <UsageHeatmap
                    byDay={heatmapQuery.data?.by_day ?? []}
                    locale={language}
                    isLoading={heatmapQuery.isLoading && !heatmapQuery.data}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <Tabs defaultValue="by-model">
                    <TabsList>
                      <TabsTrigger value="by-model" className="flex-none whitespace-nowrap">
                        {t('usage.byModel')}
                      </TabsTrigger>
                      <TabsTrigger value="records" className="flex-none whitespace-nowrap">
                        {t('usage.records')}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="by-model">
                      <UsageByModelTable byModel={summary?.by_model ?? []} locale={language} />
                    </TabsContent>
                    <TabsContent value="records">
                      <p className="mb-3 text-xs text-muted-foreground">
                        {t('usage.recordsDesc', { count: records?.total ?? 0 })}
                      </p>
                      <UsageRecordsTable
                        records={records?.records ?? []}
                        total={records?.total ?? 0}
                        language={language}
                        isLoadingMore={recordsQuery.isFetching}
                        onLoadMore={
                          recordsLimit < RECORDS_LIMIT_MAX
                            ? () =>
                                setRecordsLimit((limit) =>
                                  Math.min(limit + RECORDS_LIMIT_STEP, RECORDS_LIMIT_MAX)
                                )
                            : undefined
                        }
                      />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {privacyCard}
            </>
          )}

          <ConfirmDialog
            open={clearOpen}
            onOpenChange={setClearOpen}
            title={t('usage.clearConfirmTitle')}
            description={t('usage.clearConfirmDesc')}
            confirmText={t('usage.clear')}
            confirmVariant="destructive"
            onConfirm={() => clearUsage.mutate()}
            isLoading={clearUsage.isPending}
          />
        </div>
      </div>
    </AppShell>
  )
}

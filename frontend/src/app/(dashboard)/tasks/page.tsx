'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  CircleDashed,
  Database,
  FileAudio,
  FileText,
  HelpCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import {
  ACTIVE_TASK_STATUSES,
  tasksApi,
  type TaskEntry,
  type TaskRetryResponse,
} from '@/lib/api/tasks'
import { TaskExplainCard } from '@/components/tasks/TaskExplainCard'
import { TaskLiveInspector } from '@/components/tasks/TaskLiveInspector'
import { useTasks } from '@/lib/hooks/use-tasks'

// Literal i18n keys: the unused-key test greps source for these strings.
const COMMAND_KEYS: Record<string, string> = {
  run_transformation: 'tasks.command.run_transformation',
  create_insight: 'tasks.command.create_insight',
  embed_source: 'tasks.command.embed_source',
  embed_note: 'tasks.command.embed_note',
  embed_insight: 'tasks.command.embed_insight',
  rebuild_embeddings: 'tasks.command.rebuild_embeddings',
  process_source: 'tasks.command.process_source',
  import_data: 'tasks.command.import_data',
  export_data: 'tasks.command.export_data',
  generate_podcast: 'tasks.command.generate_podcast',
  generate_artifact: 'tasks.command.generate_artifact',
}

const STATUS_KEYS: Record<string, string> = {
  new: 'tasks.status.new',
  queued: 'tasks.status.queued',
  running: 'tasks.status.running',
  completed: 'tasks.status.completed',
  failed: 'tasks.status.failed',
  canceled: 'tasks.status.canceled',
}

const TYPE_ICONS: Record<string, typeof Sparkles> = {
  insight: Sparkles,
  embedding: Database,
  processing: FileText,
  data_transfer: ArrowDownToLine,
  podcast: FileAudio,
  other: CircleDashed,
}

const ACTIVE_FILTER = 'active'

export default function TasksPage() {
  const { t, language } = useTranslation()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<string>('all')
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set())
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [liveInspectorTask, setLiveInspectorTask] = useState<TaskEntry | null>(null)
  // Filtering runs server-side so tab badges and list lengths can't drift
  // apart when a status has more rows than one page can hold.
  const statusParam =
    filter === 'all'
      ? undefined
      : filter === ACTIVE_FILTER
        ? [...ACTIVE_TASK_STATUSES].join(',')
        : filter
  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTasks(statusParam, 100)

  const handleCancel = async (id: string) => {
    setCancellingIds((prev) => new Set(prev).add(id))
    try {
      await tasksApi.cancel(id)
      toast.success(t('tasks.cancelSuccess'))
    } catch {
      toast.error(t('tasks.cancelFailed'))
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      void refetch()
    }
  }

  // Returns the retry outcome so the explain card can refresh itself on
  // skipped_recovered; undefined means the request failed.
  const handleRetry = async (
    task: TaskEntry,
    opts?: { checkRecovery?: boolean },
  ): Promise<TaskRetryResponse | undefined> => {
    setRetryingIds((prev) => new Set(prev).add(task.id))
    try {
      const result = await tasksApi.retry(task.id, opts)
      // skipped_recovered = the AI pre-check found the item healthy now;
      // nothing was replayed, so this is not a resubmission.
      if (result.status === 'skipped_recovered') {
        toast.info(t('tasks.explain.retrySkippedRecovered'))
      } else {
        toast.success(t('tasks.retrySuccess'))
      }
      return result
    } catch {
      toast.error(t('tasks.retryFailed'))
      return undefined
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    }
  }

  // Offset paging can overlap during polls (new rows shift page boundaries);
  // first occurrence wins since pages arrive newest-first.
  const tasks =
    data?.pages.flatMap((page) => page.tasks).filter(
      (task, index, all) => all.findIndex((t) => t.id === task.id) === index
    ) ?? []
  const counts = data?.pages[0]?.counts
  const total = data?.pages[0]?.total ?? 0
  const activeCount = counts?.active ?? 0
  const allCount = useMemo(
    () =>
      Object.entries(counts ?? {})
        .filter(([status]) => status !== 'active')
        .reduce((sum, [, n]) => sum + n, 0),
    [counts]
  )

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {t('tasks.title')}
              </h1>
              <p className="text-muted-foreground mt-1">{t('tasks.description')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefetching && 'animate-spin')} />
              {t('tasks.refresh')}
            </Button>
          </div>

          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList>
              <TabsTrigger value="all" className="min-w-max gap-1.5 whitespace-nowrap">
                {t('tasks.filter.all')}
                {allCount > 0 && (
                  <Badge variant="secondary" className="shrink-0">
                    {allCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value={ACTIVE_FILTER} className="min-w-max gap-1.5 whitespace-nowrap">
                {t('tasks.filter.active')}
                {activeCount > 0 && (
                  <Badge variant="secondary" className="shrink-0">
                    {activeCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed" className="min-w-max gap-1.5 whitespace-nowrap">
                {t('tasks.filter.completed')}
                {!!counts?.completed && (
                  <Badge variant="secondary" className="shrink-0">
                    {counts.completed}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="failed" className="min-w-max gap-1.5 whitespace-nowrap">
                {t('tasks.filter.failed')}
                {!!counts?.failed && (
                  <Badge variant="destructive" className="shrink-0">
                    {counts.failed}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {isError ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t('tasks.loadFailed')}
              </CardContent>
            </Card>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {t('tasks.empty')}
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  dateLocale={language}
                  onCancel={handleCancel}
                  cancelling={cancellingIds.has(task.id)}
                  onRetry={handleRetry}
                  retrying={retryingIds.has(task.id)}
                  onOpenLiveInspector={setLiveInspectorTask}
                />
              ))}
            </ul>
          )}

          {tasks.length < total && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                {t('tasks.shownOfTotal', { shown: tasks.length, total })}
              </p>
              {hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t('tasks.loadMore')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <TaskLiveInspector
        open={!!liveInspectorTask}
        onOpenChange={(open) => !open && setLiveInspectorTask(null)}
        task={liveInspectorTask}
        onCancel={handleCancel}
        cancelling={liveInspectorTask ? cancellingIds.has(liveInspectorTask.id) : false}
      />
    </AppShell>
  )
}

function TaskRow({
  task,
  dateLocale,
  onCancel,
  cancelling,
  onRetry,
  retrying,
  onOpenLiveInspector,
}: {
  task: TaskEntry
  dateLocale: string
  onCancel?: (id: string) => void
  cancelling?: boolean
  onRetry?: (
    task: TaskEntry,
    opts?: { checkRecovery?: boolean },
  ) => Promise<TaskRetryResponse | undefined>
  retrying?: boolean
  onOpenLiveInspector?: (task: TaskEntry) => void
}) {
  const { t } = useTranslation()
  const [explainOpen, setExplainOpen] = useState(false)
  const Icon = TYPE_ICONS[task.type] ?? CircleDashed
  const commandKey = COMMAND_KEYS[task.name]
  const commandLabel = commandKey ? t(commandKey) : task.name

  const timestamp = task.updated ?? task.created
  const relative = timestamp
    ? formatDistanceToNow(new Date(timestamp), {
        addSuffix: true,
        locale: getDateLocale(dateLocale),
      })
    : null

  const failed = task.status === 'failed'

  return (
    <Card className="py-0">
      <CardContent className="flex gap-3 px-4 py-3">
        <div className="flex shrink-0 items-start gap-2 pt-0.5">
          <span>{statusIcon(task.status, t('tasks.statusRunning'))}</span>
          <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {commandLabel}
              {task.target && (
                <span
                  className="ml-1.5 font-normal text-muted-foreground"
                  title={task.target}
                >
                  · {task.target}
                </span>
              )}
            </span>
            <Badge
              variant={failed ? 'destructive' : 'secondary'}
              className={cn(
                'shrink-0',
                task.status === 'running' && 'bg-teal-tint text-teal'
              )}
            >
              {t(STATUS_KEYS[task.status] ?? 'tasks.status.canceled', {
                defaultValue: task.status,
              })}
            </Badge>
            {task.status === 'running' && (
              <Badge
                variant="outline"
                className="shrink-0 border-teal/40 bg-teal/10 text-teal animate-pulse text-[11px] font-normal"
              >
                {task.progress?.stage || (task.progress?.kind === 'embedding' ? '向量化' : '运行中')}
              </Badge>
            )}
            {onOpenLiveInspector && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 shrink-0 gap-1.5 px-2.5 font-medium',
                  task.status === 'running'
                    ? 'text-teal hover:text-teal hover:bg-teal-tint/40'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => onOpenLiveInspector(task)}
                title={
                  task.status === 'running'
                    ? t('tasks.viewLiveProgress', { defaultValue: '查看实时进展' })
                    : '查看执行详情'
                }
                aria-label={
                  task.status === 'running'
                    ? t('tasks.viewLiveProgress', { defaultValue: '查看实时进展' })
                    : '查看执行详情'
                }
              >
                <Terminal
                  className={cn(
                    'h-3.5 w-3.5',
                    task.status === 'running' && 'animate-pulse'
                  )}
                  aria-hidden="true"
                />
                <span>
                  {task.status === 'running'
                    ? t('tasks.viewLiveProgress', { defaultValue: '查看实时进展' })
                    : '执行详情'}
                </span>
              </Button>
            )}
            {failed && task.retryable && onRetry && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
                  onClick={() => void onRetry(task)}
                  disabled={retrying}
                  title={t('tasks.explain.manualRetry')}
                  aria-label={t('tasks.explain.manualRetry')}
                >
                  <RefreshCw
                    className={retrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                    aria-hidden="true"
                  />
                  {t('tasks.explain.manualRetry')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 px-2.5 text-teal hover:text-teal"
                  onClick={() => void onRetry(task, { checkRecovery: true })}
                  disabled={retrying}
                  title={t('tasks.explain.aiRetry')}
                  aria-label={t('tasks.explain.aiRetry')}
                >
                  <Sparkles
                    className={retrying ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'}
                    aria-hidden="true"
                  />
                  {t('tasks.explain.aiRetry')}
                </Button>
              </>
            )}
            {failed && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setExplainOpen((open) => !open)}
                aria-expanded={explainOpen}
                title={t('tasks.explain.whyFailed')}
                aria-label={t('tasks.explain.whyFailed')}
              >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
                {t('tasks.explain.whyFailed')}
              </Button>
            )}
            {onCancel && ACTIVE_TASK_STATUSES.has(task.status) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onCancel(task.id)}
                disabled={cancelling}
                title={t('tasks.cancel')}
                aria-label={t('tasks.cancel')}
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">{relative ?? '—'}</span>
            {task.status === 'running' && task.progress && (
              <ProgressInline progress={task.progress} />
            )}
          </div>
          {task.status === 'running' && (
            <div className="pt-1.5 space-y-1">
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  role="progressbar"
                  aria-label={t('tasks.statusRunning', { defaultValue: 'Running' })}
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-500 animate-pulse transition-all duration-300"
                  style={{
                    width:
                      typeof task.progress?.percent === 'number'
                        ? `${task.progress.percent}%`
                        : task.progress?.total_chunks && task.progress?.embedded_chunks
                          ? `${Math.min(100, Math.round((task.progress.embedded_chunks / task.progress.total_chunks) * 100))}%`
                          : '65%',
                  }}
                />
              </div>
            </div>
          )}
          {failed && task.error_message && (
            <p className="whitespace-pre-wrap break-words rounded-md bg-destructive/5 px-2.5 py-1.5 font-mono text-xs text-destructive">
              {task.error_message}
            </p>
          )}
          {failed && explainOpen && onRetry && (
            <TaskExplainCard task={task} onRetry={onRetry} retrying={retrying} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function statusIcon(status: string, runningLabel: string) {
  if (status === 'completed')
    return <CheckCircle2 className="h-5 w-5 text-sage" aria-hidden="true" />
  if (status === 'failed' || status === 'canceled')
    return <XCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
  if (status === 'running' || status === 'queued' || status === 'new')
    return (
      <Loader2
        className="h-5 w-5 animate-spin text-teal"
        role="img"
        aria-label={runningLabel}
      />
    )
  return <CircleDashed className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
}

function ProgressInline({ progress }: { progress: NonNullable<TaskEntry['progress']> }) {
  const { t } = useTranslation()
  if (progress.kind === 'embedding' && progress.total_chunks) {
    return (
      <span className="font-mono tabular-nums">
        {t('tasks.progressChunks', {
          embedded: progress.embedded_chunks ?? 0,
          total: progress.total_chunks,
        })}
      </span>
    )
  }
  if (progress.kind === 'data_transfer' && progress.stage) {
    return (
      <span>
        {progress.stage}
        {typeof progress.percent === 'number' ? ` · ${progress.percent}%` : ''}
      </span>
    )
  }
  return null
}

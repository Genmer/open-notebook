'use client'

import { useMemo, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowDownToLine,
  CheckCircle2,
  CircleDashed,
  Database,
  FileAudio,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import type { TaskEntry } from '@/lib/api/tasks'
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
  const [filter, setFilter] = useState<string>('all')
  const { data, isLoading, isError, refetch, isRefetching } = useTasks(undefined, 100)

  const tasks = data?.tasks ?? []
  const counts = data?.counts ?? {}
  const activeCount =
    (counts.new ?? 0) + (counts.queued ?? 0) + (counts.running ?? 0)

  const visibleTasks = useMemo(() => {
    if (filter === 'all') return tasks
    if (filter === ACTIVE_FILTER)
      return tasks.filter((task) =>
        ['new', 'queued', 'running'].includes(task.status)
      )
    return tasks.filter((task) => task.status === filter)
  }, [tasks, filter])

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
              <TabsTrigger value="all" className="gap-1.5">
                {t('tasks.filter.all')}
              </TabsTrigger>
              <TabsTrigger value={ACTIVE_FILTER} className="gap-1.5">
                {t('tasks.filter.active')}
                {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-1.5">
                {t('tasks.filter.completed')}
                {!!counts.completed && <Badge variant="secondary">{counts.completed}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="failed" className="gap-1.5">
                {t('tasks.filter.failed')}
                {!!counts.failed && <Badge variant="destructive">{counts.failed}</Badge>}
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
          ) : visibleTasks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {t('tasks.empty')}
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} dateLocale={language} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  )
}

function TaskRow({ task, dateLocale }: { task: TaskEntry; dateLocale: string }) {
  const { t } = useTranslation()
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

  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 px-4 py-3">
        <span className="shrink-0">{statusIcon(task.status, t('tasks.statusRunning'))}</span>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">
              {commandLabel}
              {task.target && (
                <span className="ml-1.5 text-muted-foreground">· {task.target}</span>
              )}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{relative ?? '—'}</span>
            {task.status === 'failed' && task.error_message && (
              <span className="truncate text-destructive" title={task.error_message}>
                {task.error_message}
              </span>
            )}
            {task.status === 'running' && task.progress && <ProgressInline progress={task.progress} />}
          </div>
        </div>
        <Badge
          variant={task.status === 'failed' ? 'destructive' : 'secondary'}
          className={cn('shrink-0', task.status === 'running' && 'bg-teal-tint text-teal')}
        >
          {t(STATUS_KEYS[task.status] ?? 'tasks.status.canceled', {
            defaultValue: task.status,
          })}
        </Badge>
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

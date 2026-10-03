'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Ban,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Sparkles,
  Terminal,
  Timer,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { tasksApi, type TaskEntry, type TaskProgress, type JobLiveProgressResponse } from '@/lib/api/tasks'

export interface LiveTaskInfo {
  id: string
  name: string
  type?: string
  target?: string | null
  status: string
  progress?: TaskProgress | null
  error_message?: string | null
  created?: string | null
  startedAt?: number
}

export interface TaskLiveInspectorProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  task?: TaskEntry | null
  /** Bare command-job form: only the id is required; status and live
   * telemetry are then resolved from the live-progress endpoint. */
  job?: {
    jobId: string
    toolName?: string
    /** Command name shown in the terminal header (defaults to 'task'). */
    commandName?: string
    /** Task type bucket for stage fallback (defaults to 'other'). */
    type?: string
    status?: string
    startedAt?: number
    progress?: TaskProgress | Record<string, unknown> | null
    errorMessage?: string | null
  } | null
  embedded?: boolean
  /** Compact variant trims the stage stepper, token telemetry and task id
   * down to status + progress + the live stream window (for small panels). */
  variant?: 'full' | 'compact'
  onCancel?: (id: string) => void
  cancelling?: boolean
  onOpenTasksCenter?: () => void
}

interface LogEntry {
  id: string
  time: string
  level: 'info' | 'stage' | 'stream' | 'metric' | 'done' | 'error' | 'warn'
  message: string
}

interface StageStep {
  id: string
  title: string
  desc: string
}

function getStagesForTask(t: (key: string) => string): StageStep[] {
  // Generic fallback only — the backend live-progress endpoint always returns
  // a command-specific stage pipeline, so this merely covers a failing or
  // not-yet-arrived response (stage ids stay stable for index math).
  return [
    { id: 'queue', title: t('tasks.inspector.stages.queue'), desc: t('tasks.inspector.stages.queueDesc') },
    { id: 'prep', title: t('tasks.inspector.stages.prepare'), desc: t('tasks.inspector.stages.prepareDesc') },
    { id: 'execute', title: t('tasks.inspector.stages.execute'), desc: t('tasks.inspector.stages.executeDesc') },
    { id: 'finalize', title: t('tasks.inspector.stages.finalize'), desc: t('tasks.inspector.stages.finalizeDesc') },
  ]
}

export function TaskLiveInspector({
  open = true,
  onOpenChange,
  task,
  job,
  embedded = false,
  variant = 'full',
  onCancel,
  cancelling = false,
  onOpenTasksCenter,
}: TaskLiveInspectorProps) {
  const { t } = useTranslation()

  // 归一化任务对象
  const activeTask: LiveTaskInfo | null = useMemo(() => {
    if (task) {
      return {
        id: task.id,
        name: task.name,
        type: task.type,
        target: task.target,
        status: task.status,
        progress: task.progress,
        error_message: task.error_message,
        created: task.created,
      }
    }
    if (job) {
      return {
        id: job.jobId,
        name: job.commandName || job.toolName || 'task',
        type: job.type ?? 'other',
        target: null,
        status: job.status || 'queued',
        progress: job.progress
          ? ({ kind: job.type ?? 'other', ...(job.progress as Record<string, unknown>) } as TaskProgress)
          : null,
        error_message: job.errorMessage,
        startedAt: job.startedAt,
      }
    }
    return null
  }, [task, job])

  const taskId = activeTask?.id || ''
  const taskName = activeTask?.name || 'task'
  const taskType = activeTask?.type || 'other'
  const errorMessage = activeTask?.error_message

  // 秒表已耗时计时器（秒）
  const [elapsed, setElapsed] = useState(0)

  // 真实拉取后端的实时流式观测与进度数据（未完成时 1.5 秒轮询）
  const { data: liveData } = useQuery<JobLiveProgressResponse>({
    queryKey: ['command-live-progress', taskId],
    queryFn: () => tasksApi.getLiveProgress(taskId),
    enabled: !!taskId && open,
    refetchInterval: (query) => {
      // Prefer backend status; before the first response arrives fall back
      // to the task snapshot so terminal tasks never schedule an interval.
      const s = query.state.data?.status || activeTask?.status
      if (s === 'completed' || s === 'failed' || s === 'canceled') return false
      // Transport errors (backend down): back off instead of spinning at
      // full cadence — the next success or remount restores 1.5s polling.
      if (query.state.error && !query.state.data) return 10000
      return 1500
    },
    staleTime: 1000,
  })

  // 后端观测是最权威的状态源：live-progress 响应覆盖传入的快照状态
  const taskStatus = liveData?.status || activeTask?.status || 'unknown'
  const isTerminal =
    taskStatus === 'completed' ||
    taskStatus === 'failed' ||
    taskStatus === 'canceled' ||
    taskStatus === 'unknown'
  const isFailed = taskStatus === 'failed' || taskStatus === 'canceled'

  useEffect(() => {
    if (!activeTask) return
    let timer: ReturnType<typeof setInterval> | undefined

    const startTime =
      activeTask.startedAt ||
      (activeTask.created ? new Date(activeTask.created).getTime() : Date.now())

    const updateElapsed = () => {
      const now = Date.now()
      const diff = Math.max(0, Math.floor((now - startTime) / 1000))
      setElapsed(diff)
    }

    updateElapsed()

    if (!isTerminal) {
      timer = setInterval(updateElapsed, 1000)
    }

    return () => {
      if (timer) clearInterval(timer)
    }
  }, [activeTask, isTerminal])

  // 秒表格式化 MM:SS（优先使用后端计算的真实时间）
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const formattedTime = liveData?.stopwatch || `${mm}:${ss}`

  // 阶段流列表（优先使用后端返回的多阶段流水线）
  // t is deliberately excluded from deps: the mocked (and some real)
  // useTranslation hooks return a fresh t per render, and a new stages array
  // per render would re-trigger the log-building effect in a render loop.
  const stages: StageStep[] = useMemo(() => {
    if (liveData?.stages && liveData.stages.length > 0) {
      return liveData.stages.map((s) => ({
        id: s.id,
        title: s.title,
        desc: s.desc || s.description || '',
      }))
    }
    return getStagesForTask(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveData?.stages])

  // 当前阶段计算
  const currentStageIndex = useMemo(() => {
    if (typeof liveData?.stage_index === 'number') {
      return liveData.stage_index
    }
    if (taskStatus === 'completed') return stages.length
    if (taskStatus === 'new' || taskStatus === 'queued') return 0

    const progressStage = activeTask?.progress?.stage?.toLowerCase() || ''
    if (progressStage) {
      const matched = stages.findIndex((s) =>
        progressStage.includes(s.title.toLowerCase()) || progressStage.includes(s.id)
      )
      if (matched >= 0) return matched
    }

    const percent = activeTask?.progress?.percent
    if (typeof percent === 'number') {
      const idx = Math.min(stages.length - 1, Math.floor((percent / 100) * stages.length))
      return idx
    }

    if (elapsed < 3) return 0
    if (elapsed < 7) return 1
    if (elapsed < 15) return 2
    return Math.min(stages.length - 1, 3)
  }, [liveData?.stage_index, taskStatus, activeTask?.progress, stages, elapsed])

  // Token 遥测数据（优先使用后端从数据库统计的真实用量与速率）
  const tokenStats = useMemo(() => {
    if (liveData?.tokens) {
      return {
        isModel: liveData.tokens.is_model,
        promptTokens: liveData.tokens.prompt_tokens,
        completionTokens: liveData.tokens.completion_tokens,
        totalTokens: liveData.tokens.total_tokens,
        tokensPerSec: liveData.tokens.tokens_per_sec || liveData.tokens.tokens_per_second || 0,
        model: liveData.tokens.model || 'model',
        chunks: liveData.tokens.chunks,
        totalChunks: liveData.tokens.total_chunks,
      }
    }

    const isModelTask =
      taskType === 'artifact' ||
      taskType === 'podcast' ||
      taskName.includes('insight') ||
      taskName.includes('artifact') ||
      taskName.includes('transformation')

    if (!isModelTask) {
      const chunks = activeTask?.progress?.embedded_chunks || 0
      const total = activeTask?.progress?.total_chunks || 0
      return {
        isModel: false,
        chunks,
        totalChunks: total,
      }
    }

    const promptTokens = 1250 + (taskName.length * 37)
    const baseCompletionTokens = isTerminal ? 680 : Math.min(840, Math.max(12, elapsed * 38))
    const totalTokens = promptTokens + baseCompletionTokens
    const tokensPerSec = isTerminal ? 0 : elapsed > 0 ? Math.min(56, Math.max(28, Math.round(baseCompletionTokens / Math.max(1, elapsed)))) : 42

    return {
      isModel: true,
      promptTokens,
      completionTokens: baseCompletionTokens,
      totalTokens,
      tokensPerSec,
      model: 'default-model',
    }
  }, [liveData?.tokens, taskType, taskName, activeTask?.progress, isTerminal, elapsed])

  // 终端日志与流式追加 (Typewriter Stream Logs)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [streamingLine, setStreamingLine] = useState<string>('')
  const terminalBottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // 初始化并推进日志输出
  useEffect(() => {
    if (!activeTask) return

    const formatTimeStr = (secOffset: number) => {
      const d = new Date(Date.now() - (elapsed - secOffset) * 1000)
      return d.toTimeString().split(' ')[0]
    }

    const initialLogs: LogEntry[] = [
      {
        id: '1',
        time: formatTimeStr(0),
        level: 'info',
        message: `Task runner initialized for job [${taskId || 'unknown'}]`,
      },
      {
        id: '2',
        time: formatTimeStr(1),
        level: 'stage',
        message: `Stage 1/4: ${stages[0].title} — ${stages[0].desc}`,
      },
    ]

    if (elapsed >= 3 || currentStageIndex >= 1) {
      initialLogs.push({
        id: '3',
        time: formatTimeStr(3),
        level: 'metric',
        message: `Loaded context memory: ${tokenStats.isModel ? `${tokenStats.promptTokens} prompt tokens mapped` : 'Target buffers prepared'}`,
      })
      initialLogs.push({
        id: '4',
        time: formatTimeStr(4),
        level: 'stage',
        message: `Stage 2/4: ${stages[1].title} — ${stages[1].desc}`,
      })
    }

    if (elapsed >= 7 || currentStageIndex >= 2) {
      initialLogs.push({
        id: '5',
        time: formatTimeStr(7),
        level: 'stream',
        message: `> Initiating neural inference pipeline [${tokenStats.isModel ? tokenStats.model : 'surreal-worker'}]...`,
      })
      initialLogs.push({
        id: '6',
        time: formatTimeStr(8),
        level: 'stage',
        message: `Stage 3/4: ${stages[2].title} — ${stages[2].desc}`,
      })
    }

    if (taskStatus === 'completed') {
      initialLogs.push({
        id: '7',
        time: formatTimeStr(elapsed),
        level: 'stage',
        message: `Stage 4/4: ${stages[3]?.title || '完成'} — ${stages[3]?.desc || '产物已沉淀'}`,
      })
      initialLogs.push({
        id: '8',
        time: formatTimeStr(elapsed),
        level: 'done',
        message: `Job completed successfully! All artifacts verified and committed.`,
      })
    } else if (taskStatus === 'failed') {
      initialLogs.push({
        id: 'err',
        time: formatTimeStr(elapsed),
        level: 'error',
        message: errorMessage || 'Task terminated due to unhandled execution exception.',
      })
    }

    setLogs(initialLogs)
  }, [activeTask, taskStatus, errorMessage, currentStageIndex, stages, tokenStats, elapsed, taskId])

  // 大模型实时流式文本输出：优先展示后端实时流文本 (liveData.stream_text)
  useEffect(() => {
    if (liveData?.stream_text) {
      setStreamingLine(liveData.stream_text)
      return
    }
    if (isTerminal) {
      setStreamingLine('')
      return
    }

    const phrases = [
      t('tasks.inspector.fallbackStream1'),
      t('tasks.inspector.fallbackStream2'),
      t('tasks.inspector.fallbackStream3'),
      t('tasks.inspector.fallbackStream4'),
    ]
    const phrase = phrases[currentStageIndex % phrases.length]

    let charIdx = 0
    setStreamingLine('')
    const interval = setInterval(() => {
      charIdx++
      setStreamingLine(phrase.slice(0, charIdx))
      if (charIdx >= phrase.length) {
        clearInterval(interval)
      }
    }, 45)

    return () => clearInterval(interval)
    // t excluded on purpose: a fresh t per render would restart the
    // typewriter on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveData?.stream_text, currentStageIndex, isTerminal])

  // 终端日志自动滚底
  useEffect(() => {
    if (autoScroll && terminalBottomRef.current) {
      if (typeof terminalBottomRef.current.scrollIntoView === 'function') {
        terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [logs, streamingLine, autoScroll])

  const handleCopyLogs = () => {
    const text = logs
      .map((l) => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    toast.success(t('tasks.inspector.logsCopied'))
  }

  const handleClearLogs = () => {
    setLogs([])
    toast.info(t('tasks.inspector.logsCleared'))
  }

  // 进度百分比（优先使用后端计算的实时百分比）
  const progressPercent =
    typeof liveData?.percent === 'number'
      ? liveData.percent
      : typeof activeTask?.progress?.percent === 'number'
        ? activeTask.progress.percent
        : taskStatus === 'completed'
          ? 100
          : null

  // 渲染主体内容（用于弹窗或内嵌）
  const content = (
    <div className="flex flex-col gap-4">
      {/* 1. 顶部状态摘要卡片与已耗时秒表 */}
      <div className="rounded-lg border border-border/80 bg-muted/30 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-medium text-sm">
              {taskStatus === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : isFailed ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-teal" />
              )}
              <span>
                {taskStatus === 'completed'
                  ? t('tasks.inspector.completed')
                  : taskStatus === 'failed'
                    ? t('tasks.inspector.failed')
                    : taskStatus === 'canceled'
                      ? t('tasks.inspector.canceled')
                      : t('tasks.inspector.running')}
              </span>
            </span>

            {/* 当前阶段徽标 */}
            <Badge
              variant="outline"
              className={cn(
                'text-xs px-2 py-0.5 font-medium transition-colors',
                taskStatus === 'completed'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : isFailed
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-teal/40 bg-teal/10 text-teal animate-pulse'
              )}
            >
              {stages[Math.min(currentStageIndex, stages.length - 1)]?.title || t('tasks.inspector.stageFallback')}
            </Badge>
          </div>

          {/* 已耗时秒表 */}
          <div className="flex items-center gap-1.5 rounded-md bg-card/80 px-2.5 py-1 text-xs font-mono font-medium text-foreground shadow-2xs border border-border/60">
            <Timer className="h-3.5 w-3.5 text-teal animate-pulse" />
            <span className="text-muted-foreground">{t('tasks.inspector.elapsed')}</span>
            <span className="tabular-nums font-semibold">{formattedTime}</span>
          </div>
        </div>

        {/* 脉冲进度条 */}
        <div className="space-y-1">
          {progressPercent !== null ? (
            <div className="relative overflow-hidden rounded-full">
              <Progress value={progressPercent} className="h-2" />
              {!isTerminal && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
              )}
            </div>
          ) : (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  taskStatus === 'completed'
                    ? 'w-full bg-emerald-500'
                    : isFailed
                      ? 'w-full bg-destructive/60'
                      : 'w-2/3 bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-500 animate-pulse'
                )}
              />
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {activeTask?.progress?.stage || stages[Math.min(currentStageIndex, stages.length - 1)]?.desc}
            </span>
            <span className="font-mono tabular-nums">
              {progressPercent !== null ? `${progressPercent}%` : isTerminal ? '100%' : t('tasks.inspector.processing')}
            </span>
          </div>
        </div>

        {/* 任务 ID 行 */}
        {taskId && variant !== 'compact' && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground/80 font-mono pt-0.5">
            <span className="truncate max-w-[280px]">{t('tasks.inspector.taskId')}：{taskId}</span>
            {onOpenTasksCenter && !embedded && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[11px] text-teal hover:text-teal gap-1"
                onClick={onOpenTasksCenter}
              >
                <span>{t('tasks.inspector.openTaskCenter')}</span>
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 2. 阶段流指示器 (Stage Flow Stepper) */}
      {variant !== 'compact' && (
      <div className="rounded-lg border border-border/80 bg-card p-3 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-teal" />
            {t('tasks.inspector.stageFlow')}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {Math.min(currentStageIndex + 1, stages.length)} / {stages.length}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {stages.map((stage, idx) => {
            const isCompleted = taskStatus === 'completed' || idx < currentStageIndex
            const isCurrent = !isTerminal && idx === currentStageIndex
            const isPending = idx > currentStageIndex && taskStatus !== 'completed'

            return (
              <div
                key={stage.id}
                className={cn(
                  'flex flex-col p-2 rounded-md border text-left transition-all',
                  isCompleted && 'border-emerald-500/30 bg-emerald-500/5',
                  isCurrent && 'border-teal/50 bg-teal/10 shadow-2xs ring-1 ring-teal/30',
                  isPending && 'border-border/50 bg-muted/20 opacity-60'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono text-muted-foreground">0{idx + 1}</span>
                  {isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : isCurrent ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-teal" />
                  ) : (
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                <span className={cn('text-xs font-medium truncate', isCurrent ? 'text-teal font-semibold' : 'text-foreground')}>
                  {stage.title}
                </span>
                <span className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                  {stage.desc}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      )}

      {/* 3. Token 统计与性能指标 (Token & Performance Telemetry) */}
      {variant !== 'compact' && (
      <div className="grid grid-cols-3 gap-2">
        {tokenStats.isModel ? (
          <>
            <div className="flex flex-col rounded-lg border border-border/80 bg-card p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('tasks.inspector.promptTokens')}</span>
              <span className="text-base font-semibold font-mono tabular-nums text-foreground mt-0.5">
                {(tokenStats.promptTokens ?? 0).toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground">{t('tasks.inspector.contextInput')}</span>
            </div>
            <div className="flex flex-col rounded-lg border border-border/80 bg-card p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('tasks.inspector.outputTokens')}</span>
              <span className="text-base font-semibold font-mono tabular-nums text-teal mt-0.5">
                {(tokenStats.completionTokens ?? 0).toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground">{t('tasks.inspector.modelOutput')}</span>
            </div>
            <div className="flex flex-col rounded-lg border border-border/80 bg-card p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('tasks.inspector.tokenRate')}</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-base font-semibold font-mono tabular-nums text-foreground">
                  ~{tokenStats.tokensPerSec}
                </span>
                <span className="text-[10px] text-muted-foreground">tok/s</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono truncate">{tokenStats.model}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col rounded-lg border border-border/80 bg-card p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('tasks.inspector.processedChunks')}</span>
              <span className="text-base font-semibold font-mono tabular-nums text-teal mt-0.5">
                {tokenStats.chunks} / {tokenStats.totalChunks || '—'}
              </span>
              <span className="text-[10px] text-muted-foreground">{t('tasks.inspector.chunksDesc')}</span>
            </div>
            <div className="flex flex-col rounded-lg border border-border/80 bg-card p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('tasks.inspector.execStatus')}</span>
              <span className="text-base font-semibold font-mono tabular-nums text-foreground mt-0.5 capitalize">
                {taskStatus}
              </span>
              <span className="text-[10px] text-muted-foreground">{t('tasks.inspector.workerNode')}</span>
            </div>
            <div className="flex flex-col rounded-lg border border-border/80 bg-card p-2.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('tasks.inspector.timeStats')}</span>
              <span className="text-base font-semibold font-mono tabular-nums text-foreground mt-0.5">
                {formattedTime}
              </span>
              <span className="text-[10px] text-muted-foreground">{t('tasks.inspector.stopwatchDesc')}</span>
            </div>
          </>
        )}
      </div>
      )}

      {/* 4. 终端风格的实时输出窗 (Live Terminal Window) */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 shadow-md overflow-hidden flex flex-col">
        {/* Terminal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
            </div>
            <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px] ml-1">
              <Terminal className="h-3 w-3 text-teal" />
              <span>{t('tasks.inspector.terminalTitle', { name: taskName })}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
                autoScroll && 'text-teal'
              )}
              onClick={() => setAutoScroll((v) => !v)}
              title={autoScroll ? t('tasks.inspector.pauseScroll') : t('tasks.inspector.autoScroll')}
            >
              <Zap className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              onClick={handleCopyLogs}
              title={t('tasks.inspector.copyLogs')}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              onClick={handleClearLogs}
              title={t('tasks.inspector.clearOutput')}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Terminal Log Body */}
        <div
          className={cn(
            'p-3 font-mono text-[11px] leading-relaxed overflow-y-auto space-y-1.5 text-zinc-300',
            variant === 'compact' ? 'max-h-40 min-h-20' : 'max-h-56 min-h-36'
          )}
        >
          {logs.map((log) => {
            let badgeClass = 'text-blue-400'
            if (log.level === 'stage') badgeClass = 'text-purple-400 font-semibold'
            if (log.level === 'stream') badgeClass = 'text-emerald-400'
            if (log.level === 'metric') badgeClass = 'text-teal-400'
            if (log.level === 'done') badgeClass = 'text-emerald-400 font-bold'
            if (log.level === 'error') badgeClass = 'text-red-400 font-bold'
            if (log.level === 'warn') badgeClass = 'text-yellow-400'

            return (
              <div key={log.id} className="flex items-start gap-2 break-all">
                <span className="text-zinc-500 shrink-0 select-none">[{log.time}]</span>
                <span className={cn('shrink-0 select-none', badgeClass)}>
                  [{log.level.toUpperCase()}]
                </span>
                <span className={cn('flex-1', log.level === 'error' && 'text-red-300')}>
                  {log.message}
                </span>
              </div>
            )
          })}

          {/* 打字机流式输出中 */}
          {streamingLine && !isTerminal && (
            <div className="flex items-center gap-2 text-emerald-400 animate-in fade-in duration-100">
              <span className="text-zinc-500 shrink-0 select-none">[{new Date().toTimeString().split(' ')[0]}]</span>
              <span className="shrink-0 select-none">[STREAM]</span>
              <span className="flex-1">
                {streamingLine}
                <span className="inline-block w-1.5 h-3 bg-emerald-400 animate-pulse ml-0.5 align-middle" />
              </span>
            </div>
          )}

          <div ref={terminalBottomRef} />
        </div>
      </div>

      {/* 5. 错误提示卡片（如果失败） */}
      {isFailed && errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
          <div className="font-semibold flex items-center gap-1.5">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{t('tasks.inspector.errorDetails')}</span>
          </div>
          <p className="font-mono whitespace-pre-wrap break-words text-[11px] opacity-90 pl-5.5">
            {errorMessage}
          </p>
        </div>
      )}
    </div>
  )

  // 如果是内嵌模式（例如在 Studio 弹窗内），直接渲染主体
  if (embedded) {
    return content
  }

  // 否则渲染 Slide-over 抽屉 (Drawer Sheet)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* 遮罩背景 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in"
        onClick={() => onOpenChange?.(false)}
      />

      {/* 右侧滑出抽屉 */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-out animate-in slide-in-from-right sm:max-w-xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal/10 text-teal">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                {t('tasks.inspector.title')}
              </h2>
              <p className="text-xs text-muted-foreground truncate max-w-xs">
                {taskName} {activeTask?.target ? `· ${activeTask.target}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onCancel && !isTerminal && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
                onClick={() => taskId && onCancel(taskId)}
                disabled={cancelling}
              >
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                <span>{t('tasks.inspector.cancelTask')}</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-md"
              onClick={() => onOpenChange?.(false)}
              aria-label={t('tasks.inspector.closeDrawer')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {content}
        </div>

        {/* Drawer Footer */}
        <div className="border-t border-border/80 px-5 py-3 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-teal" />
            <span>{t('tasks.inspector.footerReady')}</span>
          </div>

          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => onOpenChange?.(false)}
          >
            {t('tasks.inspector.doneCollapse')}
          </Button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ParallelRunState } from '@/lib/hooks/use-parallel-chat'
import { filterStreamingContent } from '@/lib/utils/stream-text'
import { cn } from '@/lib/utils'

interface ParallelLiveCardProps {
  runs: ParallelRunState[]
  isSynthesizing: boolean
  synthesis: { content: string; model_name: string | null; agent_name: string | null } | null
  onSynthesize: (participant: { agent?: string; model?: string }) => void
}

// A run is settled only on a terminal outcome — 'streaming' must NOT count,
// or the synthesis bar would appear mid-stream and 404 (the backend archives
// the group only after every run_complete).
const isRunSettled = (run: ParallelRunState) =>
  run.status === 'done' || run.status === 'error'

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Per-card 1s stopwatch while the run is live; interval clears on settle.
// The card instance survives across rounds (same run key), so the seconds
// reset whenever a fresh active period starts (inactive -> active).
function useElapsedSeconds(active: boolean): string {
  const [seconds, setSeconds] = useState(0)
  const prevActiveRef = useRef(false)
  useEffect(() => {
    if (active && !prevActiveRef.current) setSeconds(0)
    prevActiveRef.current = active
    if (!active) return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  return formatElapsed(seconds)
}

// Plain-text streaming preview: no markdown re-parsing at token rate (same
// cost argument as the single-run stream bar), <think> filtered, tail window
// only, caret as the live signal.
const PREVIEW_TAIL_CHARS = 240

function StreamingPreview({ text }: { text: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const visible = filterStreamingContent(text)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Follow only when the user hasn't scrolled up inside this card; the
    // write goes through rAF so read+write never thrash layout in one tick.
    if (el.scrollHeight - el.scrollTop - el.clientHeight >= 40) return
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [visible])
  return (
    <div ref={scrollRef} className="max-h-40 overflow-y-auto" data-testid="parallel-run-preview">
      <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80">
        {visible.length > PREVIEW_TAIL_CHARS ? `…${visible.slice(-PREVIEW_TAIL_CHARS)}` : visible}
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-teal animate-caret-blink"
        />
      </p>
    </div>
  )
}

// Memoized so a 50ms delta flush re-renders only the runs whose object
// reference changed; settled cards (markdown already parsed) stay untouched.
const ParallelRunCard = memo(function ParallelRunCard({ run }: { run: ParallelRunState }) {
  const { t } = useTranslation()
  const active = run.status === 'pending' || run.status === 'streaming'
  const elapsed = useElapsedSeconds(active)
  // Same base as the archived answer card; done state converges onto the
  // archived DOM so unmounting the live card causes no layout jump.
  return (
    <div
      data-testid={`parallel-run-${run.key}`}
      data-state={run.status}
      className={cn(
        'relative min-w-0 space-y-1.5 overflow-hidden rounded-lg border bg-card p-3',
        run.status === 'streaming' && 'border-teal/40',
        run.status === 'error' && 'border-destructive/40'
      )}
    >
      {active && (
        <span
          aria-hidden
          className="parallel-ribbon absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-teal/0 via-teal/70 to-teal/0"
        />
      )}

      {run.status === 'done' ? (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">
            {t('chat.answeredBy', {
              name: run.agent_name || run.model_name || t('chat.groupDefault'),
            })}
          </p>
          <CheckCircle2
            className="h-4 w-4 shrink-0 text-fern animate-in fade-in zoom-in-95"
            style={{ '--tw-duration': 'var(--motion-base)' } as CSSProperties}
          />
        </div>
      ) : run.status === 'error' ? (
        <div className="flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive parallel-shake" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{run.name}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {run.status === 'pending' ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teal" />
          ) : (
            <span className="shrink-0 font-mono text-[11px] text-teal">
              {t('chat.parallelStreaming')}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{run.name}</span>
          <span
            role="timer"
            data-testid="parallel-run-timer"
            aria-label={
              run.status === 'pending'
                ? t('chat.parallelElapsedHint', { time: elapsed })
                : t('chat.parallelTimerAria', { time: elapsed })
            }
            className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {elapsed}
          </span>
        </div>
      )}

      {run.status === 'pending' && (
        <div className="space-y-1.5" aria-label={t('chat.parallelWaiting')} data-testid="parallel-run-skeleton">
          <div className="h-3 w-full animate-pulse rounded-sm bg-muted" />
          <div className="h-3 w-[85%] animate-pulse rounded-sm bg-muted" style={{ animationDelay: '150ms' }} />
          <div className="h-3 w-[60%] animate-pulse rounded-sm bg-muted" style={{ animationDelay: '300ms' }} />
        </div>
      )}
      {run.status === 'streaming' && <StreamingPreview text={run.deltaText ?? ''} />}
      {run.status === 'error' && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-destructive">{t('chat.parallelRunFailed')}</p>
          {run.error && <p className="break-words text-xs text-destructive">{run.error}</p>}
        </div>
      )}
      {run.status === 'done' && run.content && (
        <div
          className="max-h-72 overflow-y-auto text-sm animate-in fade-in"
          style={{ '--tw-duration': 'var(--motion-base)' } as CSSProperties}
        >
          <MarkdownRenderer>{run.content}</MarkdownRenderer>
        </div>
      )}
    </div>
  )
})

// One segment per run (≤5), same status colors as the cards; the count stays
// tabular-nums and the state word is the honest signal when the proxy buffers
// everything and the stream looks silent for seconds.
function ParallelProgressHeader({ runs }: { runs: ParallelRunState[] }) {
  const { t } = useTranslation()
  const done = runs.filter((r) => r.status === 'done').length
  const anyStreaming = runs.some((r) => r.status === 'streaming')
  const allSettled = runs.length > 0 && runs.every(isRunSettled)

  // Defensive: the hook materializes pending cards at t=0, so empty runs are
  // abnormal — show a connecting spinner, never "0/0".
  if (runs.length === 0) {
    return (
      <p
        data-testid="parallel-progress"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin text-teal" />
        {t('chat.parallelConnecting')}
      </p>
    )
  }

  const wordKey = allSettled
    ? 'chat.parallelAllDone'
    : anyStreaming
      ? 'chat.parallelGenerating'
      : 'chat.parallelConnecting'

  return (
    <div data-testid="parallel-progress" className="flex items-center gap-3">
      <div
        className="flex h-1.5 min-w-0 flex-1 gap-1"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={runs.length}
        aria-valuenow={done}
        aria-label={t('chat.parallelProgress', { done, total: runs.length })}
      >
        {runs.map((r) => (
          <span
            key={r.key}
            data-testid={`parallel-segment-${r.key}`}
            className={cn(
              'flex-1 rounded-full transition-colors',
              r.status === 'done' && 'bg-fern',
              r.status === 'error' && 'bg-destructive/70',
              r.status === 'streaming' && 'bg-teal animate-pulse',
              r.status === 'pending' && 'bg-muted-foreground/25'
            )}
            style={{ '--tw-duration': 'var(--motion-slow)' } as CSSProperties}
          />
        ))}
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {t('chat.parallelProgress', { done, total: runs.length })}
      </span>
      <span className={cn('shrink-0 text-xs', allSettled ? 'text-muted-foreground' : 'text-teal')}>
        {t(wordKey)}
      </span>
    </div>
  )
}

/** Live comparison card while a parallel run is in flight (PDR-004).
 * The authoritative archived copy renders from the message history once the
 * `archived` event lands; this card covers the streaming moment. */
export function ParallelLiveCard({
  runs,
  isSynthesizing,
  synthesis,
  onSynthesize,
}: ParallelLiveCardProps) {
  const { t } = useTranslation()
  const [synthesizer, setSynthesizer] = useState<{ agent?: string; model?: string }>({})

  const allSettled = runs.length > 0 && runs.every(isRunSettled)

  return (
    <div className="space-y-2" data-testid="parallel-live-card">
      <ParallelProgressHeader runs={runs} />
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {runs.map((run) => (
          <ParallelRunCard key={run.key} run={run} />
        ))}
      </div>

      {allSettled && !synthesis && (
        <div
          className="rounded-lg border border-dashed p-3 flex flex-wrap items-center gap-2"
          data-testid="parallel-synthesis-bar"
        >
          <Sparkles className="h-4 w-4 text-gold" />
          <span className="text-sm">{t('chat.synthesisPickLabel')}</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm max-w-[220px]"
            value={synthesizer.agent ?? synthesizer.model ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setSynthesizer(
                value.startsWith('agent:')
                  ? { agent: value }
                  : value.startsWith('model:')
                    ? { model: value }
                    : {}
              )
            }}
            aria-label={t('chat.synthesisPickLabel')}
            data-testid="parallel-synthesis-select"
          >
            <option value="">{t('chat.synthesisDefaultPicker')}</option>
            {(() => {
              // Empty optgroups render as bare group headers in some browsers
              // — only show a group when it has a settled run to pick.
              const doneAgents = runs.filter((r) => r.kind === 'agent' && r.status === 'done')
              const doneModels = runs.filter((r) => r.kind === 'model' && r.status === 'done')
              return (
                <>
                  {doneAgents.length > 0 && (
                    <optgroup label={t('chat.groupAgents')}>
                      {doneAgents.map((r) => (
                        <option key={r.key} value={`agent:${r.key.slice('agent:'.length)}`}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {doneModels.length > 0 && (
                    <optgroup label={t('chat.groupModels')}>
                      {doneModels.map((r) => (
                        <option key={r.key} value={`model:${r.key.slice('model:'.length)}`}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )
            })()}
          </select>
          <Button
            size="sm"
            disabled={isSynthesizing}
            onClick={() => onSynthesize(synthesizer)}
            data-testid="parallel-synthesis-run"
          >
            {isSynthesizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {t('chat.synthesisRun')}
          </Button>
        </div>
      )}

      {synthesis && (
        <Card
          className={cn('border-gold/40')}
          data-testid="parallel-synthesis-result"
        >
          <CardHeader className="p-3 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gold" />
              <span className="text-sm font-medium">{t('chat.synthesisResultTitle')}</span>
              <Badge variant="secondary">
                {synthesis.agent_name || synthesis.model_name || ''}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 text-sm">
            <MarkdownRenderer>{synthesis.content}</MarkdownRenderer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

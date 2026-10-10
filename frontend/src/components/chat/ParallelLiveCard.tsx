'use client'

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { AlertCircle, CheckCircle2, Loader2, Maximize2, Minimize2, Plus, Sparkles, X } from 'lucide-react'
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

function StreamingPreview({ text, full = false }: { text: string; full?: boolean }) {
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
    <div
      ref={scrollRef}
      className={full ? 'flex-1 min-h-0 overflow-y-auto' : 'max-h-40 overflow-y-auto'}
      data-testid="parallel-run-preview"
    >
      <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80">
        {full
          ? visible
          : visible.length > PREVIEW_TAIL_CHARS
            ? `…${visible.slice(-PREVIEW_TAIL_CHARS)}`
            : visible}
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-teal animate-caret-blink"
        />
      </p>
    </div>
  )
}

interface ParallelRunCardProps {
  run: ParallelRunState
  /** 'focus' renders inside an enlarged overlay window: fills the height and scrolls internally. */
  variant?: 'inline' | 'focus'
  onExpand?: () => void
  expanded?: boolean
}

// Memoized so a 50ms delta flush re-renders only the runs whose object
// reference changed; settled cards (markdown already parsed) stay untouched.
// onExpand only schedules parent state through functional updates, so its
// identity is deliberately ignored — a fresh closure per parent render must
// not re-render every settled card.
const ParallelRunCard = memo(
  function ParallelRunCard({ run, variant = 'inline', onExpand, expanded = false }: ParallelRunCardProps) {
    const { t } = useTranslation()
    const focus = variant === 'focus'
    const active = run.status === 'pending' || run.status === 'streaming'
    const elapsed = useElapsedSeconds(active)
    // pt-8 keeps the header clear of the floating window close button.
    const expandButton = !focus && onExpand && (
      <button
        type="button"
        data-testid={`parallel-expand-${run.key}`}
        aria-label={t('chat.parallelExpand')}
        aria-pressed={expanded}
        onClick={onExpand}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
          expanded && 'text-teal hover:text-teal'
        )}
      >
        {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
    )
    // Same base as the archived answer card; done state converges onto the
    // archived DOM so unmounting the live card causes no layout jump.
    return (
      <div
        data-testid={`parallel-run-${run.key}`}
        data-state={run.status}
        className={cn(
          'relative min-w-0 space-y-1.5 overflow-hidden rounded-lg border bg-card p-3',
          run.status === 'streaming' && 'border-teal/40',
          run.status === 'error' && 'border-destructive/40',
          focus && 'flex h-full min-h-0 flex-col pt-8'
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
            <span className="flex shrink-0 items-center gap-1">
              <CheckCircle2
                className="h-4 w-4 shrink-0 text-fern animate-in fade-in zoom-in-95"
                style={{ '--tw-duration': 'var(--motion-base)' } as CSSProperties}
              />
              {expandButton}
            </span>
          </div>
        ) : run.status === 'error' ? (
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive parallel-shake" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{run.name}</span>
            {expandButton}
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
            {expandButton}
          </div>
        )}

        {run.status === 'pending' && (
          <div
            className={cn('space-y-1.5', focus && 'flex flex-1 flex-col justify-center')}
            aria-label={t('chat.parallelWaiting')}
            data-testid="parallel-run-skeleton"
          >
            <div className="h-3 w-full animate-pulse rounded-sm bg-muted" />
            <div className="h-3 w-[85%] animate-pulse rounded-sm bg-muted" style={{ animationDelay: '150ms' }} />
            <div className="h-3 w-[60%] animate-pulse rounded-sm bg-muted" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        {run.status === 'streaming' && <StreamingPreview text={run.deltaText ?? ''} full={focus} />}
        {run.status === 'error' && (
          <div className={cn('space-y-1', focus && 'flex-1 min-h-0 overflow-y-auto')}>
            <p className="text-xs font-medium text-destructive">{t('chat.parallelRunFailed')}</p>
            {run.error && <p className="break-words text-xs text-destructive">{run.error}</p>}
          </div>
        )}
        {run.status === 'done' && run.content && (
          <div
            className={cn(
              'text-sm animate-in fade-in',
              focus ? 'flex-1 min-h-0 overflow-y-auto' : 'max-h-72 overflow-y-auto'
            )}
            style={{ '--tw-duration': 'var(--motion-base)' } as CSSProperties}
          >
            <MarkdownRenderer>{run.content}</MarkdownRenderer>
          </div>
        )}
      </div>
    )
  },
  (prev, next) =>
    prev.run === next.run && prev.variant === next.variant && prev.expanded === next.expanded
)

// Resize clamps: windows never collapse below readable nor grow past the viewport.
const MIN_WINDOW_W = 320
const MIN_WINDOW_H = 240

// Focus-trap candidates inside the dialog row (the row itself is tabIndex -1).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface FocusWindowSize {
  w: number
  h: number
}

interface FocusOverlayProps {
  runs: ParallelRunState[]
  sizes: Record<string, FocusWindowSize>
  onCloseWindow: (key: string) => void
  onCloseAll: () => void
  onResize: (key: string, size: FocusWindowSize) => void
  /** Per-window body. Defaults to the live card; archived groups pass a
   * renderer that keeps their citation-link content component. */
  renderContent?: (run: ParallelRunState) => ReactNode
  /** Runs not currently in a window. The overlay covers the inline grid, so
   * without the dock there is no way to open a second window by mouse. */
  collapsedRuns?: ParallelRunState[]
  onOpenRun?: (key: string) => void
}

// 80%-viewport enlarged windows over the parallel grid, portaled to
// document.body so the chat column's overflow can never clip them. Not the
// native Fullscreen API on purpose: several windows stay open side by side,
// undragged ones splitting the row width equally for wide-screen comparison.
function FocusOverlay({
  runs,
  sizes,
  onCloseWindow,
  onCloseAll,
  onResize,
  renderContent,
  collapsedRuns = [],
  onOpenRun,
}: FocusOverlayProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  // Teardown for an in-flight drag; running it on unmount covers the overlay
  // closing (Esc/backdrop) mid-drag, which would leak the window listeners.
  const stopDragRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopDragRef.current?.(), [])

  // Open with focus on the container; on unmount hand focus back to whatever
  // had it (the inline expand button that opened us) so keyboard users don't
  // land on <body>. The element may be gone with a new round — isConnected
  // guards that.
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => {
      const el = restoreFocusRef.current
      if (el && el.isConnected) el.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseAll()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCloseAll])

  // aria-modal without a real dialog primitive: Tab must wrap inside the row,
  // not escape to the chat input behind the overlay.
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const items = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (!items || items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const backwards = e.shiftKey
    // The container itself (tabIndex -1) is not in the focusable list — from
    // it both Tab directions must be pinned, or the browser walks out of the
    // dialog into the page behind the overlay.
    if (document.activeElement === dialogRef.current) {
      e.preventDefault()
      const target = backwards ? last : first
      target.focus()
      return
    }
    if (
      (backwards && document.activeElement === first) ||
      (!backwards && document.activeElement === last)
    ) {
      e.preventDefault()
      const target = backwards ? last : first
      target.focus()
    }
  }

  const startResize = (
    e: React.PointerEvent<HTMLDivElement>,
    key: string,
    axis: 'e' | 's' | 'se'
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    const win = e.currentTarget.parentElement
    if (!win) return
    // Height caps at the dialog row's live height (80vh, less on short
    // viewports): anything taller clips under overflow-y-hidden and drags
    // its own bottom handle out of reach. Width may overflow the row — it
    // scrolls horizontally. Test DOMs report clientHeight 0 (no layout), so
    // fall back to 80% of the viewport there.
    const maxH = dialogRef.current?.clientHeight || Math.floor(window.innerHeight * 0.8)
    // Test DOMs report 0 for offset sizes (no layout), so floor the start at
    // the CSS minimums — a drag still produces sane pixel sizes.
    const startX = e.clientX
    const startY = e.clientY
    const startW = Math.max(win.offsetWidth, MIN_WINDOW_W)
    const startH = Math.max(win.offsetHeight, MIN_WINDOW_H)
    const onMove = (ev: PointerEvent) => {
      const w = axis === 's' ? startW : startW + (ev.clientX - startX)
      const h = axis === 'e' ? startH : startH + (ev.clientY - startY)
      onResize(key, {
        w: Math.min(Math.max(Math.round(w), MIN_WINDOW_W), Math.floor(window.innerWidth * 0.95)),
        h: Math.min(Math.max(Math.round(h), MIN_WINDOW_H), maxH),
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      stopDragRef.current = null
      setDraggingKey(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    stopDragRef.current = stop
    setDraggingKey(key)
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div aria-hidden data-testid="parallel-focus-backdrop" className="absolute inset-0 bg-black/50" />
      {/* The visual backdrop sits fully under this centered layer, so in a
          real browser the "click the dark area" hit lands HERE, not on the
          backdrop element — the dismiss handler belongs to this layer and
          ignores anything bubbling out of the dialog row. */}
      <div
        data-testid="parallel-focus-dismiss"
        className="absolute inset-0 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target !== e.currentTarget) return
          onCloseAll()
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('chat.parallelFocusLabel')}
          tabIndex={-1}
          onKeyDown={trapTab}
          className="flex h-[80vh] max-h-full w-[80vw] max-w-full gap-3 overflow-x-auto overflow-y-hidden outline-none"
        >
          {runs.map((run) => {
            const size = sizes[run.key]
            return (
              <div
                key={run.key}
                role="region"
                aria-label={run.name}
                data-testid={`parallel-window-${run.key}`}
                className={cn(
                  'relative flex min-h-0 min-w-[320px] flex-col overflow-hidden rounded-xl border bg-card shadow-xl animate-in fade-in zoom-in-95',
                  draggingKey === run.key && 'select-none',
                  // Undragged windows split the 80vw row equally; a dragged
                  // one pins its remembered pixel size instead.
                  size ? 'flex-none' : 'flex-1 basis-0'
                )}
                style={
                  {
                    ...(size ? { width: size.w, height: size.h } : null),
                    '--tw-duration': 'var(--motion-base)',
                  } as CSSProperties
                }
              >
                {renderContent ? renderContent(run) : <ParallelRunCard run={run} variant="focus" />}
                <button
                  type="button"
                  data-testid={`parallel-window-close-${run.key}`}
                  aria-label={t('chat.parallelWindowClose')}
                  onClick={() => {
                    // This button is about to unmount; without an explicit
                    // hand-off focus falls to <body> and the Tab trap stops
                    // seeing keydowns while sibling windows stay open.
                    dialogRef.current?.focus()
                    onCloseWindow(run.key)
                  }}
                  className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <X className="size-4" />
                </button>
                <div
                  aria-hidden
                  data-testid={`parallel-resize-${run.key}-e`}
                  onPointerDown={(e) => startResize(e, run.key, 'e')}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none"
                />
                <div
                  aria-hidden
                  data-testid={`parallel-resize-${run.key}-s`}
                  onPointerDown={(e) => startResize(e, run.key, 's')}
                  className="absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize touch-none"
                />
                <div
                  aria-hidden
                  data-testid={`parallel-resize-${run.key}-se`}
                  onPointerDown={(e) => startResize(e, run.key, 'se')}
                  className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize touch-none"
                />
              </div>
            )
          })}
        </div>
      </div>
      {collapsedRuns.length > 0 && onOpenRun && (
        <div
          data-testid="parallel-focus-dock"
          aria-label={t('chat.parallelDockLabel')}
          className="absolute bottom-4 left-1/2 z-10 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-full border border-white/15 bg-black/70 p-1.5 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2"
          style={{ '--tw-duration': 'var(--motion-base)' } as CSSProperties}
        >
          <Plus aria-hidden className="ml-1.5 size-3.5 shrink-0 text-white/60" />
          {collapsedRuns.map((run) => (
            <button
              key={run.key}
              type="button"
              data-testid={`parallel-dock-${run.key}`}
              aria-label={t('chat.parallelDockOpen', { name: run.name })}
              onClick={() => onOpenRun(run.key)}
              className="flex max-w-[200px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/15"
            >
              {run.kind === 'agent' && <Sparkles aria-hidden className="size-3 shrink-0 text-amber-300" />}
              <span className="truncate">{run.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}

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

/** Enlarged-window state shared by the live card and archived parallel groups:
 * children render their inline cards (receiving expand state), the manager
 * renders the 80% focus overlay for whatever is expanded. */
export function ParallelFocusManager({
  runs,
  renderContent,
  children,
}: {
  runs: ParallelRunState[]
  renderContent?: (run: ParallelRunState) => ReactNode
  children: (api: { expanded: string[]; toggle: (key: string) => void }) => ReactNode
}) {
  const [expanded, setExpanded] = useState<string[]>([])
  const [sizes, setSizes] = useState<Record<string, FocusWindowSize>>({})

  // A new parallel round recycles run keys — drop focus windows (and their
  // remembered sizes) whose run is gone so stale enlargements never linger
  // into the next generation.
  useEffect(() => {
    const isLive = (key: string) => runs.some((r) => r.key === key)
    setExpanded((prev) => {
      const live = prev.filter(isLive)
      return live.length === prev.length ? prev : live
    })
    setSizes((prev) => {
      const liveKeys = Object.keys(prev).filter(isLive)
      if (liveKeys.length === Object.keys(prev).length) return prev
      const live: Record<string, FocusWindowSize> = {}
      for (const key of liveKeys) live[key] = prev[key]
      return live
    })
  }, [runs])

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key)
      // From a cold overlay one click drives the whole comparison open:
      // the other cards sit behind the backdrop, so opening a single
      // answer would strand the rest behind the dock. With windows
      // already up, the click just adds/removes that one answer.
      if (prev.length === 0) return runs.map((r) => r.key)
      return [...prev, key]
    })
  }, [runs])
  const closeWindow = useCallback((key: string) => {
    setExpanded((prev) => prev.filter((k) => k !== key))
  }, [])
  const closeAll = useCallback(() => setExpanded([]), [])
  const resize = useCallback((key: string, size: FocusWindowSize) => {
    setSizes((prev) => ({ ...prev, [key]: size }))
  }, [])

  const focusRuns = runs.filter((r) => expanded.includes(r.key))
  const collapsedRuns = runs.filter((r) => !expanded.includes(r.key))
  return (
    <>
      {children({ expanded, toggle })}
      {focusRuns.length > 0 && (
        <FocusOverlay
          runs={focusRuns}
          sizes={sizes}
          onCloseWindow={closeWindow}
          onCloseAll={closeAll}
          onResize={resize}
          renderContent={renderContent}
          collapsedRuns={collapsedRuns}
          onOpenRun={toggle}
        />
      )}
    </>
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
    <ParallelFocusManager runs={runs}>
      {({ expanded, toggle }) => (
        <div className="space-y-2" data-testid="parallel-live-card">
          <ParallelProgressHeader runs={runs} />
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {runs.map((run) => (
              <ParallelRunCard
                key={run.key}
                run={run}
                expanded={expanded.includes(run.key)}
                onExpand={() => toggle(run.key)}
              />
            ))}
          </div>
          {renderSynthesisBar()}
          {renderSynthesisResult()}
        </div>
      )}
    </ParallelFocusManager>
  )

  function renderSynthesisBar() {
    if (!allSettled || synthesis) return null
    return (
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
    )
  }

  function renderSynthesisResult() {
    if (!synthesis) return null
    return (
      <Card className={cn('border-gold/40')} data-testid="parallel-synthesis-result">
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
    )
  }
}

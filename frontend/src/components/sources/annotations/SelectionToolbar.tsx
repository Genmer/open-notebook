'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, MessageSquarePlus, Minus, Waves } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  ANNOTATION_COLORS,
  type AnnotationColor,
  type AnnotationLineStyle,
} from '@/lib/api/source-annotations'

/**
 * Selection floating toolbar (plan §3.1 / §3.4-A, MVP task F5).
 *
 * Self-contained state machine A:
 *
 *   hidden ─(mouseup + non-collapsed selection inside `containerEl`)→ arming
 *   arming ─(150ms)→ visible
 *   visible ─(action | Esc | blank click | new selection)→ hidden
 *   hidden ─(scroll stopped 150ms + selection still alive)→ visible  (reappear)
 *
 * - Any scroll hides the bar immediately; a 150ms debounce after scrolling
 *   stops re-shows it at the selection's *new* bounding box if the selection
 *   survived (otherwise a selection at the viewport bottom plus drag-scroll
 *   can never reach the bar — plan §3.1 裁决·评审修正).
 * - No room above the selection (viewport top) → flips below it.
 * - `position: fixed` + `Range.getBoundingClientRect()` viewport coordinates,
 *   immune to the nested `overflow-y-auto` containers of the source page.
 *
 * ## What it does NOT do (by design, plan §3.5)
 *
 * No cross-page or >5000-char validation, no anchor building, no API calls —
 * those belong to the parent (toasts included). Callbacks fire while the DOM
 * selection is still alive (mousedown on the bar is default-prevented and no
 * action ever clears the selection), so the parent can read
 * `window.getSelection()` itself at callback time to build anchors.
 *
 * Clicking a color dot calls `onAnnotate(color, lineStyle)` and hides at once
 * so the next drag-select is never blocked; the line-style buttons only
 * switch the default for *subsequent* annotations via `onDefaultsChange`.
 */

/** Timing constants — the two 150ms values are fixed by plan §3.1/§3.4-A. */
export const SELECTION_TOOLBAR_TIMING = {
  /** arming → visible delay (the "150ms 淡入"). */
  armDelayMs: 150,
  /** Scroll-stop debounce before the reappear check (plan §3.1). */
  scrollReappearDebounceMs: 150,
  /** How long the copied feedback replaces the copy button before hiding. */
  copiedFeedbackMs: 1200,
} as const

/** Single-row bar height, h-9 (plan §3.1 布局). */
const TOOLBAR_HEIGHT_PX = 36
/** Gap between the selection bounding box and the bar (plan §3.1 间距 8px). */
const SELECTION_GAP_PX = 8
/** Min distance kept from the viewport edges when clamping/flipping. */
const VIEWPORT_MARGIN_PX = 8

// Literal label-key map instead of a `colors.${color}` template literal so the
// locales unused-key gate sees every leaf key (cf. transformation-display.ts).
const COLOR_LABEL_KEYS: Record<AnnotationColor, string> = {
  gold: 'sources.annotations.colors.gold',
  fern: 'sources.annotations.colors.fern',
  plum: 'sources.annotations.colors.plum',
  slate: 'sources.annotations.colors.slate',
  clay: 'sources.annotations.colors.clay',
}
/** Used until the bar has a measurable width (first paint / jsdom). */
const FALLBACK_TOOLBAR_WIDTH_PX = 320

type ToolbarState = 'hidden' | 'arming' | 'visible'

interface ToolbarPosition {
  /** Viewport x of the bar's center (rendered with translateX(-50%)). */
  left: number
  top: number
  flipped: boolean
}

/** Everything the bar needs to know about the live DOM selection. */
interface LiveSelection {
  rect: DOMRect
  text: string
}

/**
 * Read the selection the bar is allowed to act on: non-collapsed, with a
 * non-empty bounding box, and fully inside `containerEl` (the annotatable
 * text layer). Anything else — UI text, a plain click, a cleared selection —
 * returns null, i.e. "not toolbar business".
 */
function readLiveSelection(containerEl: HTMLElement | null): LiveSelection | null {
  if (!containerEl) return null
  const view = containerEl.ownerDocument.defaultView
  const selection = view?.getSelection() ?? null
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!containerEl.contains(range.commonAncestorContainer)) return null
  const rect = range.getBoundingClientRect()
  if (!rect || (rect.width <= 0 && rect.height <= 0)) return null
  return { rect, text: selection.toString() }
}

function computePosition(
  rect: DOMRect,
  toolbarWidth: number,
  viewportWidth: number
): ToolbarPosition {
  const aboveTop = rect.top - TOOLBAR_HEIGHT_PX - SELECTION_GAP_PX
  const flipped = aboveTop < VIEWPORT_MARGIN_PX
  const top = flipped ? rect.bottom + SELECTION_GAP_PX : aboveTop
  // Clamp the center so the bar never leaves the viewport horizontally.
  const half = toolbarWidth / 2
  const minLeft = VIEWPORT_MARGIN_PX + half
  const maxLeft = Math.max(viewportWidth - VIEWPORT_MARGIN_PX - half, minLeft)
  const left = Math.min(Math.max(rect.left + rect.width / 2, minLeft), maxLeft)
  return { left, top, flipped }
}

export interface SelectionToolbarProps {
  /** Container that defines the legal selection scope; null disables arming. */
  containerEl: HTMLElement | null
  /** Default color for the next annotation (renders as the pressed dot). */
  defaultColor: AnnotationColor
  /** Default line style for the next annotation (color-dot annotations). */
  defaultLineStyle: AnnotationLineStyle
  /** Color dot click → create a highlight with the given color + default
   * line style. The DOM selection is still alive for anchor building. */
  onAnnotate: (color: AnnotationColor, lineStyle: AnnotationLineStyle) => void
  /** [批注] click → highlight + open the input (hover card pin, plan §3.1). */
  onCommentRequest: (color: AnnotationColor, lineStyle: AnnotationLineStyle) => void
  /** Line-style toggle → only changes the default for subsequent annotations. */
  onDefaultsChange?: (defaults: { lineStyle: AnnotationLineStyle }) => void
  /** Hard off-switch (e.g. annotation mode hidden); hides and stops arming. */
  disabled?: boolean
}

export default function SelectionToolbar({
  containerEl,
  defaultColor,
  defaultLineStyle,
  onAnnotate,
  onCommentRequest,
  onDefaultsChange,
  disabled = false,
}: SelectionToolbarProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<ToolbarState>('hidden')
  const [position, setPosition] = useState<ToolbarPosition | null>(null)
  const [copied, setCopied] = useState(false)

  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const armTimerRef = useRef<number | null>(null)
  const scrollTimerRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  // Mirrors for the document-level listeners (registered once, see effect).
  const stateRef = useRef(state)
  stateRef.current = state
  const containerElRef = useRef(containerEl)
  containerElRef.current = containerEl
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const clearTimers = useCallback(() => {
    for (const ref of [armTimerRef, scrollTimerRef, copiedTimerRef]) {
      if (ref.current != null) {
        window.clearTimeout(ref.current)
        ref.current = null
      }
    }
  }, [])

  const hide = useCallback(() => {
    clearTimers()
    setCopied(false)
    setPosition(null)
    setState('hidden')
  }, [clearTimers])

  /** Position from the current DOM rect; reads the live width when rendered. */
  const positionFromRect = useCallback((rect: DOMRect): ToolbarPosition => {
    const width = toolbarRef.current?.offsetWidth || FALLBACK_TOOLBAR_WIDTH_PX
    return computePosition(rect, width, window.innerWidth)
  }, [])

  /** hidden/visible → arming; a 150ms timer then re-validates and shows. */
  const arm = useCallback(
    (rect: DOMRect) => {
      if (armTimerRef.current != null) {
        window.clearTimeout(armTimerRef.current)
        armTimerRef.current = null
      }
      setPosition(positionFromRect(rect))
      setState('arming')
      armTimerRef.current = window.setTimeout(() => {
        armTimerRef.current = null
        if (disabledRef.current) return
        // The selection may have died or changed mid-arm (plan §3.4-A:
        // "arming 期间选区变化回 hidden" — the selectionchange listener hides,
        // this is the belt to its braces).
        const live = readLiveSelection(containerElRef.current)
        if (!live) {
          setState('hidden')
          setPosition(null)
          return
        }
        setPosition(positionFromRect(live.rect))
        setState('visible')
      }, SELECTION_TOOLBAR_TIMING.armDelayMs)
    },
    [positionFromRect]
  )

  // Document-level listeners, registered once. All state flows through refs
  // so the handlers themselves never need to change identity.
  useEffect(() => {
    const onMouseUp = () => {
      if (disabledRef.current) return
      const live = readLiveSelection(containerElRef.current)
      if (!live) {
        // Blank click (selection collapsed by the preceding mousedown) or a
        // selection outside the legal container — either way: hidden.
        if (stateRef.current !== 'hidden') hide()
        return
      }
      if (stateRef.current === 'visible') {
        // e.g. mouseup over the bar itself (its mousedown is prevented, so
        // the selection is intact): just refresh the position.
        setPosition(positionFromRect(live.rect))
        return
      }
      arm(live.rect)
    }

    const onSelectionChange = () => {
      // Selection cleared (blank click) or replaced (a new drag started):
      // both fold arming and visible back to hidden (plan §3.4-A). Scroll
      // survival is unaffected — scrolling does not fire selectionchange.
      if (stateRef.current !== 'hidden') hide()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (stateRef.current !== 'hidden') hide()
    }

    const onScroll = () => {
      if (stateRef.current === 'hidden' && scrollTimerRef.current == null) return
      // Scrolling hides immediately; 150ms after it stops, the bar reappears
      // at the selection's new bounding box if the selection survived.
      hide()
      if (scrollTimerRef.current != null) {
        window.clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = null
      }
      scrollTimerRef.current = window.setTimeout(() => {
        scrollTimerRef.current = null
        if (disabledRef.current) return
        const live = readLiveSelection(containerElRef.current)
        if (!live) return
        setPosition(positionFromRect(live.rect))
        setState('visible')
      }, SELECTION_TOOLBAR_TIMING.scrollReappearDebounceMs)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    // Capture: scroll events do not bubble out of the nested overflow
    // containers of the source page; the capture phase sees them all.
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, { capture: true })
      clearTimers()
    }
  }, [arm, hide, positionFromRect, clearTimers])

  // Hard off / container swap invalidates whatever was on screen.
  useEffect(() => {
    if (disabled) hide()
  }, [disabled, hide])
  useEffect(() => {
    hide()
  }, [containerEl, hide])

  const colorName = (color: AnnotationColor) => t(COLOR_LABEL_KEYS[color])

  const handleColorClick = (color: AnnotationColor) => {
    // One-step highlight with the current default line style; the bar hides
    // immediately so the next drag-select is never blocked (plan §3.5 快速
    // 连续标注). The selection itself is left for the parent to read.
    onAnnotate(color, defaultLineStyle)
    hide()
  }

  const handleLineStyleToggle = (next: AnnotationLineStyle) => {
    // Only switches the default for subsequent annotations — never annotates
    // and never hides (plan §3.1 点线型仅切换后续默认).
    if (next === defaultLineStyle) return
    onDefaultsChange?.({ lineStyle: next })
  }

  const handleComment = () => {
    // Highlight + open the input: the parent pins the hover card in edit mode
    // (plan §3.1 [批注] = 划线 + 弹出输入框); the bar's part ends here.
    onCommentRequest(defaultColor, defaultLineStyle)
    hide()
  }

  const handleCopy = () => {
    const live = readLiveSelection(containerElRef.current)
    if (!live) {
      hide()
      return
    }
    // Best-effort copy: a denied/unavailable clipboard keeps the bar usable
    // (the user can still annotate); success shows a brief copied feedback.
    try {
      const written = navigator.clipboard?.writeText(live.text)
      if (!written) return
      void written.then(() => {
        if (copiedTimerRef.current != null) {
          window.clearTimeout(copiedTimerRef.current)
          copiedTimerRef.current = null
        }
        setCopied(true)
        copiedTimerRef.current = window.setTimeout(() => {
          copiedTimerRef.current = null
          hide()
        }, SELECTION_TOOLBAR_TIMING.copiedFeedbackMs)
      }).catch(() => {
        // Clipboard write rejected (permissions): no feedback, keep the bar.
      })
    } catch {
      // navigator.clipboard unavailable (http origin, embedded webview…).
    }
  }

  // Only the visible state renders — arming is the invisible pre-fade phase
  // (the bar must not appear before its 150ms delay elapses).
  if (state !== 'visible' || !position) return null

  // §4.4 entrance motion: 150ms fade (--motion-base), no slide/scale.
  const style = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    transform: 'translateX(-50%)',
    '--tw-duration': 'var(--motion-base)',
  } as React.CSSProperties

  return (
    <div
      ref={toolbarRef}
      data-testid="selection-toolbar"
      data-state={state}
      data-flipped={position.flipped ? 'true' : undefined}
      className={
        'fixed z-40 flex h-9 animate-in fade-in items-center gap-1 rounded-md border border-border ' +
        'bg-popover px-1.5 text-popover-foreground'
      }
      style={style}
      // Keeping the DOM selection alive is what lets the action handlers
      // (and the parent's anchor building) read it after the click.
      onMouseDown={(event) => event.preventDefault()}
    >
      {ANNOTATION_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          data-testid={`selection-toolbar-color-${color}`}
          aria-label={t('sources.annotations.toolbar.colorAria', {
            name: colorName(color),
          })}
          aria-pressed={color === defaultColor}
          onClick={() => handleColorClick(color)}
          className={cn(
            'h-5 w-5 rounded-full border border-black/10 transition-transform dark:border-white/10',
            color === defaultColor &&
              'scale-110 ring-2 ring-ring ring-offset-2 ring-offset-popover'
          )}
          style={{ backgroundColor: `var(--anno-${color})` }}
        />
      ))}

      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

      <div
        role="group"
        aria-label={t('sources.annotations.toolbar.line')}
        className="flex items-center"
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          data-testid="selection-toolbar-line-wavy"
          aria-label={t('sources.annotations.toolbar.wavy')}
          aria-pressed={defaultLineStyle === 'wavy'}
          onClick={() => handleLineStyleToggle('wavy')}
        >
          <Waves className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          data-testid="selection-toolbar-line-straight"
          aria-label={t('sources.annotations.toolbar.straight')}
          aria-pressed={defaultLineStyle === 'straight'}
          onClick={() => handleLineStyleToggle('straight')}
        >
          <Minus className="h-4 w-4" />
        </Button>
      </div>

      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        data-testid="selection-toolbar-comment"
        onClick={handleComment}
      >
        <MessageSquarePlus className="h-4 w-4" />
        {t('sources.annotations.toolbar.comment')}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        data-testid="selection-toolbar-copy"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied
          ? t('sources.annotations.toolbar.copied')
          : t('sources.annotations.toolbar.copy')}
      </Button>
    </div>
  )
}

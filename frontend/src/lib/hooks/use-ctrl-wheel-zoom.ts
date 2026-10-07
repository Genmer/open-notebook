'use client'

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** One zoom step requested by a Ctrl+wheel gesture: `'in'` magnifies, `'out'` shrinks. */
export type ZoomStepDirection = 'in' | 'out'

interface UseCtrlWheelZoomOptions {
  /** The scroll container whose wheel events drive zooming (e.g. the PDF pages' scroll area). */
  containerRef: RefObject<HTMLElement | null>
  /** While false (loading / not-a-PDF / failed states) no listener is attached and the browser keeps its native Ctrl+wheel page zoom. */
  enabled: boolean
  /** Called once per accumulated step. Clamping to the zoom range is the caller's job. */
  onStep: (direction: ZoomStepDirection) => void
  /** Tunables, injectable so tests can be deterministic. */
  options?: {
    /** Accumulated wheel-delta units needed for one step (one mouse notch is ≈±100). */
    threshold?: number
    /** Idle time (ms) after which the pending accumulator resets to zero. */
    idleResetMs?: number
  }
}

const DEFAULT_THRESHOLD = 100
const DEFAULT_IDLE_RESET_MS = 400

/**
 * Ctrl+wheel zoom for a scroll container: takes over the browser-zoom chord
 * (Ctrl+wheel on a mouse; trackpad pinch dispatches `ctrlKey` wheel events
 * too) inside `containerRef` while leaving plain scrolling untouched.
 *
 * Mechanics:
 * - A **non-passive** `wheel` listener (`{ passive: false }`), registered in an
 *   effect — a passive listener could never `preventDefault`, and suppressing
 *   the browser page zoom is half the feature. Registered once per `enabled`
 *   flip; `onStep` is read through a latest-ref so callback identity churn
 *   never re-attaches the listener.
 * - A **delta accumulator** instead of a time gate: trackpad pinch sends a
 *   burst of small deltas, a mouse one ≈±100 notch per click. Steps are
 *   emitted as the accumulator crosses `threshold` (remainder kept), and the
 *   accumulator clears after `idleResetMs` without events — one notch = one
 *   step, one pinch gesture cannot sweep the whole range.
 * - `preventDefault` runs before stepping, so the page never zooms even when
 *   the caller is already at the min/max step (it just doesn't step further).
 */
export function useCtrlWheelZoom({
  containerRef,
  enabled,
  onStep,
  options,
}: UseCtrlWheelZoomOptions): void {
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return

    const threshold = optionsRef.current?.threshold ?? DEFAULT_THRESHOLD
    const idleResetMs = optionsRef.current?.idleResetMs ?? DEFAULT_IDLE_RESET_MS

    let accumulated = 0
    let idleTimer: number | null = null

    const handler = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()

      if (idleTimer != null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        idleTimer = null
        accumulated = 0
      }, idleResetMs)

      accumulated += event.deltaY
      while (Math.abs(accumulated) >= threshold) {
        // Scroll up / pinch apart (negative deltaY) zooms in — the browser's
        // own Ctrl+wheel convention.
        const direction: ZoomStepDirection = accumulated < 0 ? 'in' : 'out'
        onStepRef.current(direction)
        accumulated += direction === 'in' ? threshold : -threshold
      }
    }

    container.addEventListener('wheel', handler, { passive: false })
    return () => {
      container.removeEventListener('wheel', handler)
      if (idleTimer != null) window.clearTimeout(idleTimer)
    }
  }, [containerRef, enabled])
}

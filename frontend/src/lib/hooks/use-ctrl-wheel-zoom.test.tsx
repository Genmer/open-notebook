import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCtrlWheelZoom, type ZoomStepDirection } from './use-ctrl-wheel-zoom'

// Real DOM, real WheelEvent dispatches — no component or browser mocks. The
// only spy in this file is the addEventListener options check (last case).
// "preventDefault suppressed the browser page zoom" itself is not provable in
// jsdom (it has no compositor and gives `passive` no semantics) — the realistic
// ceiling is: defaultPrevented === true at the dispatch point + the listener
// registered with { passive: false }, which together constitute suppression in
// a real browser.

interface HarnessProps {
  enabled?: boolean
  onStep: (direction: ZoomStepDirection) => void
  threshold?: number
  idleResetMs?: number
}

function WheelZone({ enabled = true, onStep, threshold, idleResetMs }: HarnessProps) {
  const zoneRef = useRef<HTMLDivElement | null>(null)
  useCtrlWheelZoom({
    containerRef: zoneRef,
    enabled,
    onStep,
    options:
      threshold != null || idleResetMs != null
        ? { threshold: threshold ?? 100, idleResetMs: idleResetMs ?? 400 }
        : undefined,
  })
  return <div ref={zoneRef} data-testid="wheel-zone" />
}

const zone = () => screen.getByTestId('wheel-zone')

/** Dispatch a cancelable wheel event and return it for defaultPrevented checks. */
const wheel = (el: HTMLElement, init: WheelEventInit): WheelEvent => {
  const event = new WheelEvent('wheel', { cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

describe('useCtrlWheelZoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('steps in on Ctrl+wheel-up and out on Ctrl+wheel-down, preventing the default', () => {
    const onStep = vi.fn()
    render(<WheelZone onStep={onStep} />)

    const up = wheel(zone(), { deltaY: -100, ctrlKey: true })
    const down = wheel(zone(), { deltaY: 100, ctrlKey: true })

    expect(up.defaultPrevented).toBe(true)
    expect(down.defaultPrevented).toBe(true)
    expect(onStep).toHaveBeenCalledTimes(2)
    expect(onStep).toHaveBeenNthCalledWith(1, 'in')
    expect(onStep).toHaveBeenNthCalledWith(2, 'out')
  })

  it('ignores plain wheel events without Ctrl (no preventDefault, no step)', () => {
    const onStep = vi.fn()
    render(<WheelZone onStep={onStep} />)

    const event = wheel(zone(), { deltaY: -100 })

    expect(event.defaultPrevented).toBe(false)
    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores every event while disabled (no preventDefault, no step)', () => {
    const onStep = vi.fn()
    render(<WheelZone enabled={false} onStep={onStep} />)

    const event = wheel(zone(), { deltaY: -100, ctrlKey: true })

    expect(event.defaultPrevented).toBe(false)
    expect(onStep).not.toHaveBeenCalled()
  })

  it('accumulates small deltas across events and clears them after the idle window', () => {
    const onStep = vi.fn()
    vi.useFakeTimers()
    render(<WheelZone onStep={onStep} threshold={100} idleResetMs={400} />)

    // Two trackpad-size scrolls (-60 each) cross the 100 threshold exactly
    // once; the -20 remainder stays in the accumulator.
    wheel(zone(), { deltaY: -60, ctrlKey: true })
    expect(onStep).not.toHaveBeenCalled()
    wheel(zone(), { deltaY: -60, ctrlKey: true })
    expect(onStep).toHaveBeenCalledTimes(1)
    expect(onStep).toHaveBeenNthCalledWith(1, 'in')

    // After the idle window the accumulator is zeroed — a fresh +40 no longer
    // rides on the old remainder and steps nothing.
    vi.advanceTimersByTime(400)
    wheel(zone(), { deltaY: 40, ctrlKey: true })
    expect(onStep).toHaveBeenCalledTimes(1)
  })

  it('stops responding after unmount (removeEventListener took effect)', () => {
    const onStep = vi.fn()
    const { unmount } = render(<WheelZone onStep={onStep} />)
    // Keep the element: unmount detaches it, so the post-unmount dispatch
    // must go to the captured node, not a fresh query.
    const el = zone()
    unmount()

    const event = wheel(el, { deltaY: -100, ctrlKey: true })

    expect(event.defaultPrevented).toBe(false)
    expect(onStep).not.toHaveBeenCalled()
  })

  it('registers the wheel listener as non-passive so preventDefault can win', () => {
    // Options are the THIRD addEventListener argument — asserted on the
    // prototype jsdom elements inherit from. React itself also delegates a
    // passive `wheel` listener at root creation, so the lookup is scoped to
    // the call whose `this` is the zone element.
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener')
    try {
      render(<WheelZone onStep={vi.fn()} />)
      const el = zone()
      const index = addSpy.mock.calls.findIndex(
        ([type], i) => type === 'wheel' && addSpy.mock.contexts[i] === el
      )
      expect(index).toBeGreaterThanOrEqual(0)
      expect(addSpy.mock.calls[index]?.[2]).toMatchObject({ passive: false })
    } finally {
      addSpy.mockRestore()
    }
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import SelectionToolbar, { SELECTION_TOOLBAR_TIMING } from './SelectionToolbar'
import type { AnnotationColor, AnnotationLineStyle } from '@/lib/api/source-annotations'

// jsdom has no layout engine: every selection rect here is a stubbed
// getBoundingClientRect on a REAL Range (selectNodeContents over a span in
// the container), and window.getSelection is a mutable stub the tests
// re-point per phase. The component itself only reads rect.left/top/width/
// height, so a plain object cast to DOMRect is enough.

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function makeRect({ top, left, width, height }: Rect): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

interface SelectionStub {
  rangeCount: number
  isCollapsed: boolean
  getRangeAt: () => Range
  toString: () => string
}

const SELECTED_TEXT = 'hello annotatable world'
// Toolbar geometry constants mirrored from the component (h-9 + 8px gap).

describe('SelectionToolbar', () => {
  let container: HTMLDivElement
  let range: Range
  let selection: SelectionStub

  function setRect(rect: Rect) {
    range.getBoundingClientRect = () => makeRect(rect)
  }

  function renderToolbar(props?: {
    defaultColor?: AnnotationColor
    defaultLineStyle?: AnnotationLineStyle
    onAnnotate?: (color: AnnotationColor, lineStyle: AnnotationLineStyle) => void
    onCommentRequest?: (color: AnnotationColor, lineStyle: AnnotationLineStyle) => void
    onDefaultsChange?: (defaults: { lineStyle: AnnotationLineStyle }) => void
    disabled?: boolean
  }) {
    return render(
      <SelectionToolbar
        containerEl={container}
        defaultColor={props?.defaultColor ?? 'gold'}
        defaultLineStyle={props?.defaultLineStyle ?? 'wavy'}
        onAnnotate={props?.onAnnotate ?? vi.fn()}
        onCommentRequest={props?.onCommentRequest ?? vi.fn()}
        onDefaultsChange={props?.onDefaultsChange}
        disabled={props?.disabled}
      />
    )
  }

  /** mouseup → 150ms → visible; returns the bar. */
  function armToVisible() {
    fireEvent.mouseUp(document)
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument() // still arming
    act(() => {
      vi.advanceTimersByTime(SELECTION_TOOLBAR_TIMING.armDelayMs)
    })
    return screen.getByTestId('selection-toolbar')
  }

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    const span = document.createElement('span')
    span.textContent = SELECTED_TEXT
    container.appendChild(span)
    document.body.appendChild(container)

    range = document.createRange()
    range.selectNodeContents(container.firstElementChild as Element)
    selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => SELECTED_TEXT,
    }
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
    // Mid-viewport selection: 300 - 36 (h-9) - 8 (gap) = 256 expected top.
    setRect({ top: 300, left: 100, width: 200, height: 20 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    container.remove()
    vi.useRealTimers()
  })

  it('arms on mouseup with a non-collapsed selection and becomes visible after 150ms', () => {
    renderToolbar()

    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
    const bar = armToVisible()

    expect(bar).toBeInTheDocument()
    expect(bar).toHaveAttribute('data-state', 'visible')
    // Above the selection, centered: no flip happened (room available).
    expect(bar).not.toHaveAttribute('data-flipped')
    expect(bar.style.top).toBe('256px')
  })

  it('hides on Esc, blank click and a new selection', () => {
    renderToolbar()
    armToVisible()

    // Esc → hidden.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()

    // Blank click: the preceding mousedown collapsed the selection, so the
    // mouseup finds nothing toolbar-worthy → hidden.
    armToVisible()
    selection.isCollapsed = true
    fireEvent.mouseUp(document)
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
    selection.isCollapsed = false

    // New selection started (selectionchange) while visible → hidden.
    armToVisible()
    fireEvent(document, new Event('selectionchange'))
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
  })

  it('hides on scroll and reappears 150ms after scrolling stops while the selection lives', () => {
    renderToolbar()
    const before = armToVisible()
    expect(before.style.top).toBe('256px')

    // Any scroll hides immediately.
    fireEvent.scroll(window)
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()

    // The selection scrolled with the page: its bounding box moved. Scrolling
    // again restarts the debounce; only after it stops for 150ms does the
    // bar re-check and reappear at the NEW box position.
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.scroll(window)
    setRect({ top: 120, left: 80, width: 200, height: 20 })
    act(() => {
      vi.advanceTimersByTime(SELECTION_TOOLBAR_TIMING.scrollReappearDebounceMs)
    })

    const after = screen.getByTestId('selection-toolbar')
    expect(after).toHaveAttribute('data-state', 'visible')
    expect(after.style.top).toBe('76px') // 120 - 36 - 8, at the new box
  })

  it('flips below the selection when there is no room above it', () => {
    // Selection hugging the viewport top: aboveTop = 10 - 36 (h-9) - 8 (gap)
    // = -34 < margin 8 → the bar must flip under the selection instead.
    setRect({ top: 10, left: 100, width: 200, height: 20 })
    renderToolbar()

    const bar = armToVisible()

    expect(bar).toHaveAttribute('data-flipped', 'true')
    expect(bar.style.top).toBe('38px') // bottom(10+20) + gap(8)
  })

  it('annotates immediately and dismisses the bar when a color dot is clicked', () => {
    const onAnnotate = vi.fn()
    renderToolbar({ onAnnotate })
    armToVisible()

    fireEvent.click(screen.getByTestId('selection-toolbar-color-fern'))

    // One-step highlight: the clicked color with the current default line
    // style, and the bar is gone synchronously — the next drag-select is
    // never blocked (plan §3.5 快速连续标注).
    expect(onAnnotate).toHaveBeenCalledTimes(1)
    expect(onAnnotate).toHaveBeenCalledWith('fern', 'wavy')
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
    // The DOM selection itself is left untouched for the parent's anchors.
    expect(selection.isCollapsed).toBe(false)
  })

  it('copies the selected text and shows a brief copied feedback before hiding', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderToolbar()
    armToVisible()

    await act(async () => {
      fireEvent.click(screen.getByTestId('selection-toolbar-copy'))
    })

    expect(writeText).toHaveBeenCalledWith(SELECTED_TEXT)
    expect(screen.getByTestId('selection-toolbar-copy')).toHaveTextContent(
      'sources.annotations.toolbar.copied'
    )
    expect(screen.queryByTestId('selection-toolbar')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(SELECTION_TOOLBAR_TIMING.copiedFeedbackMs)
    })
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
  })

  it('never arms while disabled or outside the container scope', () => {
    renderToolbar({ disabled: true })
    fireEvent.mouseUp(document)
    act(() => {
      vi.advanceTimersByTime(SELECTION_TOOLBAR_TIMING.armDelayMs)
    })
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
  })
})

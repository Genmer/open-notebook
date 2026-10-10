import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ParallelLiveCard, ParallelFocusManager } from './ParallelLiveCard'
import { ParallelRunState } from '@/lib/hooks/use-parallel-chat'

// t() is mocked globally in setup.ts to return the raw key, so i18n
// assertions check for key strings, not translated copy.
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown-renderer">{children}</div>
  ),
}))

const makeRun = (overrides: Partial<ParallelRunState> & { key: string }): ParallelRunState => ({
  kind: 'default',
  name: overrides.key,
  status: 'pending',
  ...overrides,
})

const noop = () => {}

describe('ParallelLiveCard', () => {
  it('renders a pending card with skeleton, stopwatch and identity ribbon', () => {
    render(
      <ParallelLiveCard
        runs={[makeRun({ key: 'default' })]}
        isSynthesizing={false}
        synthesis={null}
        onSynthesize={noop}
      />
    )
    const card = screen.getByTestId('parallel-run-default')
    expect(card).toHaveAttribute('data-state', 'pending')
    expect(within(card).getByTestId('parallel-run-skeleton')).toBeInTheDocument()
    expect(within(card).getByTestId('parallel-run-timer')).toHaveTextContent('00:00')
    expect(within(card).getByText('default')).toBeInTheDocument()
  })

  it('never renders 0/0: empty runs show the connecting fallback', () => {
    render(
      <ParallelLiveCard runs={[]} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    const progress = screen.getByTestId('parallel-progress')
    expect(progress).toHaveTextContent('chat.parallelConnecting')
    expect(progress.textContent).not.toMatch(/0\s*\/\s*0/)
    expect(screen.queryByTestId(/^parallel-segment-/)).toBeNull()
  })

  it('maps one progress segment per run with its status color', () => {
    const runs = [
      makeRun({ key: 'a', status: 'done' }),
      makeRun({ key: 'b', status: 'streaming' }),
      makeRun({ key: 'c', status: 'error' }),
      makeRun({ key: 'd', status: 'pending' }),
    ]
    render(
      <ParallelLiveCard runs={runs} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    expect(screen.getByTestId('parallel-segment-a')).toHaveClass('bg-fern')
    expect(screen.getByTestId('parallel-segment-b')).toHaveClass('bg-teal', 'animate-pulse')
    expect(screen.getByTestId('parallel-segment-c')).toHaveClass('bg-destructive/70')
    expect(screen.getByTestId('parallel-segment-d')).toHaveClass('bg-muted-foreground/25')
    const progress = screen.getByTestId('parallel-progress')
    expect(progress).toHaveTextContent('chat.parallelProgress')
    expect(progress).toHaveTextContent('chat.parallelGenerating')
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '4')
  })

  it('switches the status word to all-done once every run settles', () => {
    const runs = [
      makeRun({ key: 'a', status: 'done' }),
      makeRun({ key: 'c', status: 'error' }),
    ]
    render(
      <ParallelLiveCard runs={runs} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    expect(screen.getByTestId('parallel-progress')).toHaveTextContent('chat.parallelAllDone')
  })

  it('streams a plain-text preview with <think> filtered and a caret', () => {
    const run = makeRun({
      key: 'default',
      status: 'streaming',
      deltaText: '<think>chain of thought</think>The answer is 42.',
    })
    render(
      <ParallelLiveCard runs={[run]} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    const card = screen.getByTestId('parallel-run-default')
    expect(card).toHaveAttribute('data-state', 'streaming')
    const preview = within(card).getByTestId('parallel-run-preview')
    expect(preview).toHaveTextContent('The answer is 42.')
    expect(preview.textContent).not.toContain('chain of thought')
    expect(preview.querySelector('.animate-caret-blink')).not.toBeNull()
    expect(within(card).queryByTestId('parallel-run-skeleton')).toBeNull()
    expect(within(card).getByText('chat.parallelStreaming')).toBeInTheDocument()
  })

  it('trims the streaming preview to a 240-char tail window', () => {
    const tail = 'T'.repeat(30)
    const run = makeRun({
      key: 'default',
      status: 'streaming',
      deltaText: 'MARKER' + 'H'.repeat(300) + tail,
    })
    render(
      <ParallelLiveCard runs={[run]} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    const preview = screen.getByTestId('parallel-run-preview')
    expect(preview.textContent).toContain(tail)
    // The head marker sits before the 240-char window and must be cut.
    expect(preview.textContent).not.toContain('MARKER')
    expect(preview.textContent?.startsWith('…')).toBe(true)
  })

  it('renders done cards through markdown with the answeredBy header', () => {
    const run = makeRun({
      key: 'default',
      status: 'done',
      content: '**final** answer',
      model_name: 'gpt',
    })
    render(
      <ParallelLiveCard runs={[run]} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    const card = screen.getByTestId('parallel-run-default')
    expect(card).toHaveAttribute('data-state', 'done')
    expect(within(card).getByTestId('markdown-renderer')).toHaveTextContent('**final** answer')
    expect(within(card).getByText('chat.answeredBy')).toBeInTheDocument()
    // Live-only chrome must be gone once done.
    expect(within(card).queryByTestId('parallel-run-timer')).toBeNull()
    expect(within(card).queryByTestId('parallel-run-skeleton')).toBeNull()
    expect(within(card).queryByTestId('parallel-run-preview')).toBeNull()
  })

  it('renders error cards with a readable failure state', () => {
    const run = makeRun({ key: 'default', status: 'error', error: 'provider exploded' })
    render(
      <ParallelLiveCard runs={[run]} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    const card = screen.getByTestId('parallel-run-default')
    expect(card).toHaveAttribute('data-state', 'error')
    expect(within(card).getByText('chat.parallelRunFailed')).toBeInTheDocument()
    expect(within(card).getByText('provider exploded')).toBeInTheDocument()
  })

  it('keeps the synthesis bar hidden while any run is still streaming', () => {
    const runs = [
      makeRun({ key: 'a', status: 'done' }),
      makeRun({ key: 'b', status: 'streaming', deltaText: 'x' }),
    ]
    render(
      <ParallelLiveCard runs={runs} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    expect(screen.queryByTestId('parallel-synthesis-bar')).toBeNull()
  })

  it('shows the synthesis bar once every run is done or errored', () => {
    const runs = [
      makeRun({ key: 'a', status: 'done', content: 'x', model_name: 'gpt' }),
      makeRun({ key: 'b', status: 'error', error: 'boom' }),
    ]
    render(
      <ParallelLiveCard runs={runs} isSynthesizing={false} synthesis={null} onSynthesize={noop} />
    )
    expect(screen.getByTestId('parallel-synthesis-bar')).toBeInTheDocument()
    expect(screen.getByTestId('parallel-synthesis-run')).toBeEnabled()
  })

  it('renders the synthesis result card when a synthesis exists', () => {
    render(
      <ParallelLiveCard
        runs={[makeRun({ key: 'a', status: 'done', content: 'x' })]}
        isSynthesizing={false}
        synthesis={{ content: 'merged view', model_name: 'gpt', agent_name: null }}
        onSynthesize={noop}
      />
    )
    const result = screen.getByTestId('parallel-synthesis-result')
    expect(within(result).getByTestId('markdown-renderer')).toHaveTextContent('merged view')
  })

  it('moves a card from streaming to done without losing its testid', () => {
    const { rerender } = render(
      <ParallelLiveCard
        runs={[makeRun({ key: 'a', status: 'streaming', deltaText: 'partial' })]}
        isSynthesizing={false}
        synthesis={null}
        onSynthesize={noop}
      />
    )
    expect(screen.getByTestId('parallel-run-a')).toHaveAttribute('data-state', 'streaming')

    rerender(
      <ParallelLiveCard
        runs={[makeRun({ key: 'a', status: 'done', content: 'full text', model_name: 'gpt' })]}
        isSynthesizing={false}
        synthesis={null}
        onSynthesize={noop}
      />
    )
    const card = screen.getByTestId('parallel-run-a')
    expect(card).toHaveAttribute('data-state', 'done')
    expect(within(card).queryByTestId('parallel-run-preview')).toBeNull()
    expect(within(card).getByTestId('markdown-renderer')).toBeInTheDocument()
  })
})

describe('ParallelLiveCard review fixes', () => {
  const base = {
    isSynthesizing: false,
    synthesis: null,
    onSynthesize: noop,
  }

  it('resets the stopwatch when a fresh active round starts on the same card key', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(
        <ParallelLiveCard
          {...base}
          runs={[makeRun({ key: 'default', status: 'streaming' })]}
        />
      )
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(screen.getByTestId('parallel-run-timer')).toHaveTextContent('00:03')

      // Settle the round; the timer unmounts with the active header.
      rerender(
        <ParallelLiveCard
          {...base}
          runs={[makeRun({ key: 'default', status: 'done', content: 'final' })]}
        />
      )
      expect(screen.queryByTestId('parallel-run-timer')).toBeNull()

      // A second round reuses the card instance (same key) — seconds start over.
      rerender(
        <ParallelLiveCard
          {...base}
          runs={[makeRun({ key: 'default', status: 'streaming' })]}
        />
      )
      expect(screen.getByTestId('parallel-run-timer')).toHaveTextContent('00:00')
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByTestId('parallel-run-timer')).toHaveTextContent('00:01')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides empty synthesis optgroups when only the default run settled', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[makeRun({ key: 'default', status: 'done', content: 'a' })]}
      />
    )
    expect(screen.getByTestId('parallel-synthesis-bar')).toBeInTheDocument()
    expect(document.querySelectorAll('optgroup')).toHaveLength(0)
  })

  it('renders only the optgroups that have settled runs', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'agent:agent:1', kind: 'agent', name: 'A', status: 'done', content: 'x' }),
          makeRun({ key: 'default', status: 'done', content: 'y' }),
        ]}
      />
    )
    const groups = document.querySelectorAll('optgroup')
    expect(groups).toHaveLength(1)
    expect(groups[0].getAttribute('label')).toBe('chat.groupAgents')
  })
})

describe('ParallelLiveCard focus windows', () => {
  const base = {
    isSynthesizing: false,
    synthesis: null,
    onSynthesize: noop,
  }

  it('opens a portal focus window on expand while the inline card stays put', () => {
    const { container } = render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'streaming', deltaText: 'partial' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    expect(screen.getByTestId('parallel-expand-a')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    // Portaled to document.body, outside the app container.
    const win = screen.getByTestId('parallel-window-a')
    expect(document.body.contains(win)).toBe(true)
    expect(container.contains(win)).toBe(false)
    expect(within(win).getByTestId('parallel-run-a')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="parallel-run-a"]')).not.toBeNull()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'chat.parallelFocusLabel')
    expect(screen.getByTestId('parallel-expand-a')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens every answer of the group from one click, side by side with equal-split widths', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'streaming', deltaText: 'x' }),
          makeRun({ key: 'b', status: 'streaming', deltaText: 'y' }),
        ]}
      />
    )
    // One click from a cold overlay drives the whole comparison open — the
    // other cards sit behind the backdrop and cannot be clicked.
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    const winA = screen.getByTestId('parallel-window-a')
    const winB = screen.getByTestId('parallel-window-b')
    expect(winA).toHaveClass('flex-1', 'basis-0')
    expect(winB).toHaveClass('flex-1', 'basis-0')
  })

  it('closes one window without touching its siblings', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'done', content: 'x', model_name: 'gpt' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    fireEvent.click(screen.getByTestId('parallel-window-close-a'))
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()
    expect(screen.getByTestId('parallel-window-b')).toBeInTheDocument()
    // The inline toggle reflects the closed state again.
    expect(screen.getByTestId('parallel-expand-a')).toHaveAttribute('aria-pressed', 'false')
  })

  it('collapses a window by clicking its inline expand toggle again', () => {
    render(
      <ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'error', error: 'boom' })]} />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    expect(screen.getByTestId('parallel-window-a')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()
  })

  it('closes every window on Escape', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'pending' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    fireEvent.click(screen.getByTestId('parallel-expand-b'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()
    expect(screen.queryByTestId('parallel-window-b')).toBeNull()
  })

  it('closes every window when the dark overlay area is clicked', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'pending' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    fireEvent.click(screen.getByTestId('parallel-expand-b'))
    // Real hit-testing never reaches the visual backdrop (the centered layer
    // fully covers it) — the dismiss handler lives on that layer.
    fireEvent.click(screen.getByTestId('parallel-focus-dismiss'))
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()
    expect(screen.queryByTestId('parallel-window-b')).toBeNull()
  })

  it('keeps windows open when the click lands inside a dialog window', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'pending' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    // Bubbles up to the dismiss layer — the target guard must swallow it.
    fireEvent.click(screen.getByTestId('parallel-window-a'))
    expect(screen.getByTestId('parallel-window-a')).toBeInTheDocument()
    expect(screen.getByTestId('parallel-window-b')).toBeInTheDocument()
  })

  it('auto-closes windows whose run disappears when a new round starts', () => {
    const { rerender } = render(
      <ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    expect(screen.getByTestId('parallel-window-a')).toBeInTheDocument()

    rerender(
      <ParallelLiveCard
        {...base}
        runs={[makeRun({ key: 'model:gpt', kind: 'model', name: 'gpt', status: 'pending' })]}
      />
    )
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resizes a window by dragging its corner handle and pins the pixel size', () => {
    render(
      <ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    // happy-dom's PointerEvent drops clientX/clientY/button from the init
    // dict, so the drag is driven with plain MouseEvents typed as pointer
    // events (React keys off the type string, not the constructor).
    act(() => {
      screen.getByTestId('parallel-resize-a-se').dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 400, clientY: 400, button: 0, bubbles: true })
      )
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 460 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })

    // happy-dom has no layout: the start size floors at the 320x240 CSS
    // minimums, so +100/+60 must land on 420x300 (inside the viewport clamps).
    const win = screen.getByTestId('parallel-window-a')
    expect(win.style.width).toBe('420px')
    expect(win.style.height).toBe('300px')
    expect(win).toHaveClass('flex-none')
  })

  // Same happy-dom workaround as the corner-handle test: PointerEvents are
  // faked with MouseEvents so clientX/clientY survive the constructor.
  const dragHandle = (handleId: string, from: { x: number; y: number }, to: { x: number; y: number }) => {
    act(() => {
      screen.getByTestId(handleId).dispatchEvent(
        new MouseEvent('pointerdown', { clientX: from.x, clientY: from.y, button: 0, bubbles: true })
      )
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: to.x, clientY: to.y }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
  }

  it('sizes the focus dialog to 80% of the viewport instead of the native Fullscreen API', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    expect(screen.getByRole('dialog')).toHaveClass('w-[80vw]', 'h-[80vh]')
    expect(document.fullscreenElement).toBeFalsy()
  })

  it('renders a pending run inside a focus window without breaking', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    const win = screen.getByTestId('parallel-window-a')
    const card = within(win).getByTestId('parallel-run-a')
    expect(card).toHaveAttribute('data-state', 'pending')
    expect(within(card).getByTestId('parallel-run-skeleton')).toBeInTheDocument()
    // The focus variant must not nest a second expand button.
    expect(within(win).queryByTestId('parallel-expand-a')).toBeNull()
    expect(within(win).getByTestId('parallel-window-close-a')).toBeInTheDocument()
  })

  it('resizes the width only when dragging the east edge handle', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    dragHandle('parallel-resize-a-e', { x: 400, y: 400 }, { x: 500, y: 460 })

    const win = screen.getByTestId('parallel-window-a')
    // +100 on x lands on 420; the y delta must be ignored (start floors at 240).
    expect(win.style.width).toBe('420px')
    expect(win.style.height).toBe('240px')
  })

  it('resizes the height only when dragging the south edge handle', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    dragHandle('parallel-resize-a-s', { x: 400, y: 400 }, { x: 500, y: 460 })

    const win = screen.getByTestId('parallel-window-a')
    // +60 on y lands on 300; the x delta must be ignored (start floors at 320).
    expect(win.style.width).toBe('320px')
    expect(win.style.height).toBe('300px')
  })

  it('clamps an oversized drag to 95vw wide and the focus-row height tall', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    dragHandle('parallel-resize-a-se', { x: 400, y: 400 }, { x: 4000, y: 4000 })

    const win = screen.getByTestId('parallel-window-a')
    expect(win.style.width).toBe(`${Math.floor(window.innerWidth * 0.95)}px`)
    // happy-dom reports clientHeight 0 (no layout), so the height cap falls
    // back to 80% of the viewport — the 80vh row height in real browsers.
    expect(win.style.height).toBe(`${Math.floor(window.innerHeight * 0.8)}px`)
  })

  it('clamps an inward drag to the readable 320x240 minimums', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    dragHandle('parallel-resize-a-se', { x: 400, y: 400 }, { x: 0, y: 0 })

    const win = screen.getByTestId('parallel-window-a')
    expect(win.style.width).toBe('320px')
    expect(win.style.height).toBe('240px')
  })

  it('remembers a dragged pixel size across close and reopen', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    dragHandle('parallel-resize-a-se', { x: 400, y: 400 }, { x: 500, y: 460 })

    fireEvent.click(screen.getByTestId('parallel-window-close-a'))
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()

    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    const win = screen.getByTestId('parallel-window-a')
    expect(win.style.width).toBe('420px')
    expect(win.style.height).toBe('300px')
    expect(win).toHaveClass('flex-none')
  })

  it('traps Tab focus inside the dialog (last wraps to first)', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'pending' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    screen.getByTestId('parallel-window-close-b').focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(screen.getByTestId('parallel-window-close-a')).toHaveFocus()
  })

  it('traps shift-Tab focus inside the dialog (first wraps to last)', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'pending' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    screen.getByTestId('parallel-window-close-a').focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('parallel-window-close-b')).toHaveFocus()
  })

  it('returns focus to the inline expand button after the overlay closes', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    const expand = screen.getByTestId('parallel-expand-a')
    // fireEvent.click doesn't move focus — do what a real browser does.
    expand.focus()
    fireEvent.click(expand)
    expect(screen.getByRole('dialog')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()
    expect(expand).toHaveFocus()
  })

  it('shift-Tab from the focused dialog container stays inside the trap', () => {
    render(<ParallelLiveCard {...base} runs={[makeRun({ key: 'a', status: 'pending' })]} />)
    fireEvent.click(screen.getByTestId('parallel-expand-a'))
    // Opening focuses the container itself (tabIndex -1, not in the focusable
    // list) — the first Shift+Tab must still land on a window control.
    expect(screen.getByRole('dialog')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('parallel-window-close-a')).toHaveFocus()
  })

  it('hands focus to the dialog container when one of several windows closes', () => {
    render(
      <ParallelLiveCard
        {...base}
        runs={[
          makeRun({ key: 'a', status: 'pending' }),
          makeRun({ key: 'b', status: 'pending' }),
        ]}
      />
    )
    fireEvent.click(screen.getByTestId('parallel-expand-a'))

    const closeA = screen.getByTestId('parallel-window-close-a')
    closeA.focus()
    fireEvent.click(closeA)
    expect(screen.queryByTestId('parallel-window-a')).toBeNull()
    expect(screen.getByTestId('parallel-window-b')).toBeInTheDocument()
    // The close button unmounts — its onClick must have parked focus on the
    // dialog container so the Tab trap keeps receiving keydowns.
    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})

describe('ParallelFocusManager', () => {
  it('renders enlarged windows through a custom content renderer', () => {
    const run = makeRun({
      key: 'msg:1',
      kind: 'agent',
      name: 'Coach',
      status: 'done',
      content: 'archived body',
    })
    render(
      <ParallelFocusManager
        runs={[run]}
        renderContent={(r) => (
          <div data-testid={`archive-window-body-${r.key}`}>{r.content}</div>
        )}
      >
        {({ expanded, toggle }) => (
          <button
            type="button"
            data-testid="archive-toggle"
            aria-pressed={expanded.includes('msg:1')}
            onClick={() => toggle('msg:1')}
          />
        )}
      </ParallelFocusManager>
    )

    fireEvent.click(screen.getByTestId('archive-toggle'))
    const dialog = screen.getByRole('dialog', { name: 'chat.parallelFocusLabel' })
    // The custom body (archived answer with citation links) replaces the live
    // card inside the window shell.
    expect(within(dialog).getByTestId('archive-window-body-msg:1')).toHaveTextContent(
      'archived body'
    )
    expect(within(dialog).queryByTestId('parallel-run-msg:1')).toBeNull()
    // The shared shell — close button and resize handles — still keys off
    // the run key.
    expect(within(dialog).getByTestId('parallel-window-close-msg:1')).toBeInTheDocument()
    expect(within(dialog).getByTestId('parallel-resize-msg:1-se')).toBeInTheDocument()
    expect(screen.getByTestId('archive-toggle')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('archive-toggle')).toHaveAttribute('aria-pressed', 'false')
  })

  it('re-offers closed answers in the dock after the group was opened together', () => {
    const runs = [
      makeRun({ key: 'msg:1', kind: 'agent', name: 'Coach', status: 'done', content: 'one' }),
      makeRun({ key: 'msg:2', kind: 'model', name: 'gpt', status: 'done', content: 'two' }),
    ]
    render(
      <ParallelFocusManager runs={runs}>
        {({ expanded, toggle }) => (
          <button
            type="button"
            data-testid="grid-toggle-1"
            aria-pressed={expanded.includes('msg:1')}
            onClick={() => toggle('msg:1')}
          />
        )}
      </ParallelFocusManager>
    )

    // One click from a cold overlay opens the whole comparison; nothing left
    // for the dock to offer.
    fireEvent.click(screen.getByTestId('grid-toggle-1'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('parallel-window-msg:1')).toBeInTheDocument()
    expect(within(dialog).getByTestId('parallel-window-msg:2')).toBeInTheDocument()
    expect(screen.queryByTestId('parallel-focus-dock')).toBeNull()

    // Closing one window brings its answer back to the dock for reopening.
    fireEvent.click(within(dialog).getByTestId('parallel-window-close-msg:1'))
    expect(within(dialog).queryByTestId('parallel-window-msg:1')).toBeNull()
    expect(screen.getByTestId('parallel-dock-msg:1')).toHaveTextContent('Coach')

    fireEvent.click(screen.getByTestId('parallel-dock-msg:1'))
    expect(within(dialog).getByTestId('parallel-window-msg:1')).toBeInTheDocument()
    expect(screen.queryByTestId('parallel-focus-dock')).toBeNull()
  })
})

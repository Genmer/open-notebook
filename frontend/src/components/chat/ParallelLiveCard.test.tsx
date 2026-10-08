import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { ParallelLiveCard } from './ParallelLiveCard'
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

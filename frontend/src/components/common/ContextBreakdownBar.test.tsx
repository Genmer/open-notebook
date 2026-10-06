import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  ContextBreakdownBar,
  getRenderableSegments,
  hasContentSegments,
  segmentStyle,
} from './ContextBreakdownBar'
import type { ContextBreakdown, ContextSegmentKey } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const breakdown: ContextBreakdown = {
  total_chars: 25100,
  estimated_tokens: 6200,
  segments: [
    { key: 'system_prompt', chars: 2848, percent: 11.35, message_count: null, items: null },
    { key: 'history', chars: 5300, percent: 21.12, message_count: 12, items: null },
    { key: 'sources', chars: 15000, percent: 59.76, items: null },
    { key: 'notes', chars: 1952, percent: 7.78, items: null },
  ],
}

const emptyBreakdown: ContextBreakdown = {
  total_chars: 2848,
  estimated_tokens: 700,
  segments: [
    { key: 'system_prompt', chars: 2848, percent: 100, message_count: null, items: null },
    { key: 'history', chars: 0, percent: 0, message_count: 0, items: null },
    { key: 'sources', chars: 0, percent: 0, items: null },
    { key: 'notes', chars: 0, percent: 0, items: null },
  ],
}

describe('ContextBreakdownBar helpers', () => {
  it('hasContentSegments is false when every content segment is zero', () => {
    expect(hasContentSegments(emptyBreakdown)).toBe(false)
    expect(hasContentSegments(breakdown)).toBe(true)
  })

  it('hasContentSegments tolerates a missing segments array', () => {
    expect(hasContentSegments({ total_chars: 0, estimated_tokens: 0, segments: [] })).toBe(false)
  })

  it('getRenderableSegments returns the four known segments in bar order', () => {
    const keys = getRenderableSegments(breakdown).map(segment => segment.key)
    expect(keys).toEqual(['system_prompt', 'history', 'sources', 'notes'])
  })

  it('getRenderableSegments skips unknown keys without crashing', () => {
    const weird: ContextBreakdown = {
      total_chars: 10,
      estimated_tokens: 3,
      segments: [
        { key: 'history', chars: 10, percent: 100, items: null },
        // An older/newer backend may add segment keys; the bar ignores them.
        { key: 'future_thing' as ContextSegmentKey, chars: 5, percent: 1, items: null },
      ],
    }
    expect(getRenderableSegments(weird).map(segment => segment.key)).toEqual(['history'])
  })

  it('segmentStyle maps each key to its label and palette class', () => {
    expect(segmentStyle('system_prompt')).toEqual({
      labelKey: 'context.segmentSystem',
      barClass: 'bg-muted-foreground/40',
    })
    expect(segmentStyle('history').barClass).toBe('bg-teal')
    expect(segmentStyle('sources').barClass).toBe('bg-ctx-insights')
    expect(segmentStyle('notes').barClass).toBe('bg-gold')
  })
})

describe('ContextBreakdownBar', () => {
  it('renders the stacked bar with one span per segment sized by percent', () => {
    render(<ContextBreakdownBar breakdown={breakdown} onOpen={vi.fn()} />)

    const system = screen.getByTestId('breakdown-segment-system_prompt')
    expect(system).toHaveStyle({ flexBasis: '11.35%' })
    expect(screen.getByTestId('breakdown-segment-history')).toHaveStyle({ flexBasis: '21.12%' })
    expect(screen.getByTestId('breakdown-segment-sources')).toHaveStyle({ flexBasis: '59.76%' })
    expect(screen.getByTestId('breakdown-segment-notes')).toHaveStyle({ flexBasis: '7.78%' })
  })

  it('renders a legend entry per segment (percent key flattened by the t mock)', () => {
    render(<ContextBreakdownBar breakdown={breakdown} onOpen={vi.fn()} />)

    const sourcesLegend = screen.getByTestId('breakdown-legend-sources')
    expect(sourcesLegend.textContent).toContain('context.segmentSources')
    // The global t mock returns bare keys, so the share slot is asserted by
    // key name; the numeric value flows straight from the API percent field.
    expect(sourcesLegend.textContent).toContain('context.itemPercent')
    expect(screen.getByTestId('breakdown-legend-history').textContent).toContain('context.segmentHistory')
    expect(screen.getByTestId('breakdown-legend-notes').textContent).toContain('context.segmentNotes')
    expect(screen.getByTestId('breakdown-legend-system_prompt').textContent).toContain('context.segmentSystem')
  })

  it('exposes an accessible open affordance and forwards clicks to onOpen', () => {
    const onOpen = vi.fn()
    render(<ContextBreakdownBar breakdown={breakdown} onOpen={onOpen} />)

    const bar = screen.getByTestId('context-breakdown-bar')
    expect(bar).toHaveAttribute('aria-label', 'context.breakdownAria')

    fireEvent.click(bar)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when no content segment has chars (empty notebook)', () => {
    const { container } = render(<ContextBreakdownBar breakdown={emptyBreakdown} onOpen={vi.fn()} />)

    expect(container.querySelector('[data-testid="context-breakdown-bar"]')).toBeNull()
  })
})

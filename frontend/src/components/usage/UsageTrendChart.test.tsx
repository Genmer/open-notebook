import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// jsdom can't size ResponsiveContainer, so pin the chart primitives to plain
// stubs and assert the props they receive. XAxis applies the tick formatter
// to a probe day so label formatting is observable.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: (props: { data?: unknown[]; children?: React.ReactNode }) => (
    <div data-testid="area-chart" data-points={JSON.stringify(props.data ?? [])}>
      {props.children}
    </div>
  ),
  Area: (props: Record<string, unknown>) => (
    <div
      data-testid="area"
      data-key={String(props.dataKey)}
      data-name={String(props.name)}
      data-stroke={String(props.stroke)}
      data-fill={String(props.fill)}
      data-stack-id={String(props.stackId)}
      data-hide={String(Boolean(props.hide))}
      data-animated={String(Boolean(props.isAnimationActive))}
    />
  ),
  CartesianGrid: (props: Record<string, unknown>) => (
    <div
      data-testid="cartesian-grid"
      data-stroke={String(props.stroke)}
      data-dash={String(props.strokeDasharray)}
    />
  ),
  XAxis: (props: Record<string, unknown>) => (
    <div
      data-testid="x-axis"
      data-tick-fill={String((props.tick as { fill?: string } | undefined)?.fill ?? '')}
      data-probe-day={String(
        typeof props.tickFormatter === 'function' ? props.tickFormatter('2026-01-05') : ''
      )}
    />
  ),
  YAxis: (props: Record<string, unknown>) => (
    <div
      data-testid="y-axis"
      data-tick-fill={String((props.tick as { fill?: string } | undefined)?.fill ?? '')}
    />
  ),
  Tooltip: () => null,
}))

import UsageTrendChart, { TrendTooltip } from './UsageTrendChart'
import { assignModelColors } from './chart-shared'
import { UsageByModel, UsageDayModel } from '@/lib/types/api'

// The chart anchors its window on "today" (local), so fixture dates must be
// relative too or the window slides past them as real time moves on.
const daysAgo = (k: number) => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const byModel: UsageByModel[] = [
  { model_name: 'gpt-4o', provider: 'openai', calls: 10, input_tokens: 80, output_tokens: 40, total_tokens: 120 },
  { model_name: 'claude', provider: 'anthropic', calls: 5, input_tokens: 30, output_tokens: 20, total_tokens: 60 },
  { model_name: 'small', provider: 'openai', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 10 },
  { model_name: 'm4', provider: 'openai', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 8 },
  { model_name: 'm5', provider: 'openai', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 6 },
  { model_name: 'm6', provider: 'openai', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 4 },
]

const dailyByModel: UsageDayModel[] = [
  { day: daysAgo(1), model_name: 'gpt-4o', total_tokens: 100 },
  { day: daysAgo(0), model_name: 'claude', total_tokens: 60 },
  { day: daysAgo(0), model_name: 'm6', total_tokens: 4 },
]

const chartPoints = () =>
  JSON.parse(screen.getByTestId('area-chart').getAttribute('data-points') ?? '[]') as Array<
    Record<string, string | number>
  >

describe('UsageTrendChart', () => {
  it('shows the empty state when nothing has been recorded', () => {
    render(<UsageTrendChart days={7} dailyByModel={[]} byModel={[]} locale="en-US" />)

    expect(screen.getByText('usage.empty')).toBeInTheDocument()
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument()
  })

  it('zero-fills every day of the range and ranks model series', () => {
    render(
      <UsageTrendChart days={7} dailyByModel={dailyByModel} byModel={byModel} locale="en-US" />
    )

    // One data point per day of the range, even where no rows exist.
    const points = chartPoints()
    expect(points).toHaveLength(7)

    // Top 5 models by tokens plus an "other" series for the remainder.
    const areas = screen.getAllByTestId('area')
    expect(areas).toHaveLength(6)
    expect(areas[0]).toHaveAttribute('data-name', 'gpt-4o')
    expect(areas[1]).toHaveAttribute('data-name', 'claude')
    expect(areas[5]).toHaveAttribute('data-name', 'usage.other')

    // Gaps are zero-filled, real rows keep their (day, model) totals, and the
    // leftover model lands in "other".
    const emptyDay = points.find((p) => p.day !== daysAgo(1) && p.day !== daysAgo(0))
    expect(emptyDay).toBeDefined()
    expect(emptyDay!.s0).toBe(0)
    expect(emptyDay!.__other__).toBe(0)
    expect(points.find((p) => p.day === daysAgo(1))).toMatchObject({ s0: 100, __other__: 0 })
    expect(points.find((p) => p.day === daysAgo(0))).toMatchObject({ s0: 0, s1: 60, __other__: 4 })
  })

  it('stacks areas with token-color strokes, per-series gradients and themed chrome', () => {
    render(
      <UsageTrendChart days={7} dailyByModel={dailyByModel} byModel={byModel} locale="en-US" />
    )

    const expected = assignModelColors(['gpt-4o', 'claude', 'small', 'm4', 'm5'])
    const areas = screen.getAllByTestId('area')
    expect(areas[0]).toHaveAttribute('data-stroke', expected.get('gpt-4o'))
    expect(areas[0]).toHaveAttribute('data-fill', 'url(#grad-s0)')
    for (const area of areas) {
      expect(area).toHaveAttribute('data-stack-id', '1')
      expect(area.getAttribute('data-stroke')).toMatch(/^var\(--/)
      expect(area).toHaveAttribute('data-animated', 'true')
    }
    // "Other" keeps its neutral token color.
    expect(areas[5]).toHaveAttribute('data-stroke', 'var(--muted-foreground)')

    const grid = screen.getByTestId('cartesian-grid')
    expect(grid).toHaveAttribute('data-stroke', 'var(--border)')
    expect(grid).toHaveAttribute('data-dash', '3 3')

    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-tick-fill', 'var(--muted-foreground)')
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-tick-fill', 'var(--muted-foreground)')
  })

  it('switches the x-axis to month labels for a 90-day range', () => {
    render(
      <UsageTrendChart days={90} dailyByModel={dailyByModel} byModel={byModel} locale="en-US" />
    )

    const probe = screen.getByTestId('x-axis').getAttribute('data-probe-day') ?? ''
    expect(probe).not.toBe('01-05')
    expect(probe.toLowerCase()).toContain('26')
  })

  it('keeps day labels short when neither condition for months applies', () => {
    render(
      <UsageTrendChart days={7} dailyByModel={dailyByModel} byModel={byModel} locale="en-US" />
    )

    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-probe-day', '01-05')
  })

  it('renders a clickable legend that hides a series', () => {
    render(
      <UsageTrendChart days={7} dailyByModel={dailyByModel} byModel={byModel} locale="en-US" />
    )

    const legendButton = screen.getByRole('button', { name: /gpt-4o/ })
    expect(screen.getAllByTestId('area')[0]).toHaveAttribute('data-hide', 'false')

    fireEvent.click(legendButton)
    expect(screen.getAllByTestId('area')[0]).toHaveAttribute('data-hide', 'true')

    fireEvent.click(legendButton)
    expect(screen.getAllByTestId('area')[0]).toHaveAttribute('data-hide', 'false')
  })

  it('exposes an image role summarizing the chart', () => {
    render(
      <UsageTrendChart days={7} dailyByModel={dailyByModel} byModel={byModel} locale="en-US" />
    )

    expect(screen.getByRole('img', { name: 'usage.trendAria' })).toBeInTheDocument()
  })

  it('renders the last real data while a placeholder range switch is in flight', () => {
    const { rerender } = render(
      <UsageTrendChart days={7} dailyByModel={dailyByModel} byModel={byModel} locale="en-US" />
    )
    expect(chartPoints()).toHaveLength(7)

    // Range switches to 90 while keepPreviousData still serves the old
    // payload: the axis must stay on the previous 7-day window.
    rerender(
      <UsageTrendChart
        days={90}
        dailyByModel={[]}
        byModel={[]}
        locale="en-US"
        isPlaceholder
      />
    )
    expect(chartPoints()).toHaveLength(7)
    // The old series are still drawn, not an empty-state swap.
    expect(screen.getAllByTestId('area').length).toBeGreaterThan(0)

    // Real data for the new range arrives: everything switches at once.
    rerender(
      <UsageTrendChart
        days={90}
        dailyByModel={dailyByModel}
        byModel={byModel}
        locale="en-US"
      />
    )
    expect(chartPoints()).toHaveLength(90)
  })
})

describe('TrendTooltip', () => {
  it('totals the day and truncates nothing critical', () => {
    const { container } = render(
      <TrendTooltip
        active
        locale="en-US"
        totalLabel="Daily total"
        label={daysAgo(0)}
        payload={[
          { dataKey: 's0', name: 'gpt-4o', value: 100, color: 'var(--chart-1)' },
          { dataKey: 's1', name: 'claude', value: 60, color: 'var(--chart-2)' },
        ]}
      />
    )
    expect(container.querySelector('.max-w-xs')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('Daily total')).toBeInTheDocument()
    expect(container.textContent).toContain('160')
  })

  it('renders nothing while inactive', () => {
    const { container } = render(<TrendTooltip locale="en-US" totalLabel="x" />)
    expect(container).toBeEmptyDOMElement()
  })
})

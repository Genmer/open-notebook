import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// jsdom can't size ResponsiveContainer, so pin the chart primitives to plain
// stubs and assert the props they receive.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: (props: { data?: Array<{ name: string; value: number }>; children?: React.ReactNode; isAnimationActive?: boolean }) => (
    <div
      data-testid="pie"
      data-slices={JSON.stringify(props.data ?? [])}
      data-animated={String(Boolean(props.isAnimationActive))}
    >
      {props.children}
    </div>
  ),
  Cell: (props: { fill?: string }) => <div data-testid="cell" data-fill={props.fill} />,
  Tooltip: () => null,
}))

import UsageModelDonut, { DonutTooltip } from './UsageModelDonut'
import { assignModelColors, OTHER_COLOR } from './chart-shared'
import { UsageByModel } from '@/lib/types/api'

const byModel: UsageByModel[] = [
  { model_name: 'gpt-4o', provider: 'openai', calls: 10, input_tokens: 80, output_tokens: 40, total_tokens: 120 },
  { model_name: 'claude', provider: 'anthropic', calls: 5, input_tokens: 30, output_tokens: 20, total_tokens: 60 },
]

const slices = () =>
  JSON.parse(screen.getByTestId('pie').getAttribute('data-slices') ?? '[]') as Array<{
    name: string
    value: number
    color: string
    estimated: boolean
  }>

describe('UsageModelDonut', () => {
  it('shows the empty state when nothing has been recorded', () => {
    render(<UsageModelDonut byModel={[]} locale="en-US" />)

    expect(screen.getByText('usage.empty')).toBeInTheDocument()
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument()
  })

  it('renders the center total, animated pie and a legend with percentages', () => {
    render(<UsageModelDonut byModel={byModel} locale="en-US" />)

    // Center overlay shows the grand total with its exact value on hover.
    expect(screen.getByTitle('180')).toHaveTextContent('180')
    expect(screen.getByText('usage.totalTokens')).toBeInTheDocument()

    // Entrance animation is enabled (matchMedia mock reports no preference).
    expect(screen.getByTestId('pie')).toHaveAttribute('data-animated', 'true')

    // Slices are ranked by tokens with hash-stable token colors.
    const expected = assignModelColors(['gpt-4o', 'claude'])
    expect(slices()).toEqual([
      { color: expected.get('gpt-4o'), name: 'gpt-4o', value: 120, estimated: false },
      { color: expected.get('claude'), name: 'claude', value: 60, estimated: false },
    ])

    // Legend rows: model share as a percentage of the total.
    expect(screen.getByText('66.7%')).toBeInTheDocument()
    expect(screen.getByText('33.3%')).toBeInTheDocument()
  })

  it('marks estimated slices with ≈ in the legend', () => {
    render(
      <UsageModelDonut
        byModel={[{ ...byModel[0], estimated_tokens: 60 }, byModel[1]]}
        locale="en-US"
      />
    )

    const approx = screen.getAllByText('≈')
    expect(approx).toHaveLength(1)
    expect(approx[0].closest('li')?.textContent).toContain('gpt-4o')
  })

  it('keeps the legend percentages summing to 100% within rounding tolerance', () => {
    const thirds: UsageByModel[] = ['a', 'b', 'c'].map((name) => ({
      model_name: name,
      provider: 'p',
      calls: 1,
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 100,
    }))
    render(<UsageModelDonut byModel={thirds} locale="en-US" />)

    const pctTexts = screen.getAllByText(/%$/)
    expect(pctTexts).toHaveLength(3)
    const sum = pctTexts.reduce((acc, el) => acc + parseFloat(el.textContent ?? '0'), 0)
    // Per-entry rounding is to 0.1%, so a few tenths of drift are acceptable.
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.3)
  })

  it('merges models beyond the top 5 into an "other" slice with the neutral color', () => {
    const many: UsageByModel[] = [
      { model_name: 'm1', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 50 },
      { model_name: 'm2', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 40 },
      { model_name: 'm3', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 30 },
      { model_name: 'm4', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 20 },
      { model_name: 'm5', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 10 },
      { model_name: 'm6', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 5, estimated_tokens: 5 },
      { model_name: 'm7', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 5 },
    ]
    render(<UsageModelDonut byModel={many} locale="en-US" />)

    expect(slices()).toEqual([
      { color: expect.any(String), name: 'm1', value: 50, estimated: false },
      { color: expect.any(String), name: 'm2', value: 40, estimated: false },
      { color: expect.any(String), name: 'm3', value: 30, estimated: false },
      { color: expect.any(String), name: 'm4', value: 20, estimated: false },
      { color: expect.any(String), name: 'm5', value: 10, estimated: false },
      { color: OTHER_COLOR, name: 'usage.other', value: 10, estimated: true },
    ])
    // Every visible color comes from the token palette.
    for (const slice of slices()) {
      expect(slice.color).toMatch(/^var\(--/)
    }
  })

  it('exposes an image role summarizing the chart', () => {
    render(<UsageModelDonut byModel={byModel} locale="en-US" />)

    expect(screen.getByRole('img', { name: 'usage.modelShareAria' })).toBeInTheDocument()
  })
})

describe('DonutTooltip', () => {
  // recharts passes a single-element payload per pie sector, so the share
  // can only come from the chart total passed as a prop.
  it('shows the slice share of the chart total and the exact value', () => {
    render(
      <DonutTooltip
        active
        locale="en-US"
        total={180}
        payload={[{ name: 'gpt-4o', value: 120 }]}
      />
    )

    expect(screen.getByText('66.7%')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('falls back to 0% when no total is provided', () => {
    render(
      <DonutTooltip active locale="en-US" payload={[{ name: 'gpt-4o', value: 120 }]} />
    )

    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('renders nothing while inactive', () => {
    const { container } = render(<DonutTooltip locale="en-US" />)
    expect(container).toBeEmptyDOMElement()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import UsageSummaryStats from './UsageSummaryStats'
import { UsageSummaryResponse } from '@/lib/types/api'
import { todayLocal } from './chart-shared'

const summary = (overrides: Partial<UsageSummaryResponse> = {}): UsageSummaryResponse => ({
  totals: { calls: 12, input_tokens: 100, output_tokens: 50, total_tokens: 150, estimated_tokens: 0 },
  by_model: [],
  by_day: [
    { day: todayLocal(), calls: 2, input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    { day: '2020-01-01', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  ],
  daily_by_model: [],
  ...overrides,
})

describe('UsageSummaryStats', () => {
  it('renders the exact big number through title and aria-label', () => {
    render(<UsageSummaryStats summary={summary()} locale="en-US" />)

    const big = screen.getByTitle('150')
    expect(big).toHaveAttribute('aria-label', '150')
    expect(big).toHaveTextContent('150')
  })

  it('computes the neutral period-over-period badge for growth and decline', () => {
    const { rerender } = render(
      <UsageSummaryStats
        summary={summary({ previous_totals: { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 120 } })}
        locale="en-US"
      />
    )
    expect(screen.getByText('+25%')).toBeInTheDocument()
    expect(screen.getByText('usage.vsPrevPeriod')).toBeInTheDocument()

    rerender(
      <UsageSummaryStats
        summary={summary({ previous_totals: { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 300 } })}
        locale="en-US"
      />
    )
    expect(screen.getByText('-50%')).toBeInTheDocument()
  })

  it('falls back to "no previous period" when the baseline is missing or zero', () => {
    const { rerender } = render(<UsageSummaryStats summary={summary()} locale="en-US" />)
    expect(screen.getByText('usage.noPrevPeriod')).toBeInTheDocument()

    rerender(
      <UsageSummaryStats
        summary={summary({ previous_totals: { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 } })}
        locale="en-US"
      />
    )
    expect(screen.getByText('usage.noPrevPeriod')).toBeInTheDocument()
  })

  it('shows the estimation footnote only when estimated tokens exist', () => {
    const { rerender } = render(<UsageSummaryStats summary={summary()} locale="en-US" />)
    expect(screen.queryByText('usage.estimatedNote')).not.toBeInTheDocument()

    rerender(
      <UsageSummaryStats
        summary={summary({
          totals: { calls: 12, input_tokens: 100, output_tokens: 50, total_tokens: 150, estimated_tokens: 90 },
        })}
        locale="en-US"
      />
    )
    expect(screen.getByText('usage.estimatedNote')).toBeInTheDocument()
  })

  it('reads "today" from the local-day bucket', () => {
    render(<UsageSummaryStats summary={summary()} locale="en-US" />)

    expect(screen.getByText('usage.today')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
  })

  it('marks itself busy while serving placeholder data', () => {
    const { rerender } = render(<UsageSummaryStats summary={summary()} locale="en-US" />)
    expect(document.querySelector('[aria-busy]')).toBeNull()

    rerender(<UsageSummaryStats summary={summary()} locale="en-US" isPlaceholder />)
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy).toBeInTheDocument()
    expect(busy).toHaveAttribute('data-placeholder', 'true')
  })
})

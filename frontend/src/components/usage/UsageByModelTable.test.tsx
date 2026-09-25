import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import UsageByModelTable from './UsageByModelTable'
import { assignModelColors } from './chart-shared'
import { UsageByModel } from '@/lib/types/api'

const byModel: UsageByModel[] = [
  { model_name: 'gpt-4o', provider: 'openai', calls: 10, input_tokens: 80, output_tokens: 40, total_tokens: 120 },
  { model_name: 'claude', provider: 'anthropic', calls: 5, input_tokens: 30, output_tokens: 20, total_tokens: 60 },
]

describe('UsageByModelTable', () => {
  it('shows the empty hint when there is nothing to rank', () => {
    render(<UsageByModelTable byModel={[]} locale="en-US" />)

    expect(screen.getByText('usage.empty')).toBeInTheDocument()
  })

  it('renders one row per model with numeric columns right-aligned', () => {
    render(<UsageByModelTable byModel={byModel} locale="en-US" />)

    const rows = screen.getAllByRole('row')
    // header + 2 model rows
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('gpt-4o')

    const headerCells = within(rows[0]).getAllByRole('columnheader')
    for (const numeric of headerCells.slice(2)) {
      expect(numeric).toHaveClass('text-right')
    }
    for (const cell of within(rows[1]).getAllByRole('cell')) {
      if (cell.querySelector('.tabular-nums') || cell.classList.contains('tabular-nums')) {
        expect(cell).toHaveClass('text-right')
      }
    }
  })

  it('uses the shared row treatment: hover surface, h-12, no border on last row', () => {
    render(<UsageByModelTable byModel={byModel} locale="en-US" />)

    const bodyRows = screen.getAllByRole('row').slice(1)
    for (const row of bodyRows) {
      expect(row).toHaveClass('hover:bg-[var(--surface-raised)]', 'transition-colors', 'h-12')
    }
    expect(bodyRows[0]).toHaveClass('border-b')
    expect(bodyRows[bodyRows.length - 1]).toHaveClass('last:border-b-0')
  })

  it('scales the inline share bar against the busiest model with its stable color', () => {
    render(<UsageByModelTable byModel={byModel} locale="en-US" />)

    const bars = document.querySelectorAll('.h-1\\.5') as NodeListOf<HTMLElement>
    expect(bars.length).toBe(4) // 2 tracks + 2 fills
    const fillTop = bars[1] as HTMLElement
    const fillSecond = bars[3] as HTMLElement
    expect(fillTop.style.width).toBe('100%')
    expect(fillSecond.style.width).toBe('50%')
    expect(fillTop.style.backgroundColor).toBe(assignModelColors(['gpt-4o', 'claude']).get('gpt-4o'))
  })

  it('marks estimated models with ≈', () => {
    render(
      <UsageByModelTable
        byModel={[{ ...byModel[0], estimated_tokens: 60 }, byModel[1]]}
        locale="en-US"
      />
    )

    expect(screen.getAllByText('≈')).toHaveLength(1)
  })

  it('keeps duplicate model names on separate rows (composite keys)', () => {
    render(
      <UsageByModelTable
        byModel={[
          { model_name: 'gpt-4o', provider: 'openai', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 10 },
          { model_name: 'gpt-4o', provider: 'other', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 5 },
        ]}
        locale="en-US"
      />
    )

    expect(screen.getAllByText('gpt-4o')).toHaveLength(2)
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })
})

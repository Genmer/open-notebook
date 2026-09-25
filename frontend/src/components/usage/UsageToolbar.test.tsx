import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'

import UsageToolbar, { CALL_TYPE_CHOICES, RANGE_CHOICES } from './UsageToolbar'

// Radix Select needs pointer-capture APIs jsdom doesn't implement.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

// Radix primitives activate on pointer/mouse-down (not click) and Select
// items confirm on Enter — mirror real browser event sequences.
const openSelect = async () => {
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  await screen.findAllByRole('option')
}

describe('UsageToolbar', () => {
  it('renders the three range tabs with the active one selected', () => {
    render(<UsageToolbar days={30} onDaysChange={vi.fn()} callType="" onCallTypeChange={vi.fn()} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      RANGE_CHOICES.map(() => 'usage.lastNDays')
    )
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'usage.timeRange')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('reports range changes numerically', () => {
    const onDaysChange = vi.fn()
    render(<UsageToolbar days={7} onDaysChange={onDaysChange} callType="" onCallTypeChange={vi.fn()} />)

    fireEvent.mouseDown(screen.getAllByRole('tab')[2])
    expect(onDaysChange).toHaveBeenCalledWith(90)
  })

  it('defaults the type filter to "all" and reports concrete types', async () => {
    const onCallTypeChange = vi.fn()
    render(<UsageToolbar days={7} onDaysChange={vi.fn()} callType="" onCallTypeChange={onCallTypeChange} />)

    const trigger = screen.getByRole('combobox', { name: 'usage.filterByType' })
    expect(trigger).toHaveTextContent('usage.typeAll')

    await openSelect()
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'usage.typeAll',
      ...CALL_TYPE_CHOICES.map(({ labelKey }) => labelKey),
    ])

    fireEvent.keyDown(screen.getByRole('option', { name: 'usage.typeEmbedding' }), { key: 'Enter' })
    expect(onCallTypeChange).toHaveBeenCalledWith('embedding')
  })

  it('maps the sentinel back to an empty "all" filter', async () => {
    const onCallTypeChange = vi.fn()
    render(
      <UsageToolbar days={7} onDaysChange={vi.fn()} callType="chat" onCallTypeChange={onCallTypeChange} />
    )

    await openSelect()
    fireEvent.keyDown(screen.getByRole('option', { name: 'usage.typeAll' }), { key: 'Enter' })
    expect(onCallTypeChange).toHaveBeenCalledWith('')
  })
})

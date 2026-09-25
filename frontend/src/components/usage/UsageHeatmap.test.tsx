import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// The global setup mock returns the bare key; here we need the interpolation
// options so the aria-label composition can be asserted.
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
}))

import UsageHeatmap from './UsageHeatmap'
import { UsageByDay } from '@/lib/types/api'

// The grid anchors on "today" (local), so fixture dates must be relative too
// or the window slides past them as real time moves on.
const daysAgo = (k: number) => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const byDay: UsageByDay[] = [
  { day: daysAgo(1), calls: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  { day: daysAgo(0), calls: 2, input_tokens: 100, output_tokens: 50, total_tokens: 150 },
]

const gridCells = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[aria-label]')) as HTMLElement[]

describe('UsageHeatmap', () => {
  it('renders a gray full grid with a muted note when nothing was recorded', () => {
    const { container } = render(<UsageHeatmap byDay={[]} locale="en-US" />)

    expect(screen.getByText('usage.heatmapNoData')).toBeInTheDocument()
    const cells = gridCells(container)
    expect(cells).toHaveLength(183)
    for (const cell of cells) {
      expect(cell.getAttribute('style')).toContain('var(--muted)')
    }
  })

  it('renders a pulsing placeholder grid while loading', () => {
    const { container } = render(<UsageHeatmap byDay={byDay} locale="en-US" isLoading />)

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    // Skeleton cells carry no per-day semantics yet.
    expect(container.querySelectorAll('[aria-label]')).toHaveLength(0)
    expect(container.querySelectorAll('.h-3')).toHaveLength(183)
  })

  it('renders a full 183-day grid with accessible hover hints', () => {
    const { container } = render(<UsageHeatmap byDay={byDay} locale="en-US" />)

    // Zero-filled sequence: exactly one cell per day of the half-year window,
    // focusable and announced to screen readers via aria-label.
    const cells = gridCells(container)
    expect(cells).toHaveLength(183)
    for (const cell of cells) {
      expect(cell).toHaveAttribute('tabindex', '0')
      expect(cell.getAttribute('aria-label')).toContain('usage.heatmapCellHint')
    }

    // Recorded days carry their date and exact token count in the label.
    const hints = cells.map((cell) => cell.getAttribute('aria-label') ?? '')
    const recordedHint = hints.find((hint) => hint.includes(daysAgo(0)))
    expect(recordedHint).toBeDefined()
    expect(recordedHint).toContain('150')
    expect(hints[hints.length - 1]).toContain(daysAgo(0))
  })

  it('steps cell colors through color-mix levels of the fern token', () => {
    const { container } = render(<UsageHeatmap byDay={byDay} locale="en-US" />)

    const cells = gridCells(container)
    const peak = cells.find((cell) => cell.getAttribute('aria-label')?.includes(daysAgo(0)))
    expect(peak?.getAttribute('style')).toContain('color-mix(in srgb, var(--fern) 100%')

    const zeroCells = cells.filter(
      (cell) =>
        !cell.getAttribute('aria-label')?.includes(daysAgo(1)) &&
        !cell.getAttribute('aria-label')?.includes(daysAgo(0))
    )
    expect(zeroCells.length).toBe(181)
    for (const cell of zeroCells) {
      expect(cell.getAttribute('style')).not.toContain('var(--fern)')
      expect(cell.getAttribute('style')).toContain('var(--muted)')
    }
  })

  it('labels months above the grid and shows a less/more level legend', () => {
    const { container } = render(<UsageHeatmap byDay={byDay} locale="en-US" />)

    // A half-year window covers 6-7 distinct months.
    const labels = Array.from(
      container.querySelectorAll('span.text-\\[10px\\]')
    ) as HTMLElement[]
    const monthLabels = labels.filter((el) => el.textContent !== 'usage.less' && el.textContent !== 'usage.more')
    expect(monthLabels.length).toBeGreaterThanOrEqual(5)
    expect(monthLabels.length).toBeLessThanOrEqual(8)

    expect(screen.getByText('usage.less')).toBeInTheDocument()
    expect(screen.getByText('usage.more')).toBeInTheDocument()
    // 5 swatches between the two captions.
    const legend = container.querySelector('.mt-2')
    expect(legend?.children).toHaveLength(7)

    // The legend mirrors the color-mix ramp: darkest swatch at 100%.
    const swatches = Array.from(legend?.querySelectorAll('div') ?? [])
    expect(swatches[0].getAttribute('style')).toContain('var(--muted)')
    expect(swatches[4].getAttribute('style')).toContain('color-mix(in srgb, var(--fern) 100%')
  })

  it('stays at level 0 without crashing when every day has zero tokens', () => {
    const zeroDay: UsageByDay = {
      day: daysAgo(1),
      calls: 1,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    }
    const { container } = render(<UsageHeatmap byDay={[zeroDay]} locale="en-US" />)

    const cells = gridCells(container)
    expect(cells).toHaveLength(183)
    for (const cell of cells) {
      expect(cell.getAttribute('style')).not.toContain('var(--fern)')
    }
  })
})

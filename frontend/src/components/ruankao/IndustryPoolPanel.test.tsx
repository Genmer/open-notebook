import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndustryPoolPanel } from './IndustryPoolPanel'
import { INDUSTRY_POOL } from '@/lib/ruankao/industry-pool'

describe('IndustryPoolPanel', () => {
  it('renders every pool entry as a clickable chip (60+ entries)', () => {
    render(<IndustryPoolPanel onPickIndustry={vi.fn()} />)

    expect(INDUSTRY_POOL.length).toBeGreaterThanOrEqual(60)
    const chips = screen.getByTestId('ruankao-industry-list').querySelectorAll('button')
    expect(chips).toHaveLength(INDUSTRY_POOL.length)
  })

  it('filters the pool locally while typing', () => {
    render(<IndustryPoolPanel onPickIndustry={vi.fn()} />)

    fireEvent.change(screen.getByTestId('ruankao-industry-search'), {
      target: { value: '银行' },
    })

    const chips = screen.getByTestId('ruankao-industry-list').querySelectorAll('button')
    expect(chips).toHaveLength(4)
    expect(
      screen.getByTestId('ruankao-industry-item-银行核心系统改造')
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-industry-item-冷链物流')
    ).not.toBeInTheDocument()
  })

  it('shows the custom-industry fallback hint when nothing matches', () => {
    render(<IndustryPoolPanel onPickIndustry={vi.fn()} />)

    fireEvent.change(screen.getByTestId('ruankao-industry-search'), {
      target: { value: '不存在的行业xyz' },
    })

    expect(screen.getByTestId('ruankao-industry-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('ruankao-industry-list')).not.toBeInTheDocument()
  })

  it('emits the picked industry to the wizard channel', () => {
    const onPickIndustry = vi.fn()
    render(<IndustryPoolPanel onPickIndustry={onPickIndustry} />)

    fireEvent.click(screen.getByTestId('ruankao-industry-item-冷链物流'))

    expect(onPickIndustry).toHaveBeenCalledWith('冷链物流')
  })
})

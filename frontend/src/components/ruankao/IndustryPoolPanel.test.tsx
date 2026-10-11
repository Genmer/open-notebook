import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndustryPoolPanel } from './IndustryPoolPanel'
import { INDUSTRY_POOL, INDUSTRY_PROFILES } from '@/lib/ruankao/industry-pool'

// 局部覆盖 setup.ts 的全局 t()（回显 key）：hint/画像四键做真实插值，
// 让 hover title 断言能看到语料本体；其余键保持回显语义
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => {
    const t = (key: string, params?: { hint?: string; items?: string }) => {
      if (key === 'ruankao.industry.hintLine') return `业务特征参考：${params?.hint ?? ''}`
      if (key === 'ruankao.industry.profileFormsLine') return `常见项目形态：${params?.items ?? ''}`
      if (key === 'ruankao.industry.profileTechLine') return `典型技术栈：${params?.items ?? ''}`
      if (key === 'ruankao.industry.profileFlowsLine') return `核心业务流程：${params?.items ?? ''}`
      return key
    }
    return { t, language: 'en-US', setLanguage: vi.fn() }
  },
}))

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

  it('surfaces hint + 3 profile lines on hover for covered industries, hint-only otherwise', () => {
    render(<IndustryPoolPanel onPickIndustry={vi.fn()} />)

    for (const entry of INDUSTRY_POOL) {
      const profile = INDUSTRY_PROFILES[entry.name]
      const expected = [
        entry.name,
        `业务特征参考：${entry.hint}`,
        ...(profile
          ? [
              `常见项目形态：${profile.projectForms.join('；')}`,
              `典型技术栈：${profile.techStack.join('；')}`,
              `核心业务流程：${profile.businessFlows.join('；')}`,
            ]
          : []),
      ].join('\n')
      expect(screen.getByTestId(`ruankao-industry-item-${entry.name}`)).toHaveAttribute(
        'title',
        expected,
      )
    }
  })

  it('keeps the hint line on filtered chips', () => {
    render(<IndustryPoolPanel onPickIndustry={vi.fn()} />)

    fireEvent.change(screen.getByTestId('ruankao-industry-search'), {
      target: { value: '银行' },
    })

    expect(screen.getByTestId('ruankao-industry-item-银行核心系统改造')).toHaveAttribute(
      'title',
      expect.stringContaining('存贷汇账务处理'),
    )
  })
})

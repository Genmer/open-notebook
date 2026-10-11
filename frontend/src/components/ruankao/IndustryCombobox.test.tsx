import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { IndustryCombobox } from './IndustryCombobox'
import { INDUSTRY_POOL, INDUSTRY_PROFILES } from '@/lib/ruankao/industry-pool'

// cmdk 的 CommandList 需要 ResizeObserver，jsdom 没有实现（CreateEnvWizard.test 先例）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// jsdom 没有 scrollIntoView：cmdk 自动选中首条时会滚动选中项，崩掉整棵树（FoldersColumn.test 先例）
Element.prototype.scrollIntoView = () => {}

// Radix Popover 在 jsdom 里打不开：mock 成常开浮层，直接断言下拉条目与点选（CreateEnvWizard.test 先例）
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="industry-popover">{children}</div>
  ),
}))

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
// 受控值 harness：模拟向导里的真实用法（value + onChange）
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <IndustryCombobox id="env-mock-industry" value={value} onChange={setValue} />
}

describe('IndustryCombobox', () => {
  it('keeps a real input with maxLength 20', () => {
    render(<Harness />)

    expect(screen.getByTestId('env-mock-industry')).toHaveAttribute('maxlength', '20')
  })

  it('lists pool entries with hover titles: hint + 3 profile lines when covered, hint-only otherwise', () => {
    render(<Harness initial="银行" />)

    expect(screen.getAllByRole('option')).toHaveLength(4)
    for (const entry of INDUSTRY_POOL.filter((item) => item.name.includes('银行'))) {
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
      expect(screen.getByRole('option', { name: entry.name })).toHaveAttribute(
        'title',
        expected,
      )
    }
  })

  it('Enter picks the first pool match for 银行 (pool-order contract)', () => {
    render(<Harness />)
    const input = screen.getByTestId('env-mock-industry')

    fireEvent.change(input, { target: { value: '银行' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue('银行核心系统改造')
  })

  it('Enter with no pool match keeps the typed free text (custom fallback)', () => {
    render(<Harness />)
    const input = screen.getByTestId('env-mock-industry')

    fireEvent.change(input, { target: { value: '航天行业' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue('航天行业')
  })

  it('picking an option emits exactly its pool name', () => {
    render(<Harness initial="银行" />)
    const input = screen.getByTestId('env-mock-industry')

    fireEvent.click(screen.getByRole('option', { name: '银行统一收单平台' }))

    expect(input).toHaveValue('银行统一收单平台')
  })
})

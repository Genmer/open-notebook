import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IndustryContextCard } from './IndustryContextCard'

// 行业信息上屏（用户裁决 2026-10-11）：池内命中显示 hint + 可折叠画像，
// 池外自定义行业返回 null（调用方回落静态 helper）

const POOL_INDUSTRY = '政务服务（一网通办/一窗通）'

describe('IndustryContextCard', () => {
  it('renders nothing for a custom (out-of-pool) industry', () => {
    const { container } = render(<IndustryContextCard industry="自造行业" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty selection', () => {
    const { container } = render(<IndustryContextCard industry="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the hint line for a pooled industry', () => {
    render(<IndustryContextCard industry={POOL_INDUSTRY} />)
    expect(screen.getByTestId('env-industry-context-card-hint')).toHaveTextContent(
      'ruankao.industry.hintLine',
    )
  })

  it('toggles the profile three-liner open and closed', () => {
    render(<IndustryContextCard industry={POOL_INDUSTRY} />)
    // 默认折叠
    expect(
      screen.queryByTestId('env-industry-context-card-profile'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('env-industry-context-card-toggle'))
    const profile = screen.getByTestId('env-industry-context-card-profile')
    for (const key of [
      'ruankao.industry.profileFormsLine',
      'ruankao.industry.profileTechLine',
      'ruankao.industry.profileFlowsLine',
    ]) {
      expect(profile).toHaveTextContent(key)
    }
    fireEvent.click(screen.getByTestId('env-industry-context-card-toggle'))
    expect(
      screen.queryByTestId('env-industry-context-card-profile'),
    ).not.toBeInTheDocument()
  })
})

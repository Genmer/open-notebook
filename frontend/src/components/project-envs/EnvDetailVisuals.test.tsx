import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EnvTimeline } from './EnvTimeline'
import { StatTiles } from './StatTiles'
import { TechStackCards } from './TechStackCards'
import { accentOf } from './env-accent'
import type { TechItem } from '@/lib/utils/env-structure'

// useTranslation is mocked globally in setup.ts (t returns the key string)
const accent = accentOf('project_env:render-test')

describe('EnvTimeline', () => {
  it('renders both labels and the month badge', () => {
    render(<EnvTimeline start="2024.12" end="2025.09" months={10} accent={accent} />)
    const el = screen.getByTestId('env-detail-timeline')
    expect(el.textContent).toContain('2024.12')
    expect(el.textContent).toContain('2025.09')
    expect(el.textContent).toContain('projectEnvs.spanMonths')
  })

  it('single side → only that label, no badge; both empty → nothing', () => {
    const { rerender } = render(
      <EnvTimeline start="2024.12" end={null} months={null} accent={accent} />
    )
    expect(screen.getByTestId('env-detail-timeline').textContent).not.toContain('spanMonths')
    rerender(<EnvTimeline start={null} end={null} months={null} accent={accent} />)
    expect(screen.queryByTestId('env-detail-timeline')).not.toBeInTheDocument()
  })
})

describe('StatTiles', () => {
  it('renders static and trend tiles; trend row is role=img with aria-label', () => {
    render(
      <StatTiles
        items={[
          { value: '15', unit: '人', label: '项目团队' },
          { value: '92%', unit: '', label: '准确率', trendFrom: '78%', direction: 'up' },
        ]}
      />
    )
    expect(screen.getAllByTestId('env-detail-metric-card')).toHaveLength(1)
    const trend = screen.getByTestId('env-detail-metric-trend')
    // role=img 数值行是卡片内的 span（testid 挂在外层卡片上）
    const row = trend.querySelector('[role="img"]')
    expect(row?.getAttribute('aria-label')).toContain('projectEnvs.detailMetricTrendAria')
    expect(trend.textContent).toContain('78%')
    expect(trend.textContent).toContain('92%')
  })

  it('fewer than 2 tiles → renders nothing', () => {
    render(<StatTiles items={[{ value: '15', unit: '人', label: 'x' }]} />)
    expect(screen.queryByTestId('env-detail-metrics')).not.toBeInTheDocument()
  })
})

describe('TechStackCards', () => {
  const items: TechItem[] = Array.from({ length: 10 }, (_, i) => ({
    name: `Tech ${i + 1}`,
    version: i === 1 ? null : `${i}.0`,
    kind: 'database',
  }))

  it('shows 8 cards, "—" for missing version, +N overflow card with full names in title', () => {
    render(<TechStackCards items={items} accent={accent} narrative="narrative text" />)
    expect(screen.getAllByTestId('env-detail-tech-card')).toHaveLength(8)
    expect(screen.getByText('Tech 2').parentElement?.textContent).toContain('—')
    const overflow = screen.getByText('+2')
    expect(overflow.getAttribute('title')).toBe('Tech 9、Tech 10')
    expect(screen.getByText('narrative text')).toBeInTheDocument()
  })

  it('命中术语表的卡：title 为「完整名 + 换行 + 解释键」（t mock 返回 key 串）', () => {
    render(
      <TechStackCards
        items={[
          { name: 'Redis', version: '7.2', kind: 'cache' },
          { name: 'Google OR-Tools', version: null, kind: 'solver' },
        ]}
        accent={accent}
        narrative=""
      />
    )
    const redis = screen.getByText('Redis')
    expect(redis.getAttribute('title')).toMatch(/^Redis\n/)
    expect(redis.getAttribute('title')).toContain('projectEnvs.glossary.redis')
    const orTools = screen.getByText('Google OR-Tools')
    expect(orTools.getAttribute('title')).toMatch(/^Google OR-Tools\n/)
    expect(orTools.getAttribute('title')).toContain('projectEnvs.glossary.or-tools')
  })

  it('未命中术语表的卡：title 保持原技术名，行为不变', () => {
    render(
      <TechStackCards
        items={[{ name: 'Tech X', version: null, kind: 'other' }]}
        accent={accent}
        narrative=""
      />
    )
    expect(screen.getByText('Tech X').getAttribute('title')).toBe('Tech X')
  })

  it('overflow 卡 title 仍是纯名字列表：名字即使命中术语表也不带解释', () => {
    const many: TechItem[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        name: `Tech ${i + 1}`,
        version: null,
        kind: 'other' as const,
      })),
      { name: 'Redis', version: null, kind: 'cache' as const },
      { name: 'Kafka', version: null, kind: 'framework' as const },
    ]
    render(<TechStackCards items={many} accent={accent} narrative="" />)
    const overflowTitle = screen.getByText('+2').getAttribute('title')
    expect(overflowTitle).toBe('Redis、Kafka')
    expect(overflowTitle).not.toContain('\n')
    expect(overflowTitle).not.toContain('projectEnvs.glossary')
  })
})

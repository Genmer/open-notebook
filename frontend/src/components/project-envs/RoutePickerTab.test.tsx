import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { RoutePickerTab } from './RoutePickerTab'
import type { ProjectEnvRouteProposal } from '@/lib/types/api'

function route(overrides: Partial<ProjectEnvRouteProposal> = {}): ProjectEnvRouteProposal {
  return {
    id: 'r1',
    title: '数据中台路线',
    summary: '围绕实时数仓构建的完整路线',
    tech_stack: ['Kafka 3.6', 'Flink 1.18'],
    scale: '日增 2 亿条日志',
    role: '数据平台负责人',
    highlights: ['Exactly-Once 投递', '背压治理'],
    period: { start: '2025.02', end: '2025.09' },
    ...overrides,
  }
}

function Harness({ routes }: { routes: ProjectEnvRouteProposal[] }) {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  return (
    <RoutePickerTab
      routes={routes}
      selectedRouteId={selectedRouteId}
      onSelectedRouteChange={setSelectedRouteId}
      onSubmit={vi.fn()}
    />
  )
}

describe('RoutePickerTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selecting a route is exclusive', () => {
    render(<Harness routes={[route(), route({ id: 'r2', title: '离线路线' })]} />)

    fireEvent.click(screen.getByTestId('route-card-r1').querySelector('button')!)
    expect(screen.getByTestId('route-card-r1').className).toContain('border-fern/60')

    fireEvent.click(screen.getByTestId('route-card-r2').querySelector('button')!)
    expect(screen.getByTestId('route-card-r2').className).toContain('border-fern/60')
    expect(screen.getByTestId('route-card-r1').className).not.toContain('border-fern/60')
  })

  it('renders the three diff badges with the spec values', () => {
    render(<Harness routes={[route()]} />)

    const expectBadge = (key: string, value: string) => {
      const badge = screen.getByText(
        (_, element) => element?.textContent === `${key}: ${value}`
      )
      expect(badge).toBeDefined()
    }
    expectBadge('projectEnvs.routeDiffTech', 'Kafka 3.6 / Flink 1.18')
    expectBadge('projectEnvs.routeDiffScale', '日增 2 亿条日志')
    expectBadge('projectEnvs.routeDiffRole', '数据平台负责人')
  })

  it('expanding the preview shows full stack, highlights and period — not a six-field draft', () => {
    render(<Harness routes={[route()]} />)

    fireEvent.click(screen.getByText('projectEnvs.routePreview'))

    const stack = screen.getAllByText(/Kafka 3\.6 \/ Flink 1\.18/)
    expect(stack.length).toBeGreaterThan(1) // badge + full preview list
    expect(screen.getByText('Exactly-Once 投递')).toBeDefined()
    expect(screen.getByText('背压治理')).toBeDefined()
    expect(screen.getByText('2025.02 – 2025.09')).toBeDefined()
    expect(screen.queryByText('projectEnvs.fieldBackground')).toBeNull()
  })

  it('disables submit until a route is chosen and shows the hint', () => {
    render(<Harness routes={[route()]} />)

    const submit = screen.getByTestId('env-route-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByText('projectEnvs.routeMinHint')).toBeDefined()

    fireEvent.click(screen.getByTestId('route-card-r1').querySelector('button')!)
    expect((screen.getByTestId('env-route-submit') as HTMLButtonElement).disabled).toBe(false)
  })
})

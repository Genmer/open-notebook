import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GenerationStatusPanel } from './GenerationStatusPanel'
import type { StreamMetricsSample } from '@/lib/ruankao/stream-metrics'

// 恒等 t 不插值：本文件 mock 成「键:参数值」形态，数值断言才可见
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => {
    const t = (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0
        ? `${key}:${Object.values(params).join(',')}`
        : key
    return { t }
  },
}))

// 生成态面板（流光条 + 指标行 + 尾部滚动）：恒等 t mock 下按 testid 与
// 插值结果断言（speed/peak/elapsed/tokens 的文案键与数值都在 metrics 行内）

const SAMPLE: StreamMetricsSample = {
  tokens: 1024,
  chars: 2048,
  tail: '{"points":[{"heading":"负载均衡策略选型","detail":"…',
  speedTps: 28.4,
  peakTps: 35.2,
  elapsedMs: 42_000,
}

describe('GenerationStatusPanel', () => {
  it('renders the metrics row with interpolated values and the tail ticker', () => {
    render(
      <GenerationStatusPanel
        title="拆题·论点矩阵"
        metrics={SAMPLE}
        testId="stream-panel"
      />,
    )
    const metrics = screen.getByTestId('stream-panel-metrics')
    expect(metrics).toHaveTextContent('28.4')
    expect(metrics).toHaveTextContent('35.2')
    expect(metrics).toHaveTextContent('0:42')
    expect(metrics).toHaveTextContent('1,024')
    const tail = screen.getByTestId('stream-panel-tail')
    expect(tail.textContent).toContain('负载均衡策略选型')
    // 四个指标键全在场（缺键=文案裸键，恒等 t 下直接可见）
    for (const key of [
      'ruankao.questionBank.workbench.stream.speed',
      'ruankao.questionBank.workbench.stream.peak',
      'ruankao.questionBank.workbench.stream.elapsed',
      'ruankao.questionBank.workbench.stream.tokens',
    ]) {
      expect(metrics).toHaveTextContent(key)
    }
  })

  it('hides the tail ticker when nothing has streamed yet', () => {
    render(
      <GenerationStatusPanel
        title="拆题·论点矩阵"
        metrics={{ ...SAMPLE, tail: '' }}
        testId="stream-panel"
      />,
    )
    expect(screen.queryByTestId('stream-panel-tail')).not.toBeInTheDocument()
  })
})

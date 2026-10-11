import { describe, expect, it } from 'vitest'
import {
  MIN_SPEED_SPAN_MS,
  SPEED_WINDOW_MS,
  computeStreamMetrics,
  formatStreamElapsed,
} from './stream-metrics'

// 指标口径钉死（用户裁决 2026-10-11：不好展示数据流就展示速度/峰值/已用时；
// token = SSE delta 事件数的近似口径）

describe('computeStreamMetrics', () => {
  it('computes window speed over the last 3s and keeps peak monotonic', () => {
    const startedAt = 0
    // 0-1s：5 个 delta；1-4s：15 个 delta（其中 1-2s 内 10 个高速段）
    const deltaTimes: number[] = []
    for (let i = 0; i < 5; i += 1) deltaTimes.push(i * 200) // 0..0.8s
    for (let i = 0; i < 10; i += 1) deltaTimes.push(1000 + i * 80) // 1.0..1.72s 高速
    for (let i = 0; i < 5; i += 1) deltaTimes.push(2500 + i * 200) // 2.5..3.3s 低速
    const sample = computeStreamMetrics(
      deltaTimes,
      300,
      '尾部',
      startedAt,
      4000,
      0,
    )
    // now=4000 → 窗口 [1000,4000)：10+5=15 个 → 15/3s = 5.0 tok/s
    expect(sample.speedTps).toBe(5)
    expect(sample.tokens).toBe(20)
    expect(sample.elapsedMs).toBe(4000)
    expect(sample.peakTps).toBeGreaterThanOrEqual(sample.speedTps)
  })

  it('early samples (elapsed < 1s) report zero speed to avoid a fake opening spike', () => {
    const sample = computeStreamMetrics(
      [0, 50, 100, 150],
      8,
      '',
      0,
      200,
      0,
    )
    expect(sample.speedTps).toBe(0)
    expect(sample.peakTps).toBe(0)
    expect(sample.tokens).toBe(4)
  })

  it('divides by actual elapsed when shorter than the window (no early underestimate)', () => {
    // 1.5s 内 9 个 delta：分母 = min(3000, max(1000, 1500)) = 1500 → 6.0 tok/s
    const deltaTimes = [100, 400, 700, 900, 1000, 1150, 1250, 1400, 1480]
    const sample = computeStreamMetrics(deltaTimes, 45, '', 0, 1500, 0)
    expect(sample.speedTps).toBe(6)
  })

  it('peak only grows across samples and tail keeps the last 60 chars', () => {
    const first = computeStreamMetrics(
      Array.from({ length: 30 }, (_, i) => i * 100),
      300,
      '',
      0,
      2500,
      0,
    )
    expect(first.peakTps).toBe(first.speedTps)
    const slower = computeStreamMetrics(
      Array.from({ length: 5 }, (_, i) => 3000 + i * 100),
      350,
      '',
      0,
      6000,
      first.peakTps,
    )
    expect(slower.speedTps).toBeLessThan(first.speedTps)
    expect(slower.peakTps).toBe(first.peakTps)

    const longTail = 'x'.repeat(80) + '结尾'
    const tailSample = computeStreamMetrics([], 0, longTail, 0, 100, 0)
    expect(tailSample.tail.length).toBeLessThanOrEqual(60)
    expect(tailSample.tail.endsWith('结尾')).toBe(true)
  })

  it('exports consistent window constants', () => {
    expect(SPEED_WINDOW_MS).toBe(3000)
    expect(MIN_SPEED_SPAN_MS).toBe(1000)
  })
})

describe('formatStreamElapsed', () => {
  it('formats as m:ss under an hour', () => {
    expect(formatStreamElapsed(0)).toBe('0:00')
    expect(formatStreamElapsed(42_300)).toBe('0:42')
    expect(formatStreamElapsed(185_000)).toBe('3:05')
    expect(formatStreamElapsed(3_599_999)).toBe('59:59')
  })

  it('rolls into h:mm:ss past an hour', () => {
    expect(formatStreamElapsed(3_600_000)).toBe('1:00:00')
    expect(formatStreamElapsed(3_723_456)).toBe('1:02:03')
  })
})

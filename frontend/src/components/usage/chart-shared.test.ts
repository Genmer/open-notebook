import { describe, it, expect } from 'vitest'
import {
  CHART_COLORS,
  OTHER_COLOR,
  HEATMAP_DAYS,
  assignModelColors,
  getModelSlices,
  todayLocal,
  dateSequenceLocal,
  localTzOffsetMinutes,
} from './chart-shared'
import { UsageByModel } from '@/lib/types/api'

describe('chart-shared', () => {
  it('uses theme tokens for every palette entry (light + dark come from CSS vars)', () => {
    expect(CHART_COLORS).toHaveLength(8)
    for (const color of CHART_COLORS) {
      expect(color).toMatch(/^var\(--/)
    }
    expect(OTHER_COLOR).toBe('var(--muted-foreground)')
    expect(HEATMAP_DAYS).toBe(183)
  })

  it('keeps a model on the same color across different datasets', () => {
    const first = assignModelColors(['gpt-4o', 'claude', 'm3'])
    const second = assignModelColors(['m0', 'm1', 'gpt-4o', 'm2'])
    expect(first.get('gpt-4o')).toBe(second.get('gpt-4o'))
  })

  it('linear-probes so two colliding names never share a slot when avoidable', () => {
    const map = assignModelColors(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
    const colors = [...map.values()]
    // 9 names over 8 palette slots: the first 8 stay distinct and the ninth
    // reuses a color instead of looping forever.
    const distinct = new Set(colors.slice(0, 8))
    expect(distinct.size).toBe(8)
    expect(map.size).toBe(9)
    expect(colors[8]).toEqual(expect.any(String))
  })

  it('ranks slices, merges the tail into other, and carries estimated tokens', () => {
    const byModel: UsageByModel[] = [
      { model_name: 'gpt-4o', provider: 'openai', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 100, estimated_tokens: 40 },
      { model_name: 'claude', provider: 'anthropic', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 50 },
      { model_name: 'm3', provider: 'p', calls: 1, input_tokens: 1, output_tokens: 1, total_tokens: 10, estimated_tokens: 10 },
    ]
    const { slices, otherTotal, otherEstimated } = getModelSlices(byModel, 2)
    expect(slices.map((s) => s.name)).toEqual(['gpt-4o', 'claude'])
    expect(slices[0].estimatedTokens).toBe(40)
    expect(slices[1].estimatedTokens).toBe(0)
    expect(otherTotal).toBe(10)
    expect(otherEstimated).toBe(10)
  })

  it('builds a local-day sequence anchored on today', () => {
    const days = dateSequenceLocal(7)
    expect(days).toHaveLength(7)
    expect(days[days.length - 1]).toBe(todayLocal())
    for (const day of days) {
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    // Consecutive local calendar days, DST-safe.
    const parse = (d: string) => new Date(`${d}T00:00:00`).getTime()
    for (let i = 1; i < days.length; i++) {
      expect(parse(days[i]) - parse(days[i - 1])).toBeGreaterThan(0)
      expect(parse(days[i]) - parse(days[i - 1])).toBeLessThanOrEqual(2 * 86_400_000)
    }
  })

  it('exposes the browser tz offset in minutes with the backend sign', () => {
    expect(localTzOffsetMinutes()).toBe(-new Date().getTimezoneOffset())
    expect(Number.isInteger(localTzOffsetMinutes())).toBe(true)
  })
})

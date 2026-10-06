import { describe, it, expect } from 'vitest'
import {
  isMonth,
  monthIndex,
  nowMonth,
  shiftMonth,
  latestAllowedEnd,
  spanMonths,
  validatePeriod,
  parseMonthsFromText,
} from './project-env-time'

// Fixed "now" so R3 assertions don't drift with the calendar.
const NOW = new Date(2026, 9, 15) // 2026.10

describe('project-env-time', () => {
  it('validates YYYY.MM format', () => {
    expect(isMonth('2024.05')).toBe(true)
    expect(isMonth('2024.13')).toBe(false)
    expect(isMonth('2024.5')).toBe(false)
    expect(isMonth('')).toBe(false)
    expect(isMonth(null)).toBe(false)
  })

  it('indexes and shifts months across year boundaries', () => {
    expect(monthIndex('2024.01')).toBe(2024 * 12 + 1)
    expect(shiftMonth('2024.01', -1)).toBe('2023.12')
    expect(shiftMonth('2023.12', 1)).toBe('2024.01')
    expect(shiftMonth('2024.07', 6)).toBe('2025.01')
  })

  it('computes nowMonth and latestAllowedEnd (13 months back)', () => {
    expect(nowMonth(NOW)).toBe('2026.10')
    expect(latestAllowedEnd(NOW)).toBe('2025.09')
  })

  it('computes inclusive span', () => {
    expect(spanMonths('2024.01', '2024.06')).toBe(6)
    expect(spanMonths('2024.01', '2024.05')).toBe(5)
    expect(spanMonths('2024.01', null)).toBeNull()
  })

  it('R1: missing or inverted period blocks both modes', () => {
    expect(validatePeriod(null, '2024.06', 'real')).toEqual([
      { rule: 'R1', severity: 'block' },
    ])
    expect(validatePeriod('2024.06', '2024.01', 'mock')).toEqual([
      { rule: 'R1', severity: 'block' },
    ])
  })

  it('R2: span outside 6-10 warns for real, blocks for mock', () => {
    // 5 months
    const realShort = validatePeriod('2024.01', '2024.05', 'real', NOW)
    expect(realShort).toEqual([{ rule: 'R2', severity: 'warn', span_months: 5 }])
    const mockShort = validatePeriod('2024.01', '2024.05', 'mock', NOW)
    expect(mockShort[0].severity).toBe('block')
    // 11 months
    expect(validatePeriod('2024.01', '2024.11', 'real', NOW)[0]).toMatchObject({
      rule: 'R2',
      severity: 'warn',
    })
    // exactly 10 months is legal
    expect(validatePeriod('2024.01', '2024.10', 'real', NOW)).toEqual([])
  })

  it('R3: end newer than 13 months ago warns (real) / blocks (mock)', () => {
    // 2025.10 is only 12 months before 2026.10, span itself is fine
    const real = validatePeriod('2025.01', '2025.10', 'real', NOW)
    expect(real).toEqual([
      { rule: 'R3', severity: 'warn', latest_allowed_end: '2025.09' },
    ])
    const mock = validatePeriod('2025.01', '2025.10', 'mock', NOW)
    expect(mock[0].severity).toBe('block')
    // end exactly at the boundary (2025.09) passes
    expect(validatePeriod('2025.02', '2025.09', 'mock', NOW)).toEqual([])
  })

  it('collects multiple violations', () => {
    // 4 months ending way too late: R2 + R3 together
    const violations = validatePeriod('2026.01', '2026.04', 'mock', NOW)
    expect(violations.map((v) => v.rule)).toEqual(['R2', 'R3'])
  })

  it('parses YYYY.MM phrases from keyword text', () => {
    expect(parseMonthsFromText('MES 2023.05 到 2024.01 上线')).toEqual([
      '2023.05',
      '2024.01',
    ])
    expect(parseMonthsFromText('汽车零部件、MES、高并发质检')).toEqual([])
    expect(parseMonthsFromText('2023.13 不是合法月份')).toEqual([])
  })
})

// Mirror of open_notebook/domain/project_env_rules.py (R1-R3) so the form can
// validate as the user types with the exact same verdicts the API enforces.

export const MIN_SPAN_MONTHS = 6
export const MAX_SPAN_MONTHS = 10
export const MIN_END_AGE_MONTHS = 13

const MONTH_RE = /^\d{4}\.(?:0[1-9]|1[0-2])$/

export type ProjectEnvMode = 'real' | 'mock'

export interface TimeViolation {
  rule: 'R1' | 'R2' | 'R3'
  severity: 'warn' | 'block'
  span_months?: number
  latest_allowed_end?: string
}

export function isMonth(value: string | null | undefined): boolean {
  return !!value && MONTH_RE.test(value)
}

export function monthIndex(value: string): number {
  const [year, month] = value.split('.')
  return Number(year) * 12 + Number(month)
}

export function nowMonth(now: Date = new Date()): string {
  return `${now.getFullYear().toString().padStart(4, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(month: string, delta: number): string {
  const idx = monthIndex(month) + delta
  const [year, rest] = divmod(idx - 1, 12)
  return `${year.toString().padStart(4, '0')}.${String(rest + 1).padStart(2, '0')}`
}

function divmod(a: number, b: number): [number, number] {
  return [Math.floor(a / b), ((a % b) + b) % b]
}

export function latestAllowedEnd(now: Date = new Date()): string {
  return shiftMonth(nowMonth(now), -MIN_END_AGE_MONTHS)
}

export function spanMonths(
  start: string | null | undefined,
  end: string | null | undefined
): number | null {
  if (!isMonth(start) || !isMonth(end)) return null
  return monthIndex(end as string) - monthIndex(start as string) + 1
}

export function validatePeriod(
  start: string | null | undefined,
  end: string | null | undefined,
  mode: ProjectEnvMode,
  now: Date = new Date()
): TimeViolation[] {
  const violations: TimeViolation[] = []

  if (!isMonth(start) || !isMonth(end)) {
    return [{ rule: 'R1', severity: 'block' }]
  }
  const startS = start as string
  const endS = end as string
  if (monthIndex(endS) < monthIndex(startS)) {
    return [{ rule: 'R1', severity: 'block' }]
  }

  const warnOrBlock = mode === 'real' ? 'warn' : 'block'
  const span = monthIndex(endS) - monthIndex(startS) + 1
  if (span < MIN_SPAN_MONTHS || span > MAX_SPAN_MONTHS) {
    violations.push({ rule: 'R2', severity: warnOrBlock, span_months: span })
  }

  const latestEnd = latestAllowedEnd(now)
  if (monthIndex(nowMonth(now)) - monthIndex(endS) < MIN_END_AGE_MONTHS) {
    violations.push({
      rule: 'R3',
      severity: warnOrBlock,
      latest_allowed_end: latestEnd,
    })
  }
  return violations
}

// Mock wizard: prefill the picker from YYYY.MM phrases found in the keywords
// text; once the user touches the picker it wins over any later re-parse.
const KEYWORD_MONTH_RE = /\b(\d{4})\.(0[1-9]|1[0-2])\b/g

export function parseMonthsFromText(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(KEYWORD_MONTH_RE)) {
    found.push(`${match[1]}.${match[2]}`)
  }
  return found
}

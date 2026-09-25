import { useEffect, useState } from 'react'
import { UsageByModel } from '@/lib/types/api'

// Theme-token palette (globals.css maps --chart-1..5 to owned hues; mauve,
// sage, violet are extra owned hues). var() references re-resolve in dark
// mode automatically — never hardcode hex values here.
export const CHART_COLORS = [
  'var(--chart-1)', // fern
  'var(--chart-2)', // teal
  'var(--chart-3)', // gold
  'var(--chart-4)', // plum
  'var(--chart-5)', // slate
  'var(--mauve)',
  'var(--sage)',
  'var(--violet)',
]

export const OTHER_COLOR = 'var(--muted-foreground)'

// Single source for the heatmap window; the page fetches exactly this many days.
export const HEATMAP_DAYS = 183

export interface ModelSlice {
  name: string
  totalTokens: number
  estimatedTokens: number
  color: string
}

// djb2 — deterministic per name, so a model keeps its color across ranges,
// refreshes and charts.
function hashName(name: string): number {
  let hash = 5381
  for (let i = 0; i < name.length; i++) {
    hash = (((hash << 5) + hash + name.charCodeAt(i)) >>> 0) || 0
  }
  return hash
}

// Assign palette colors by name hash; on a collision linear-probe to the next
// free slot so visible series stay distinguishable. Once the palette is
// exhausted the base slot is reused (names then share a color).
export function assignModelColors(names: string[]): Map<string, string> {
  const taken = new Set<number>()
  const map = new Map<string, string>()
  for (const name of names) {
    if (map.has(name)) continue
    const base = hashName(name) % CHART_COLORS.length
    let index = base
    let probes = 0
    while (taken.has(index) && probes < CHART_COLORS.length) {
      index = (index + 1) % CHART_COLORS.length
      probes++
    }
    if (probes === CHART_COLORS.length) index = base
    taken.add(index)
    map.set(name, CHART_COLORS[index])
  }
  return map
}

// Top-N models by tokens, the rest merged into "other". Colors come from the
// hash mapping, so the same model resolves to the same color everywhere.
export function getModelSlices(
  byModel: UsageByModel[],
  topN = 5
): { slices: ModelSlice[]; otherTotal: number; otherEstimated: number } {
  const sorted = [...byModel].sort(
    (a, b) => (b.total_tokens ?? 0) - (a.total_tokens ?? 0)
  )
  const colors = assignModelColors(sorted.slice(0, topN).map((m) => m.model_name ?? '-'))
  const slices = sorted.slice(0, topN).map((m) => ({
    name: m.model_name ?? '-',
    totalTokens: m.total_tokens ?? 0,
    estimatedTokens: m.estimated_tokens ?? 0,
    color: colors.get(m.model_name ?? '-') ?? CHART_COLORS[0],
  }))
  const rest = sorted.slice(topN)
  const otherTotal = rest.reduce((sum, m) => sum + (m.total_tokens ?? 0), 0)
  const otherEstimated = rest.reduce((sum, m) => sum + (m.estimated_tokens ?? 0), 0)
  return { slices, otherTotal, otherEstimated }
}

export function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

const pad2 = (n: number) => String(n).padStart(2, '0')

const toLocalDay = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

// Aggregates are requested with the browser's tz offset, so day keys are
// local days — anchor the window on the local "today" to match.
export function todayLocal(): string {
  return toLocalDay(new Date())
}

export function dateSequenceLocal(days: number): string[] {
  const now = new Date()
  const dates: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    dates.push(toLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)))
  }
  return dates
}

// Browser offset from UTC in minutes (e.g. UTC+8 → 480), matching the
// backend's tz_offset summary parameter.
export function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

// recharts entrance animations off when the user asks for reduced motion.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

import { UsageSummaryResponse } from '@/lib/types/api'
import { todayLocal } from './chart-shared'

export interface UsageExportInput {
  summary: UsageSummaryResponse
  days: number
  callType: string
}

// RFC 4180: quote a cell when it contains a separator, quote or newline, and
// double embedded quotes. Cells starting with =/+/-/@ are prefixed with a `'`
// so spreadsheet apps treat them as text instead of formulas.
function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',')
}

// Three sections in one file: totals, per-model rows, per-day rows, each
// behind a `# section` marker; filters and timestamp lead the file.
export function buildUsageCsv({ summary, days, callType }: UsageExportInput): string {
  const lines: string[] = []
  const stamp = new Date().toISOString()
  lines.push(`# generated_at=${stamp}`, `# days=${days}`, `# call_type=${callType || 'all'}`)
  lines.push('# Totals')
  lines.push(csvRow(['calls', 'input_tokens', 'output_tokens', 'total_tokens', 'estimated_tokens']))
  lines.push(
    csvRow([
      summary.totals.calls,
      summary.totals.input_tokens,
      summary.totals.output_tokens,
      summary.totals.total_tokens,
      summary.totals.estimated_tokens ?? 0,
    ])
  )
  lines.push('')
  lines.push('# By model')
  lines.push(
    csvRow(['model', 'provider', 'calls', 'input_tokens', 'output_tokens', 'total_tokens', 'estimated_tokens'])
  )
  for (const row of summary.by_model) {
    lines.push(
      csvRow([
        row.model_name,
        row.provider,
        row.calls,
        row.input_tokens,
        row.output_tokens,
        row.total_tokens,
        row.estimated_tokens ?? 0,
      ])
    )
  }
  lines.push('')
  lines.push('# By day')
  lines.push(csvRow(['day', 'calls', 'input_tokens', 'output_tokens', 'total_tokens']))
  for (const row of summary.by_day) {
    lines.push(
      csvRow([row.day, row.calls, row.input_tokens, row.output_tokens, row.total_tokens])
    )
  }
  // BOM so spreadsheet apps decode UTF-8 model names correctly.
  return `\uFEFF${lines.join('\n')}\n`
}

export function buildUsageJson({ summary, days, callType }: UsageExportInput): string {
  return JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      filters: { days, call_type: callType || null },
      totals: summary.totals,
      previous_totals: summary.previous_totals ?? null,
      by_model: summary.by_model,
      by_day: summary.by_day,
      daily_by_model: summary.daily_by_model,
    },
    null,
    2
  )
}

export function usageExportFilename(ext: 'csv' | 'json'): string {
  return `usage-${todayLocal()}.${ext}`
}

export function downloadUsageFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

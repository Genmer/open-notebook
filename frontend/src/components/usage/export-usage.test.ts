import { describe, it, expect, vi } from 'vitest'

import {
  buildUsageCsv,
  buildUsageJson,
  usageExportFilename,
  downloadUsageFile,
} from './export-usage'
import { UsageSummaryResponse } from '@/lib/types/api'
import { todayLocal } from './chart-shared'

const summary: UsageSummaryResponse = {
  totals: { calls: 3, input_tokens: 110, output_tokens: 55, total_tokens: 165, estimated_tokens: 90 },
  previous_totals: { calls: 1, input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  by_model: [
    {
      model_name: 'gpt-4o, mini',
      provider: 'openai',
      calls: 2,
      input_tokens: 80,
      output_tokens: 40,
      total_tokens: 120,
      estimated_tokens: 60,
    },
    { model_name: 'claude "opus"', provider: 'anthropic', calls: 1, input_tokens: 30, output_tokens: 15, total_tokens: 45 },
  ],
  by_day: [{ day: '2026-09-20', calls: 3, input_tokens: 110, output_tokens: 55, total_tokens: 165 }],
  daily_by_model: [{ day: '2026-09-20', model_name: 'gpt-4o, mini', total_tokens: 120 }],
}

describe('export-usage', () => {
  it('builds a three-section CSV with escaped cells and a BOM', () => {
    const csv = buildUsageCsv({ summary, days: 30, callType: '' })

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('# Totals')
    expect(csv).toContain('# By model')
    expect(csv).toContain('# By day')
    expect(csv).toContain('# call_type=all')

    // Commas and quotes are escaped per RFC 4180.
    expect(csv).toContain('"gpt-4o, mini"')
    expect(csv).toContain('"claude ""opus"""')
    // Totals row carries the estimation column.
    expect(csv).toContain('3,110,55,165,90')
  })

  it('records the active call-type filter in the CSV header', () => {
    const csv = buildUsageCsv({ summary, days: 7, callType: 'embedding' })

    expect(csv).toContain('# days=7')
    expect(csv).toContain('# call_type=embedding')
  })

  it('neutralizes formula-leading cells so spreadsheets read them as text', () => {
    const csv = buildUsageCsv({
      summary: {
        ...summary,
        by_model: [
          {
            model_name: '=HYPERLINK("http://evil","x")',
            provider: '@cmd',
            calls: 1,
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 3,
          },
          { ...summary.by_model[1], model_name: '-2+3|cmd' },
          { ...summary.by_model[1], model_name: '+SUM(A1)' },
        ],
      },
      days: 30,
      callType: '',
    })

    // A leading `'` defuses formula interpretation; quoting still applies.
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""x"")"')
    expect(csv).toContain(',\'@cmd,')
    expect(csv).toContain('\'-2+3|cmd,')
    expect(csv).toContain('\'+SUM(A1),')
  })

  it('builds a JSON envelope with filters, totals and both breakdowns', () => {
    const parsed = JSON.parse(buildUsageJson({ summary, days: 30, callType: 'chat' }))

    expect(parsed.filters).toEqual({ days: 30, call_type: 'chat' })
    expect(parsed.totals.total_tokens).toBe(165)
    expect(parsed.previous_totals.total_tokens).toBe(15)
    expect(parsed.by_model).toHaveLength(2)
    expect(parsed.by_day[0].day).toBe('2026-09-20')
    expect(parsed.daily_by_model).toHaveLength(1)
    expect(typeof parsed.generated_at).toBe('string')
  })

  it('names files after the local calendar day', () => {
    expect(usageExportFilename('csv')).toBe(`usage-${todayLocal()}.csv`)
    expect(usageExportFilename('json')).toBe(`usage-${todayLocal()}.json`)
  })

  it('downloads via a Blob URL and cleans it up', () => {
    const revoke = vi.fn()
    const url = 'blob:mock-url'
    URL.createObjectURL = vi.fn(() => url)
    URL.revokeObjectURL = revoke

    downloadUsageFile('hello', 'usage-x.csv', 'text/csv')

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith(url)
  })
})

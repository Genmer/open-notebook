import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Radix Select needs pointer-capture APIs jsdom doesn't implement.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Charts are covered by their own component tests; mock them so this suite
// stays focused on the page structure.
vi.mock('@/components/usage/UsageTrendChart', () => ({
  default: () => <div data-testid="trend-chart" />,
}))
vi.mock('@/components/usage/UsageModelDonut', () => ({
  default: () => <div data-testid="model-donut" />,
}))
vi.mock('@/components/usage/UsageHeatmap', () => ({
  default: () => <div data-testid="heatmap" />,
}))

const mockUpdateSettings = { mutate: vi.fn(), isPending: false }
vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: vi.fn(),
  useUpdateSettings: vi.fn(() => mockUpdateSettings),
}))

const mockSummary = vi.fn()
const mockRecords = vi.fn()
const mockClear = vi.fn(() => ({ mutate: vi.fn(), isPending: false }))
vi.mock('@/lib/hooks/use-usage', () => ({
  useUsageSummary: (...args: unknown[]) => mockSummary(...args),
  useUsageRecords: (...args: unknown[]) => mockRecords(...args),
  useClearUsage: () => mockClear(),
}))

const mockDownload = vi.fn()
vi.mock('@/components/usage/export-usage', () => ({
  buildUsageCsv: vi.fn(() => 'csv-content'),
  buildUsageJson: vi.fn(() => 'json-content'),
  usageExportFilename: vi.fn(() => 'usage-fixture.csv'),
  downloadUsageFile: (...args: unknown[]) => mockDownload(...args),
}))

import UsagePage from './page'
import { useSettings } from '@/lib/hooks/use-settings'
import { UsageRecordsResponse, UsageSummaryResponse } from '@/lib/types/api'

const summaryData: UsageSummaryResponse = {
  totals: { calls: 12, input_tokens: 100, output_tokens: 50, total_tokens: 150, estimated_tokens: 40 },
  previous_totals: { calls: 4, input_tokens: 40, output_tokens: 20, total_tokens: 60 },
  by_model: [
    {
      model_name: 'gpt-4o',
      provider: 'openai',
      calls: 10,
      input_tokens: 80,
      output_tokens: 40,
      total_tokens: 120,
      estimated_tokens: 40,
    },
  ],
  by_day: [{ day: '2026-09-20', calls: 12, input_tokens: 100, output_tokens: 50, total_tokens: 150 }],
  daily_by_model: [
    { day: '2026-09-20', model_name: 'gpt-4o', total_tokens: 120 },
  ],
}

const emptySummary: UsageSummaryResponse = {
  totals: { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  by_model: [],
  by_day: [],
  daily_by_model: [],
}

const emptyRecords: UsageRecordsResponse = { total: 0, records: [] }

const recordsData: UsageRecordsResponse = {
  total: 3,
  records: [
    {
      id: 'model_usage:1',
      created: '2026-09-20T10:00:00Z',
      day: '2026-09-20',
      model_name: 'gpt-4o',
      provider: 'openai',
      call_type: 'chat',
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      is_estimated: false,
      success: true,
      error: null,
    },
  ],
}

function mockHooks({
  settings = { usage_tracking_enabled: true },
  summary = summaryData,
  records = recordsData,
  summaryExtras = {},
  recordsExtras = {},
}: {
  settings?: { usage_tracking_enabled: boolean }
  summary?: UsageSummaryResponse | null
  records?: UsageRecordsResponse | null
  summaryExtras?: Record<string, unknown>
  recordsExtras?: Record<string, unknown>
} = {}) {
  ;(mockSummary as ReturnType<typeof vi.fn>).mockReturnValue({
    data: summary,
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
    ...summaryExtras,
  })
  ;(mockRecords as ReturnType<typeof vi.fn>).mockReturnValue({
    data: records,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...recordsExtras,
  })
  ;(useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: settings,
    isLoading: false,
  })
}

describe('UsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSettings.mutate.mockClear()
    mockDownload.mockClear()
  })

  it('renders header, toolbar, dashboard charts and both tables in tabs', () => {
    mockHooks()
    render(<UsagePage />)

    expect(screen.getByText('usage.title')).toBeInTheDocument()
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument()
    expect(screen.getByTestId('model-donut')).toBeInTheDocument()
    expect(screen.getByTestId('heatmap')).toBeInTheDocument()

    // Both tables live behind one Tabs card; by-model is the default pane.
    expect(screen.getByRole('tab', { name: 'usage.byModel' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'usage.records' })).toBeInTheDocument()
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0)
    expect(screen.queryByText('chat')).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'usage.records' }))
    expect(screen.getByText('chat')).toBeInTheDocument()
  })

  it('requests summary, heatmap and records with the filter and tz context', () => {
    mockHooks()
    render(<UsagePage />)

    expect(mockSummary).toHaveBeenCalledWith(30, '', expect.any(Number))
    expect(mockSummary).toHaveBeenCalledWith(183, '', expect.any(Number))
    expect(mockRecords).toHaveBeenCalledWith(100, 0, '')
  })

  it('switches the summary time range from the toolbar tabs', () => {
    mockHooks()
    render(<UsagePage />)

    const tabs = screen.getAllByRole('tab').filter((tab) =>
      tab.closest('[role="tablist"]')?.getAttribute('aria-label') === 'usage.timeRange'
    )
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'usage.lastNDays',
      'usage.lastNDays',
      'usage.lastNDays',
    ])
    fireEvent.mouseDown(tabs[2])
    expect(mockSummary).toHaveBeenCalledWith(90, '', expect.any(Number))
  })

  it('shows the page skeleton while the first load is in flight', () => {
    mockHooks({
      summary: null,
      records: null,
      summaryExtras: { isLoading: true },
      recordsExtras: { isLoading: true },
    })
    render(<UsagePage />)

    expect(screen.getByTestId('usage-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument()
  })

  it('renders the error state and retries both queries', () => {
    const summaryRefetch = vi.fn()
    const recordsRefetch = vi.fn()
    mockHooks({
      summary: null,
      summaryExtras: { isError: true, refetch: summaryRefetch },
      recordsExtras: { refetch: recordsRefetch },
    })
    render(<UsagePage />)

    expect(screen.getByTestId('usage-error')).toBeInTheDocument()
    expect(screen.getByText('usage.errorTitle')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'usage.retry' }))
    expect(summaryRefetch).toHaveBeenCalledTimes(1)
    expect(recordsRefetch).toHaveBeenCalledTimes(1)
  })

  it('shows a single guided empty state (privacy card kept) when nothing was recorded', () => {
    mockHooks({ summary: emptySummary, records: emptyRecords })
    render(<UsagePage />)

    expect(screen.getByText('usage.emptyTitle')).toBeInTheDocument()
    expect(screen.getByText('usage.emptyDesc')).toBeInTheDocument()
    // Charts and toolbar are gone; the tracking switch stays reachable.
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'usage.trackingEnabled' })).toBeInTheDocument()
  })

  it('keeps the toolbar and a reset action when the range is empty but half-year history exists', () => {
    ;(mockSummary as ReturnType<typeof vi.fn>).mockImplementation((days: number) => ({
      data: days === 183 ? summaryData : emptySummary,
      isLoading: false,
      isError: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    }))
    ;(mockRecords as ReturnType<typeof vi.fn>).mockReturnValue({
      data: emptyRecords,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
    ;(useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { usage_tracking_enabled: true },
      isLoading: false,
    })
    render(<UsagePage />)

    // Filtered empty state, not the full-page guide.
    expect(screen.getByText('usage.filteredEmptyTitle')).toBeInTheDocument()
    expect(screen.queryByText('usage.emptyTitle')).not.toBeInTheDocument()
    // The toolbar survives so the user can still change the range or type.
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByTestId('heatmap')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'usage.resetFilters' })).toBeInTheDocument()
  })

  it('recovers from a call-type filter with no records via the reset button', async () => {
    mockHooks()
    ;(mockSummary as ReturnType<typeof vi.fn>).mockImplementation(
      (_days: number, callType: string) => ({
        data: callType === 'embedding' ? emptySummary : summaryData,
        isLoading: false,
        isError: false,
        isPlaceholderData: false,
        refetch: vi.fn(),
      })
    )
    render(<UsagePage />)

    expect(screen.getByTestId('trend-chart')).toBeInTheDocument()

    // Switch the type filter to embedding (no records) through the toolbar.
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'usage.filterByType' }), {
      key: 'Enter',
    })
    fireEvent.keyDown(await screen.findByRole('option', { name: 'usage.typeEmbedding' }), {
      key: 'Enter',
    })

    // The toolbar stays reachable instead of a dead-end empty page.
    expect(screen.getByText('usage.filteredEmptyTitle')).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()

    // One click restores the unfiltered dashboard.
    fireEvent.click(screen.getByRole('button', { name: 'usage.resetFilters' }))
    expect(mockSummary).toHaveBeenCalledWith(30, '', expect.any(Number))
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument()
  })

  it('dims the page while a range switch serves placeholder data', () => {
    mockHooks({ summaryExtras: { isPlaceholderData: true } })
    render(<UsagePage />)

    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('exports the current summary as CSV and JSON from the header menu', () => {
    mockHooks()
    render(<UsagePage />)

    // jsdom pointer events don't reach Radix's open path; Enter does.
    const trigger = screen.getByRole('button', { name: 'usage.exportButton' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'usage.exportCsv' }))
    expect(mockDownload).toHaveBeenCalledWith(
      'csv-content',
      'usage-fixture.csv',
      'text/csv;charset=utf-8'
    )

    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'usage.exportJson' }))
    expect(mockDownload).toHaveBeenCalledWith(
      'json-content',
      'usage-fixture.csv',
      'application/json;charset=utf-8'
    )
  })

  it('loads more records in +100 steps through the records hook', () => {
    mockHooks()
    render(<UsagePage />)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'usage.records' }))
    // total=3 > shown=1, so the button is visible and grows the limit.
    fireEvent.click(screen.getByRole('button', { name: 'usage.loadMore' }))
    expect(mockRecords).toHaveBeenLastCalledWith(200, 0, '')
  })

  it('wires the tracking switch to the update mutation', () => {
    mockHooks()
    render(<UsagePage />)

    const toggle = screen.getByRole('checkbox', { name: 'usage.trackingEnabled' })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)
    expect(mockUpdateSettings.mutate).toHaveBeenCalledWith({ usage_tracking_enabled: false })
  })

  it('asks for confirmation before clearing usage data and clears on confirm', () => {
    const mutateSpy = vi.fn()
    ;(mockClear as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: mutateSpy,
      isPending: false,
    })
    mockHooks()
    render(<UsagePage />)

    fireEvent.click(screen.getByRole('button', { name: 'usage.clear' }))

    // Confirmation dialog must appear before anything is deleted.
    expect(screen.getByText('usage.clearConfirmTitle')).toBeInTheDocument()
    expect(mutateSpy).not.toHaveBeenCalled()

    // Two buttons share the label (trigger + confirm action): pick the dialog one.
    const confirmButtons = screen.getAllByRole('button', { name: 'usage.clear' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(mutateSpy).toHaveBeenCalledTimes(1)
  })

  it('does not clear usage data when the confirmation is cancelled', () => {
    const mutateSpy = vi.fn()
    ;(mockClear as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: mutateSpy,
      isPending: false,
    })
    mockHooks()
    render(<UsagePage />)

    fireEvent.click(screen.getByRole('button', { name: 'usage.clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(mutateSpy).not.toHaveBeenCalled()
  })
})

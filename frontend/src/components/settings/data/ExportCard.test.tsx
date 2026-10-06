import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// useTranslation is mocked globally in setup.ts (t returns the key string).

const mockUseExportStatus = vi.fn()
const mockStartExport = vi.fn()
const mockDeletePackage = vi.fn()
const mockUseExportEstimate = vi.fn()
vi.mock('@/lib/hooks/use-data-transfer', () => ({
  useExportStatus: (...args: unknown[]) => mockUseExportStatus(...args),
  useStartExport: () => mockStartExport(),
  useDeleteExportPackage: () => mockDeletePackage(),
  useExportEstimate: (...args: unknown[]) => mockUseExportEstimate(...args),
}))

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => mockUseNotebooks(),
}))
const mockUseNotebooks = vi.fn()

// downloadExport touches the DOM/network; the rest of the module is types only.
vi.mock('@/lib/api/dataTransfer', () => ({
  dataTransferApi: {
    downloadExport: vi.fn().mockResolvedValue(undefined),
  },
}))

// TaskLiveInspector polls live progress; never let it hit the network here.
vi.mock('@/lib/api/tasks', () => ({
  tasksApi: {
    getLiveProgress: vi.fn().mockResolvedValue(null),
  },
}))

import { ExportCard } from './ExportCard'
import { dataTransferApi } from '@/lib/api/dataTransfer'
import type { ExportStatusResponse } from '@/lib/api/dataTransfer'

const mutateSpy = vi.fn()
const deleteSpy = vi.fn()

function mockStatus(data?: ExportStatusResponse) {
  mockUseExportStatus.mockReturnValue({ data })
  mockStartExport.mockReturnValue({ mutate: mutateSpy, isPending: false })
  mockDeletePackage.mockReturnValue({ mutate: deleteSpy, isPending: false })
  mockUseExportEstimate.mockReturnValue({ data: undefined, isFetching: false })
  mockUseNotebooks.mockReturnValue({
    data: [{ id: 'notebook:n1', name: 'Research' }],
  })
}

function indicatorStyle(): string | undefined {
  const indicator = document.querySelector('[data-slot="progress-indicator"]')
  return indicator?.getAttribute('style') ?? undefined
}

function radio(value: string): HTMLElement {
  const item = document.querySelector(`button[role="radio"][value="${value}"]`)
  if (!item) throw new Error(`radio ${value} not found`)
  return item as HTMLElement
}

function checkbox(): HTMLElement {
  const item = document.querySelector('button[role="checkbox"]')
  if (!item) throw new Error('include-models checkbox not found')
  return item as HTMLElement
}

function openStartDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.start' }))
  expect(screen.getByText('dataManagement.export.confirmTitle')).toBeInTheDocument()
  expect(mutateSpy).not.toHaveBeenCalled()
  const buttons = screen.getAllByRole('button', { name: 'dataManagement.export.start' })
  return buttons[buttons.length - 1]
}

describe('ExportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateSpy.mockClear()
    deleteSpy.mockClear()
  })

  it('renders the idle state with a confirmation gate before starting', () => {
    mockStatus({ status: 'none' })
    render(<ExportCard />)

    expect(screen.getByText('dataManagement.export.title')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.export.idle')).toBeInTheDocument()

    openStartDialog()
    // Defaults: full scope with the include-models checkbox, no warning.
    expect(radio('full').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('dataManagement.export.apiKeyWarning')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('defaults to a full export and only includes models when checked', () => {
    mockStatus({ status: 'none' })
    render(<ExportCard />)

    let confirm = openStartDialog()
    fireEvent.click(confirm)
    expect(mutateSpy).toHaveBeenNthCalledWith(1, {
      scope: 'full',
      include_models: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.start' }))
    fireEvent.click(checkbox())
    expect(screen.getByText('dataManagement.export.apiKeyWarning')).toBeInTheDocument()
    confirm = screen.getAllByRole('button', { name: 'dataManagement.export.start' }).pop()!
    fireEvent.click(confirm)
    expect(mutateSpy).toHaveBeenNthCalledWith(2, {
      scope: 'full',
      include_models: true,
    })
  })

  it('shows the plain-text API key warning in models-only mode', () => {
    mockStatus({ status: 'none' })
    render(<ExportCard />)

    openStartDialog()
    expect(screen.queryByText('dataManagement.export.apiKeyWarning')).not.toBeInTheDocument()

    fireEvent.click(radio('models'))
    expect(screen.getByText('dataManagement.export.apiKeyWarning')).toBeInTheDocument()
    // The include-models checkbox only applies to the full scope.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    const confirm = screen.getAllByRole('button', { name: 'dataManagement.export.start' }).pop()!
    fireEvent.click(confirm)
    expect(mutateSpy).toHaveBeenCalledWith({ scope: 'models', include_models: false })
  })

  it('renders progress with the current stage highlighted, x/y message and percent', () => {    mockStatus({
      status: 'running',
      progress: {
        stage: 'exporting_embeddings',
        percent: 72,
        message: 'Exporting embeddings (100/5812)',
        detail: { current: 100, total: 5812 },
        stages: {
          copying_files: { current: 41, total: 41, item: 'report.pdf' },
          exporting_embeddings: { current: 100, total: 5812 },
        },
      },
    })
    render(<ExportCard />)

    // Structured detail wins: the activity line renders the localized template
    expect(screen.getByText('dataManagement.activity.exportingEmbeddings')).toBeInTheDocument()
    // Finished file stage keeps its result stat on the row
    expect(screen.getByText('dataManagement.activity.statFiles')).toBeInTheDocument()
    // Current stage row shows live x/y
    expect(screen.getByText('100/5812')).toBeInTheDocument()
    // All five stage labels are listed
    expect(screen.getByText('dataManagement.export.stages.collecting')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.export.stages.exporting_tables')).toBeInTheDocument()
    expect(screen.getAllByText('dataManagement.export.stages.copying_files').length).toBeGreaterThan(0)
    expect(screen.getByText('dataManagement.export.stages.exporting_embeddings')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.export.stages.packaging')).toBeInTheDocument()
    // The current stage row is the highlighted one
    const currentRow = screen
      .getByText('dataManagement.export.stages.exporting_embeddings')
      .closest('li')
    expect(currentRow?.className).toContain('bg-muted')
    // Percent reaches the progress indicator transform
    expect(indicatorStyle()).toContain('translateX(-28%)')
  })

  it('embeds the live progress inspector while an export job is active', () => {
    mockStatus({
      status: 'running',
      command_id: 'command:exp-1',
      progress: { stage: 'collecting', percent: 5, message: 'Collecting' },
    })
    // The embedded inspector polls via react-query, so it needs a client.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ExportCard />
      </QueryClientProvider>
    )

    const live = document.querySelector('[data-testid="export-live-inspector"]')
    expect(live).not.toBeNull()
  })

  it('falls back to the localized stage label when progress has no detail', () => {
    mockStatus({
      status: 'running',
      progress: { stage: 'packaging', percent: 92, message: 'Packaging' },
    })
    render(<ExportCard />)

    // Stage list row + the fallback activity line
    expect(screen.getAllByText('dataManagement.export.stages.packaging').length).toBe(2)
    // No stats recorded for packaging: no x/y fragment anywhere
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument()
  })

  it('renders the completed summary, downloads and deletes the package', () => {
    mockStatus({
      status: 'completed',
      progress: { stage: 'done', percent: 100, message: 'Export complete' },
      summary: {
        package_filename: 'open_notebook_export_20260923_120000.zip',
        package_size_bytes: 1536,
        counts: { source: 2, note: 1 },
        files_skipped: 0,
        duration_seconds: 12.4,
      },
    })
    render(<ExportCard />)

    expect(screen.getByText('dataManagement.export.summary.packageSize')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.activity.durationSec')).toBeInTheDocument()
    expect(screen.getAllByText('dataManagement.export.summary.counts').length).toBe(2)
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.download' }))
    expect(dataTransferApi.downloadExport).toHaveBeenCalledWith(
      expect.any(Function),
      'open_notebook_export_20260923_120000.zip'
    )

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.deletePackage' }))
    expect(screen.getByText('dataManagement.export.deleteConfirmTitle')).toBeInTheDocument()
    expect(deleteSpy).not.toHaveBeenCalled()

    const buttons = screen.getAllByRole('button', { name: 'dataManagement.export.deletePackage' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(deleteSpy).toHaveBeenCalledTimes(1)
  })

  it('shows skipped files in the completed summary when present', () => {
    mockStatus({
      status: 'completed',
      summary: {
        package_filename: 'x.zip',
        package_size_bytes: 10,
        counts: {},
        files_skipped: 3,
      },
    })
    render(<ExportCard />)

    expect(screen.getByText('dataManagement.export.summary.filesSkipped')).toBeInTheDocument()
  })

  it('lets the completed state start another export without deleting first', () => {
    mockStatus({
      status: 'completed',
      progress: { stage: 'done', percent: 100, message: 'Export complete' },
      summary: {
        package_filename: 'x.zip',
        package_size_bytes: 10,
        counts: {},
        files_skipped: 0,
      },
    })
    render(<ExportCard />)

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.start' }))
    expect(screen.getByText('dataManagement.export.confirmTitle')).toBeInTheDocument()
  })

  it('renders the failed state with the backend error and a retry button', () => {
    mockStatus({
      status: 'failed',
      progress: { stage: 'copying_files', percent: 40, message: '', error: 'disk full' },
    })
    render(<ExportCard />)

    expect(screen.getByText('dataManagement.errors.failed disk full')).toBeInTheDocument()
    const failedRow = screen.getByText('dataManagement.export.stages.copying_files').closest('li')
    expect(failedRow?.className).toContain('text-destructive')

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.start' }))
    expect(screen.getByText('dataManagement.export.confirmTitle')).toBeInTheDocument()
  })

  it('shows the package estimate inside the start dialog once loaded', () => {
    mockStatus({ status: 'none' })
    mockUseExportEstimate.mockReturnValue({
      data: {
        scope: 'full',
        notebook_ids: [],
        notebooks: 2,
        sources: 5,
        notes: 4,
        insights: 0,
        embeddings: 100,
        asset_files: 2,
        asset_bytes: 1536,
        text_chars: 500,
        estimated_package_bytes: 4096,
      },
      isFetching: false,
    })
    render(<ExportCard />)

    openStartDialog()
    const estimateBox = document.querySelector('[data-testid="export-estimate"]')
    expect(estimateBox).not.toBeNull()
    // The size line interleaves the label with the "~4 KB" span, so assert on
    // the container text rather than a single matching text node.
    expect(estimateBox?.textContent).toContain('dataManagement.export.estimate.size')
    expect(estimateBox?.textContent).toContain('dataManagement.export.estimate.breakdown')
    expect(estimateBox?.textContent).toContain('dataManagement.export.estimate.files')
  })

  it('shows the calculating placeholder while the estimate query is in flight', () => {
    mockStatus({ status: 'none' })
    mockUseExportEstimate.mockReturnValue({ data: undefined, isFetching: true })
    render(<ExportCard />)

    openStartDialog()
    expect(screen.getByText('dataManagement.export.estimate.calculating')).toBeInTheDocument()
  })

  it('requires a notebook pick before confirming a notebooks-scope export', () => {
    mockStatus({ status: 'none' })
    render(<ExportCard />)

    openStartDialog()
    fireEvent.click(radio('notebooks'))
    expect(screen.getByText('dataManagement.export.pickNotebooks')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()

    // Notebook checkboxes in the picker are distinct from the models checkbox:
    // the first one toggles the selection.
    const confirm = screen
      .getAllByRole('button', { name: 'dataManagement.export.start' })
      .pop()!
    expect(confirm.hasAttribute('disabled')).toBe(true)

    const pick = screen
      .getAllByRole('checkbox')
      .find((node) => node.closest('label')?.textContent?.includes('Research'))!
    fireEvent.click(pick)
    expect(confirm.hasAttribute('disabled')).toBe(false)

    fireEvent.click(confirm)
    expect(mutateSpy).toHaveBeenCalledWith({
      scope: 'notebooks',
      include_models: false,
      notebook_ids: ['notebook:n1'],
    })
  })

  it('feeds download progress through to the percent label and progress bar', async () => {
    mockStatus({
      status: 'completed',
      progress: { stage: 'done', percent: 100, message: 'Export complete' },
      summary: {
        package_filename: 'x.zip',
        package_size_bytes: 10,
        counts: {},
        files_skipped: 0,
      },
    })
    const downloadMock = vi.mocked(dataTransferApi.downloadExport)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    downloadMock.mockImplementationOnce(
      async (onProgress?: (p: { loaded: number; total: number }) => void) => {
        onProgress?.({ loaded: 5242880, total: 10485760 })
        await gate
      }
    )
    render(<ExportCard />)

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.download' }))
    // Both progress updates above ran synchronously before the first await.
    expect(screen.getByText('dataManagement.export.downloadingPercent')).toBeInTheDocument()
    const label = screen.getByTestId('download-progress-label')
    expect(label.textContent).toContain('dataManagement.export.downloadProgress')

    release()
    await act(async () => {
      await gate
    })
    // The transient progress UI clears once the download promise settles.
    expect(screen.queryByTestId('download-progress-label')).not.toBeInTheDocument()
  })
})

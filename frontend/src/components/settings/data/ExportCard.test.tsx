import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// useTranslation is mocked globally in setup.ts (t returns the key string).

const mockUseExportStatus = vi.fn()
const mockStartExport = vi.fn()
const mockDeletePackage = vi.fn()
vi.mock('@/lib/hooks/use-data-transfer', () => ({
  useExportStatus: (...args: unknown[]) => mockUseExportStatus(...args),
  useStartExport: () => mockStartExport(),
  useDeleteExportPackage: () => mockDeletePackage(),
}))

// downloadExport touches the DOM/network; the rest of the module is types only.
vi.mock('@/lib/api/dataTransfer', () => ({
  dataTransferApi: {
    downloadExport: vi.fn().mockResolvedValue(undefined),
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
}

function indicatorStyle(): string | undefined {
  const indicator = document.querySelector('[data-slot="progress-indicator"]')
  return indicator?.getAttribute('style') ?? undefined
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

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.start' }))
    expect(screen.getByText('dataManagement.export.confirmTitle')).toBeInTheDocument()
    expect(mutateSpy).not.toHaveBeenCalled()

    const buttons = screen.getAllByRole('button', { name: 'dataManagement.export.start' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(mutateSpy).toHaveBeenCalledTimes(1)
  })

  it('renders progress with the current stage highlighted, x/y message and percent', () => {
    mockStatus({
      status: 'running',
      progress: { stage: 'copying_files', percent: 52, message: 'Copying files (3/5)' },
    })
    render(<ExportCard />)

    expect(screen.getByText('Copying files (3/5)')).toBeInTheDocument()
    // All five stage labels are listed
    expect(screen.getByText('dataManagement.export.stages.collecting')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.export.stages.exporting_tables')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.export.stages.copying_files')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.export.stages.exporting_embeddings')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.export.stages.packaging')).toBeInTheDocument()
    // The current stage row is the highlighted one
    const currentRow = screen.getByText('dataManagement.export.stages.copying_files').closest('li')
    expect(currentRow?.className).toContain('bg-muted')
    // Percent reaches the progress indicator transform
    expect(indicatorStyle()).toContain('translateX(-48%)')
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
      },
    })
    render(<ExportCard />)

    expect(screen.getByText('dataManagement.export.summary.packageSize')).toBeInTheDocument()
    expect(screen.getAllByText('dataManagement.export.summary.counts').length).toBe(2)
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.export.download' }))
    expect(dataTransferApi.downloadExport).toHaveBeenCalledWith(
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
})

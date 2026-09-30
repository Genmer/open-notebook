import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// useTranslation is mocked globally in setup.ts (t returns the key string).
// These tests need to see interpolation, so override with a t that renders
// warning keys as `localized:key|params` and passes everything else through.
vi.mock('@/lib/hooks/use-translation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/hooks/use-translation')>()
  return {
    ...mod,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        key.startsWith('dataManagement.warnings.')
          ? `localized:${key}|${JSON.stringify(options ?? {})}`
          : key,
      i18n: { language: 'en-US' },
    }),
  }
})

const mockUseImportStatus = vi.fn()
const mockUploadImport = vi.fn()
const mockExecuteImport = vi.fn()
// ExportCard is pulled in for formatBytes; its hooks must exist on the mock.
vi.mock('@/lib/hooks/use-data-transfer', () => ({
  useImportStatus: (...args: unknown[]) => mockUseImportStatus(...args),
  useUploadImportPackage: () => mockUploadImport(),
  useExecuteImport: () => mockExecuteImport(),
  useExportStatus: vi.fn(),
  useStartExport: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteExportPackage: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

import { ImportCard } from './ImportCard'
import type { ImportScanResponse, ImportStatusResponse } from '@/lib/api/dataTransfer'

const uploadSpy = vi.fn()
const executeSpy = vi.fn()

function mockStatus(data?: ImportStatusResponse) {
  mockUseImportStatus.mockReturnValue({ data })
  mockUploadImport.mockReturnValue({ mutate: uploadSpy, isPending: false })
  mockExecuteImport.mockReturnValue({ mutate: executeSpy, isPending: false })
}

function selectFile(name: string, size: number) {
  const file = new File(['package-bytes'], name, { type: 'application/zip' })
  Object.defineProperty(file, 'size', { value: size })
  const input = screen.getByLabelText('dataManagement.import.chooseFile')
  fireEvent.change(input, { target: { files: [file] } })
  return file
}

function confirmUpload() {
  fireEvent.click(screen.getByRole('button', { name: 'dataManagement.import.upload' }))
  expect(screen.getByText('dataManagement.import.confirmTitle')).toBeInTheDocument()
  const buttons = screen.getAllByRole('button', { name: 'dataManagement.import.upload' })
  fireEvent.click(buttons[buttons.length - 1])
  return uploadSpy.mock.calls[0][1] as {
    onSuccess: (scan: ImportScanResponse) => void
  }
}

const cleanScan: ImportScanResponse = {
  scan_id: 'scan-1',
  package_type: 'full',
  format_version: 2,
  counts: { notebook: 1 },
  conflicts: [],
  decisions_required: 0,
}

const conflictScan: ImportScanResponse = {
  scan_id: 'scan-2',
  package_type: 'models',
  format_version: 2,
  counts: { credential: 1, model: 0, default_models: 0 },
  conflicts: [
    {
      kind: 'credential',
      id: 'credential:c1',
      local: { name: 'Local', provider: 'openai', api_key: null, model_count: 0 },
      package: { name: 'Pkg', provider: 'vertex', api_key: '***3210', model_count: 1 },
      diff_fields: ['name'],
      default_action: 'skip',
    },
  ],
  decisions_required: 1,
}

describe('ImportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uploadSpy.mockClear()
    executeSpy.mockClear()
  })

  it('renders the idle state with a disabled upload button until a file is chosen', () => {
    mockStatus({ status: 'none' })
    render(<ImportCard />)

    expect(screen.getByText('dataManagement.import.title')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.limitHint')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataManagement.import.upload' })
    ).toBeDisabled()

    const file = selectFile('backup.zip', 2048)
    expect(screen.getByText('backup.zip (2.0 KB)')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataManagement.import.upload' })
    ).toBeEnabled()

    // Confirmation gate before the upload mutation fires
    fireEvent.click(screen.getByRole('button', { name: 'dataManagement.import.upload' }))
    expect(screen.getByText('dataManagement.import.confirmTitle')).toBeInTheDocument()
    expect(uploadSpy).not.toHaveBeenCalled()

    const buttons = screen.getAllByRole('button', { name: 'dataManagement.import.upload' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(uploadSpy.mock.calls[0][0]).toBe(file)
  })

  it('keeps the upload disabled for packages over the 1 GB limit', () => {
    mockStatus({ status: 'none' })
    render(<ImportCard />)

    selectFile('huge.zip', 1024 * 1024 * 1024 + 1)
    expect(screen.getByText('huge.zip (1.0 GB)')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataManagement.import.upload' })
    ).toBeDisabled()
    // The limit hint is highlighted in the over-limit case
    expect(screen.getByText('dataManagement.import.limitHint').className).toContain(
      'text-destructive'
    )
  })

  it('renders progress with the current stage highlighted and the x/y message', () => {
    mockStatus({
      status: 'running',
      progress: {
        stage: 'metadata',
        percent: 30,
        message: 'Writing source (4/10)',
        detail: { table: 'source', current: 4, total: 10 },
      },
    })
    render(<ImportCard />)

    // Structured detail wins: the activity line renders the localized template
    expect(screen.getByText('dataManagement.activity.writingTable')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.stages.validating')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.stages.precheck')).toBeInTheDocument()
    expect(screen.getAllByText('dataManagement.import.stages.metadata').length).toBeGreaterThan(0)
    expect(screen.getByText('dataManagement.import.stages.model_config')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.stages.files')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.stages.embeddings')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.stages.relations')).toBeInTheDocument()

    const currentRow = screen
      .getAllByText('dataManagement.import.stages.metadata')[0]
      .closest('li')
    expect(currentRow?.className).toContain('bg-muted')

    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator?.getAttribute('style')).toContain('translateX(-70%)')
  })

  it('renders the completed summary with imported, skipped and warnings', () => {
    mockStatus({
      status: 'completed',
      progress: { stage: 'done', percent: 100, message: 'Import complete' },
      summary: {
        imported: { source: 2, note: 1 },
        skipped: { source: 1 },
        warnings: ['embedding model differs: model:a != model:b'],
      },
    })
    render(<ImportCard />)

    expect(screen.getByText('dataManagement.import.summary.imported')).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.summary.skipped')).toBeInTheDocument()
    // One rowFormat per imported/skipped entry
    expect(screen.getAllByText('dataManagement.import.rowFormat').length).toBe(3)
    expect(
      screen.getByText('embedding model differs: model:a != model:b')
    ).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.summary.warnings')).toBeInTheDocument()
  })

  it('localizes legacy plain-English warnings from imports made before warning codes', () => {
    mockStatus({
      status: 'completed',
      progress: { stage: 'done', percent: 100, message: 'Import complete' },
      summary: {
        imported: { source: 1 },
        skipped: {},
        warnings: [
          'No default embedding model configured here; imported vectors may not match newly generated ones',
          'Skipped source_group_member edge source:82umf2l3ougn1xhda -> source_group:7c17dc6c094b4ee9bc4abbacecf014f0: in endpoint was not imported this run',
          'totally unknown legacy warning',
        ],
      },
    })
    render(<ImportCard />)

    expect(
      screen.getByText(
        'localized:dataManagement.warnings.noDefaultEmbeddingModel|{}'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'localized:dataManagement.warnings.edgeEndpointNotImported|{"edge":"source_group_member","source":"source:82umf2l3ougn1xhda","target":"source_group:7c17dc6c094b4ee9bc4abbacecf014f0"}'
      )
    ).toBeInTheDocument()
    // Unmatched legacy text still renders rather than disappearing
    expect(screen.getByText('totally unknown legacy warning')).toBeInTheDocument()
    // None of the raw English templates survive
    expect(
      screen.queryByText(
        'No default embedding model configured here; imported vectors may not match newly generated ones'
      )
    ).not.toBeInTheDocument()
  })

  it('localizes the defaultModelTargetMissing warning code', () => {
    mockStatus({
      status: 'completed',
      progress: { stage: 'done', percent: 100, message: 'Import complete' },
      summary: {
        imported: { default_models: 1 },
        skipped: {},
        warnings: ['Default model model:m1 was cleared'],
        warning_codes: [
          { code: 'defaultModelTargetMissing', params: { model: 'model:m1' } },
        ],
      },
    })
    render(<ImportCard />)

    expect(
      screen.getByText(
        'localized:dataManagement.warnings.defaultModelTargetMissing|{"model":"model:m1"}'
      )
    ).toBeInTheDocument()
  })

  it('auto-executes the import when the scan reports no conflicts', () => {
    mockStatus({ status: 'none' })
    render(<ImportCard />)

    selectFile('clean.zip', 2048)
    const options = confirmUpload()
    expect(executeSpy).not.toHaveBeenCalled()

    act(() => {
      options.onSuccess(cleanScan)
    })

    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).toHaveBeenCalledWith({
      scan_id: 'scan-1',
      decisions: [],
    })
    expect(
      screen.queryByText('dataManagement.import.conflict.title')
    ).not.toBeInTheDocument()
  })

  it('opens the conflict dialog instead of executing when conflicts exist', () => {
    mockStatus({ status: 'none' })
    render(<ImportCard />)

    selectFile('conflict.zip', 2048)
    const options = confirmUpload()

    act(() => {
      options.onSuccess(conflictScan)
    })

    expect(
      screen.getByText('dataManagement.import.conflict.title')
    ).toBeInTheDocument()
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('sends the full decision list when confirming the conflict dialog', () => {
    mockStatus({ status: 'none' })
    render(<ImportCard />)

    selectFile('conflict.zip', 2048)
    const options = confirmUpload()
    act(() => {
      options.onSuccess(conflictScan)
    })

    // Switch the row to overwrite, then start the import.
    const row = screen.getByText('credential:c1').closest('div.rounded-md')
    const overwriteRadio = row!.querySelectorAll('button[role="radio"]')[1]
    fireEvent.click(overwriteRadio)
    fireEvent.click(
      screen.getByText('dataManagement.import.conflict.startImport')
    )

    expect(executeSpy).toHaveBeenCalledWith({
      scan_id: 'scan-2',
      decisions: [
        { kind: 'credential', id: 'credential:c1', action: 'overwrite' },
      ],
    })
  })

  it('cancel from the conflict dialog returns to the upload panel', () => {
    mockStatus({ status: 'none' })
    render(<ImportCard />)

    selectFile('conflict.zip', 2048)
    const options = confirmUpload()
    act(() => {
      options.onSuccess(conflictScan)
    })

    fireEvent.click(screen.getByText('common.cancel'))
    expect(
      screen.queryByText('dataManagement.import.conflict.title')
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('dataManagement.import.chooseFile')).toBeInTheDocument()
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('renders the failed state with the backend error passed through', () => {
    mockStatus({
      status: 'failed',
      progress: { stage: 'validating', percent: 5, message: '', error: 'bad manifest' },
    })
    render(<ImportCard />)

    expect(screen.getByText('dataManagement.errors.failed bad manifest')).toBeInTheDocument()
    const failedRow = screen.getByText('dataManagement.import.stages.validating').closest('li')
    expect(failedRow?.className).toContain('text-destructive')
  })

  it.each(['completed', 'failed'] as const)(
    'offers an import-another escape hatch from the %s state',
    (status) => {
      mockStatus({
        status,
        progress:
          status === 'failed'
            ? { stage: 'validating', percent: 5, message: '', error: 'bad manifest' }
            : { stage: 'done', percent: 100, message: 'done' },
        summary:
          status === 'completed'
            ? { imported: { source: 1 }, skipped: {}, warnings: [] }
            : undefined,
      })
      render(<ImportCard />)

      // Terminal states must not dead-end: the upload UI is reachable again.
      expect(screen.queryByLabelText('dataManagement.import.chooseFile')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'dataManagement.import.importAnother' }))
      expect(screen.getByLabelText('dataManagement.import.chooseFile')).toBeInTheDocument()

      const file = selectFile('next.zip', 2048)
      expect(
        screen.getByRole('button', { name: 'dataManagement.import.upload' })
      ).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'dataManagement.import.upload' }))
      const buttons = screen.getAllByRole('button', { name: 'dataManagement.import.upload' })
      fireEvent.click(buttons[buttons.length - 1])
      expect(uploadSpy.mock.calls[0][0]).toBe(file)
    }
  )
})

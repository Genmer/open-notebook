import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Radix Select measures its trigger via ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

import { SettingsForm } from './SettingsForm'

// useTranslation is mocked globally in setup.ts (t returns the key string),
// so hint keys render as their literal key names below.

vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: vi.fn(),
  useUpdateSettings: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('@/lib/hooks/use-capabilities', () => ({
  useCapabilities: vi.fn(),
}))

vi.mock('@/lib/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}))

import { useSettings, useUpdateSettings } from '@/lib/hooks/use-settings'
import { useCapabilities } from '@/lib/hooks/use-capabilities'
import { useToast } from '@/lib/hooks/use-toast'

const settingsData = {
  default_content_processing_engine_doc: 'auto',
  default_content_processing_engine_url: 'auto',
  default_embedding_option: 'ask',
  auto_delete_files: 'no',
  docling_ocr: true,
}

function mockCapabilities(caps: unknown, { isError = false } = {}) {
  ;(useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: settingsData,
    isLoading: false,
    error: null,
  })
  ;(useCapabilities as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: caps,
    isError,
  })
}

describe('SettingsForm engine gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables OCR and shows env hints when the runtimes are unavailable', () => {
    mockCapabilities({
      docling_available: false,
      crawl4ai_available: false,
      crawl4ai_remote_configured: false,
    })
    render(<SettingsForm />)

    expect(screen.getByText('settings.enableDoclingHint')).toBeInTheDocument()
    expect(screen.getByText('settings.enableCrawl4aiHint')).toBeInTheDocument()
    // Target the OCR toggle by its accessible name (from the associated Label).
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).toBeDisabled()
  })

  it('enables OCR and hides the hints when the runtimes are available', () => {
    mockCapabilities({
      docling_available: true,
      crawl4ai_available: true,
      crawl4ai_remote_configured: false,
    })
    render(<SettingsForm />)

    expect(screen.queryByText('settings.enableDoclingHint')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.enableCrawl4aiHint')).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).not.toBeDisabled()
  })

  it('treats runtimes as available while the capability probe is still loading', () => {
    mockCapabilities(undefined)
    render(<SettingsForm />)

    // Optimistic default avoids a flash of disabled controls on a working setup.
    expect(screen.queryByText('settings.enableDoclingHint')).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).not.toBeDisabled()
  })

  it('fails closed when the capability probe errors', () => {
    mockCapabilities(undefined, { isError: true })
    render(<SettingsForm />)

    // A failed probe must not advertise engines the backend couldn't verify.
    expect(screen.getByText('settings.enableDoclingHint')).toBeInTheDocument()
    expect(screen.getByText('settings.enableCrawl4aiHint')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).toBeDisabled()
  })
})

const settingsWithVectorParams = {
  ...settingsData,
  chunk_size: 512,
  chunk_overlap: 60,
  min_chunk_size: 3,
  embedding_batch_size: 10,
  effective_chunk_size: 512,
  effective_chunk_overlap: 60,
  effective_min_chunk_size: 3,
  effective_embedding_batch_size: 10,
}

const settingsWithEffectiveOnly = {
  ...settingsData,
  chunk_size: null,
  chunk_overlap: null,
  min_chunk_size: null,
  embedding_batch_size: null,
  effective_chunk_size: 400,
  effective_chunk_overlap: 60,
  effective_min_chunk_size: 5,
  effective_embedding_batch_size: 50,
}

function mockSettings(settings: Record<string, unknown>) {
  ;(useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: settings,
    isLoading: false,
    error: null,
  })
  ;(useCapabilities as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { docling_available: true, crawl4ai_available: true },
    isError: false,
  })
}

describe('SettingsForm vectorization params', () => {
  const toastMock = vi.fn()
  const mutateAsyncMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    toastMock.mockClear()
    mutateAsyncMock.mockResolvedValue(undefined)
    ;(useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toast: toastMock,
    })
    ;(useUpdateSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mutateAsyncMock,
      isPending: false,
    })
  })

  it('renders the four vector param inputs with the stored DB values', () => {
    mockSettings(settingsWithVectorParams)
    render(<SettingsForm />)

    expect(
      screen.getByRole('spinbutton', { name: 'settings.chunkSize' })
    ).toHaveValue(512)
    expect(
      screen.getByRole('spinbutton', { name: 'settings.chunkOverlap' })
    ).toHaveValue(60)
    expect(
      screen.getByRole('spinbutton', { name: 'settings.minChunkSize' })
    ).toHaveValue(3)
    expect(
      screen.getByRole('spinbutton', { name: 'settings.embeddingBatchSize' })
    ).toHaveValue(10)
  })

  it('leaves unset vector params blank and shows effective values as placeholders', () => {
    mockSettings(settingsWithEffectiveOnly)
    render(<SettingsForm />)

    // Unset DB values fall back to env/defaults: inputs stay blank (so a save
    // cannot freeze the resolved values into the DB) and the effective value
    // is only shown as the placeholder.
    const chunkSize = screen.getByRole('spinbutton', { name: 'settings.chunkSize' })
    expect(chunkSize).toHaveValue(null)
    expect(chunkSize).toHaveAttribute('placeholder', '400')
    expect(
      screen.getByRole('spinbutton', { name: 'settings.chunkOverlap' })
    ).toHaveAttribute('placeholder', '60')
    expect(
      screen.getByRole('spinbutton', { name: 'settings.minChunkSize' })
    ).toHaveAttribute('placeholder', '5')
    const batchSize = screen.getByRole('spinbutton', {
      name: 'settings.embeddingBatchSize',
    })
    expect(batchSize).toHaveValue(null)
    expect(batchSize).toHaveAttribute('placeholder', '50')
  })

  it('shows the rebuild-embeddings toast when a chunk param changed on save', async () => {
    mockSettings(settingsWithVectorParams)
    render(<SettingsForm />)

    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'settings.chunkSize' }),
      { target: { value: '800' } }
    )
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalled()
    })
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ chunk_size: 800 })
    )
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        description: 'settings.chunkParamsChangedToast',
      })
    })
  })

  it('only submits vector params the user actually changed', async () => {
    mockSettings(settingsWithVectorParams)
    render(<SettingsForm />)

    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'settings.chunkSize' }),
      { target: { value: '800' } }
    )
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalled()
    })
    const payload = mutateAsyncMock.mock.calls[0][0]
    expect(payload.chunk_size).toBe(800)
    // Untouched vector params must not be sent — otherwise the resolved
    // values would be frozen into the DB and env vars would stop working.
    expect(payload).not.toHaveProperty('chunk_overlap')
    expect(payload).not.toHaveProperty('min_chunk_size')
    expect(payload).not.toHaveProperty('embedding_batch_size')
  })

  it('omits a cleared vector param from the submitted payload', async () => {
    mockSettings(settingsWithVectorParams)
    render(<SettingsForm />)

    // Clearing an input means "keep following env/DB": the wire payload must
    // not carry the field (undefined keys are dropped by JSON serialization),
    // so the previously stored value stays untouched.
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'settings.chunkSize' }),
      { target: { value: '' } }
    )
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalled()
    })
    const payload = mutateAsyncMock.mock.calls[0][0]
    expect(payload.chunk_size).toBeUndefined()
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('chunk_size')
  })

  it('does not show the chunk toast when no vector param changed', async () => {
    mockSettings(settingsWithVectorParams)
    render(<SettingsForm />)

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'settings.visionEnabled' })
    )
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalled()
    })
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('does not show the rebuild toast when only the batch size changed', async () => {
    mockSettings(settingsWithVectorParams)
    render(<SettingsForm />)

    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'settings.embeddingBatchSize' }),
      { target: { value: '20' } }
    )
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalled()
    })
    const payload = mutateAsyncMock.mock.calls[0][0]
    expect(payload.embedding_batch_size).toBe(20)
    expect(toastMock).not.toHaveBeenCalled()
  })
})

describe('SettingsForm usage tracking toggle', () => {
  const mutateAsyncMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mutateAsyncMock.mockResolvedValue(undefined)
    ;(useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toast: vi.fn(),
    })
    ;(useUpdateSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mutateAsyncMock,
      isPending: false,
    })
  })

  it('defaults the tracking toggle to enabled when the setting is unset', () => {
    mockSettings({ ...settingsData, usage_tracking_enabled: undefined })
    render(<SettingsForm />)

    expect(
      screen.getByRole('checkbox', { name: 'usage.trackingEnabled' })
    ).toBeChecked()
  })

  it('submits the toggled tracking state on save', async () => {
    mockSettings({ ...settingsData, usage_tracking_enabled: true })
    render(<SettingsForm />)

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'usage.trackingEnabled' })
    )
    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalled()
    })
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ usage_tracking_enabled: false })
    )
  })
})

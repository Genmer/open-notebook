import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'

// useTranslation is mocked globally in setup.ts (t returns the key string),
// so assertions below check for literal i18n keys.

const { getStatusMock, rebuildMock } = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  rebuildMock: vi.fn(),
}))
vi.mock('@/lib/api/embedding', () => ({
  embeddingApi: {
    getStatus: (...args: unknown[]) => getStatusMock(...(args as [])),
    rebuildEmbeddings: (...args: unknown[]) => rebuildMock(...(args as [])),
  },
}))

const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...(args as [])),
    error: (...args: unknown[]) => toastErrorMock(...(args as [])),
  },
}))

import { EmbeddingStatusSummary } from '@/lib/api/embedding'
import { queryClient, QUERY_KEYS } from '@/lib/api/query-client'
import { EmbedMissingPanel } from './EmbedMissingPanel'

function status(over: Partial<EmbeddingStatusSummary> = {}): EmbeddingStatusSummary {
  return {
    total_sources: 10,
    completed: 5,
    queued: 0,
    running: 0,
    failed: 1,
    partial: 0,
    not_embedded: 4,
    pending: 5,
    ...over,
  }
}

// The component invalidates the singleton client on success, so it must be
// the provider client for the post-submit refetch to be observable.
function renderPanel() {
  return render(
    <QueryClientProvider client={queryClient}>
      <EmbedMissingPanel />
    </QueryClientProvider>
  )
}

describe('EmbedMissingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.clear()
    vi.spyOn(queryClient, 'invalidateQueries')
  })

  it('keeps the rebuild button disabled when nothing is pending', async () => {
    getStatusMock.mockResolvedValue(
      status({ pending: 0, not_embedded: 0, failed: 0 })
    )
    renderPanel()

    const button = await screen.findByRole('button', {
      name: 'sources.embedMissing.button',
    })
    expect(button).toBeDisabled()
  })

  it('shows the pending count and opens the confirm dialog', async () => {
    getStatusMock.mockResolvedValue(status())
    renderPanel()

    const button = await screen.findByRole('button', {
      name: 'sources.embedMissing.button',
    })
    expect(button).toBeEnabled()
    expect(screen.getByText('5')).toBeInTheDocument()

    fireEvent.click(button)
    expect(
      await screen.findByText('sources.embedMissing.confirmTitle')
    ).toBeInTheDocument()
    expect(
      screen.getByText('sources.embedMissing.confirmDescription')
    ).toBeInTheDocument()
  })

  it('rebuilds with mode missing on confirm and refreshes the status', async () => {
    getStatusMock.mockResolvedValue(status())
    rebuildMock.mockResolvedValue({
      command_id: 'command:1',
      message: '',
      estimated_items: 5,
    })
    renderPanel()

    fireEvent.click(
      await screen.findByRole('button', { name: 'sources.embedMissing.button' })
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'sources.embedMissing.confirmCta',
      })
    )

    await waitFor(() =>
      expect(rebuildMock).toHaveBeenCalledWith({ mode: 'missing' })
    )
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled())
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: QUERY_KEYS.embeddingStatus,
    })
    // The progress panel opens as soon as the rebuild is submitted
    expect(
      screen.getByText('sources.embedMissing.progressTitle')
    ).toBeInTheDocument()
  })

  it('does not rebuild when the confirm dialog is cancelled', async () => {
    getStatusMock.mockResolvedValue(status())
    renderPanel()

    fireEvent.click(
      await screen.findByRole('button', { name: 'sources.embedMissing.button' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'common.cancel' })
    )

    expect(rebuildMock).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.queryByText('sources.embedMissing.confirmTitle')
      ).toBeNull()
    )
  })

  it('shows live progress with badges while the worker is busy', async () => {
    getStatusMock.mockResolvedValue(
      status({ queued: 2, running: 1, completed: 3 })
    )
    renderPanel()

    // A busy status opens the progress panel without any submit
    expect(
      await screen.findByText('sources.embedMissing.progressTitle')
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    const completedBadge = screen.getByText(
      (content, element) =>
        element?.textContent === '3 sources.embedMissing.badge.completed'
    )
    expect(completedBadge).toBeInTheDocument()
  })

  it('shows the model-error hint when failures rise with zero completions', async () => {
    // Queue both snapshots up front: the post-submit refetch must observe the
    // second one no matter when it fires.
    getStatusMock
      .mockResolvedValueOnce(
        status({ failed: 0, completed: 0, not_embedded: 10, pending: 10, total_sources: 10 })
      )
      .mockResolvedValue(
        status({ failed: 2, completed: 0, not_embedded: 8, pending: 10, total_sources: 10 })
      )
    rebuildMock.mockResolvedValue({
      command_id: 'command:1',
      message: '',
      estimated_items: 10,
    })
    renderPanel()

    fireEvent.click(
      await screen.findByRole('button', { name: 'sources.embedMissing.button' })
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'sources.embedMissing.confirmCta',
      })
    )
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled())

    // Baseline was failed=0; the refetch shows new failures and no completions
    await waitFor(
      () =>
        expect(
          screen.getByText('sources.embedMissing.errorHint')
        ).toBeInTheDocument(),
      { timeout: 3000 }
    )
  })

  it('shows an error toast when the rebuild request fails', async () => {
    getStatusMock.mockResolvedValue(status())
    rebuildMock.mockRejectedValue(new Error('boom'))
    renderPanel()

    fireEvent.click(
      await screen.findByRole('button', { name: 'sources.embedMissing.button' })
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'sources.embedMissing.confirmCta',
      })
    )

    // The mutation retries once (1s backoff) before surfacing the error
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled(), {
      timeout: 3000,
    })
  })
})

// Compact variant: in-column single-row form used by the Gemini sources column
// footer; badge strip is collapsed behind a toggle.
describe('EmbedMissingPanel compact', () => {
  function renderCompact() {
    return render(
      <QueryClientProvider client={queryClient}>
        <EmbedMissingPanel variant="compact" />
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.clear()
    vi.spyOn(queryClient, 'invalidateQueries')
  })

  it('stays disabled and single-row when nothing is pending', async () => {
    getStatusMock.mockResolvedValue(
      status({ pending: 0, not_embedded: 0, failed: 0 })
    )
    renderCompact()

    const button = await screen.findByRole('button', {
      name: 'sources.embedMissing.columnCta',
    })
    expect(button).toBeDisabled()
    // Collapsed: no progress strip, no toggle
    expect(
      screen.queryByText('sources.embedMissing.progressTitle')
    ).not.toBeInTheDocument()
  })

  it('keeps the badge strip collapsed until the toggle is used, then shows all five badges', async () => {
    getStatusMock.mockResolvedValue(status({ queued: 2, running: 1, completed: 3 }))
    renderCompact()

    // Busy status makes the strip available but collapsed: single row only
    const toggle = await screen.findByRole('button', {
      name: 'sources.embedMissing.progressTitle',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByText('sources.embedMissing.progressTitle')
    ).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByText('sources.embedMissing.progressTitle')
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    for (const [count, label] of [
      ['4', 'sources.embedMissing.badge.notEmbedded'],
      ['2', 'sources.embedMissing.badge.queued'],
      ['1', 'sources.embedMissing.badge.running'],
      ['3', 'sources.embedMissing.badge.completed'],
      ['1', 'sources.embedMissing.badge.failed'],
    ] as const) {
      expect(
        screen.getByText(
          (content, element) => element?.textContent === `${count} ${label}`
        )
      ).toBeInTheDocument()
    }
  })

  it('opens the confirm dialog from the compact CTA', async () => {
    getStatusMock.mockResolvedValue(status())
    renderCompact()

    fireEvent.click(
      await screen.findByRole('button', { name: 'sources.embedMissing.columnCta' })
    )
    expect(
      await screen.findByText('sources.embedMissing.confirmTitle')
    ).toBeInTheDocument()
  })

  it('invalidates the context tree once a submitted rebuild converges', async () => {
    getStatusMock
      .mockResolvedValueOnce(status())
      .mockResolvedValue(
        status({ pending: 0, not_embedded: 0, completed: 10, total_sources: 10 })
      )
    rebuildMock.mockResolvedValue({
      command_id: 'command:1',
      message: '',
      estimated_items: 5,
    })
    renderCompact()

    fireEvent.click(
      await screen.findByRole('button', { name: 'sources.embedMissing.columnCta' })
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'sources.embedMissing.confirmCta',
      })
    )

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled())
    // Converged with nothing un-embedded: the Gemini column's embed dots need
    // the context tree refreshed (exactly once).
    await waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['contextTree'],
      })
    )
    const contextTreeCalls = (
      queryClient.invalidateQueries as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (call) => JSON.stringify(call[0]) === JSON.stringify({ queryKey: ['contextTree'] })
    )
    expect(contextTreeCalls).toHaveLength(1)
  })

  it('invalidates the context tree when polling watches pending work drain to zero', async () => {
    // Start busy with un-embedded sources, then converge without any submit
    getStatusMock
      .mockResolvedValueOnce(status({ queued: 1, running: 0, not_embedded: 4, pending: 5 }))
      .mockResolvedValue(
        status({ queued: 0, running: 0, not_embedded: 0, pending: 0, completed: 10 })
      )
    renderCompact()

    await screen.findByRole('button', { name: 'sources.embedMissing.columnCta' })
    // Simulate an external refetch (e.g. another mutation invalidating status)
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.embeddingStatus })

    await waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['contextTree'],
      })
    )
  })
})


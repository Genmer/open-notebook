import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// useTranslation is mocked globally in setup.ts (t returns the key string),
// so assertions below check for literal i18n keys.

const embedContentMock = vi.fn()
vi.mock('@/lib/api/embedding', () => ({
  embeddingApi: {
    embedContent: (...args: unknown[]) => embedContentMock(...args),
  },
}))

const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

const mutateMock = vi.fn()
const useRetrySourceMock = vi.fn(() => ({
  mutate: (...args: unknown[]) => mutateMock(...args),
  isPending: false,
}))
vi.mock('@/lib/hooks/use-sources', () => ({
  useRetrySource: () => useRetrySourceMock(),
}))

import { SourceProcessingStep } from '@/lib/types/api'
import { SourceProcessingSteps } from './SourceProcessingSteps'

function step(partial: Partial<SourceProcessingStep>): SourceProcessingStep {
  return {
    key: 'extraction',
    status: 'pending',
    current: null,
    total: null,
    error: null,
    ...partial,
  }
}

function renderWith(steps: SourceProcessingStep[]) {
  const queryClient = new QueryClient()
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SourceProcessingSteps sourceId="source:1" steps={steps} />
    </QueryClientProvider>
  )
  return { ...view, invalidateSpy }
}

describe('SourceProcessingSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when every step is done or skipped', () => {
    const { container } = renderWith([
      step({ key: 'extraction', status: 'done' }),
      step({ key: 'embedding', status: 'skipped' }),
      step({ key: 'transformation', status: 'done' }),
      step({ key: 'completion', status: 'done' }),
    ])
    expect(container).toBeEmptyDOMElement()
  })

  it('stays visible when some steps settled but one has failed', () => {
    // A failed step must keep the card mounted (retry affordance), even though
    // the rest of the pipeline already reached a terminal state.
    const { container } = renderWith([
      step({ key: 'extraction', status: 'done' }),
      step({ key: 'embedding', status: 'skipped' }),
      step({ key: 'transformation', status: 'failed', error: 'insight failed' }),
      step({ key: 'completion', status: 'pending' }),
    ])
    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByText('insight failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sources.retryProcessing' })).toBeInTheDocument()
  })

  it('renders the pipeline card while a step is in progress', () => {
    renderWith([
      step({ key: 'extraction', status: 'done' }),
      step({ key: 'transformation', status: 'in_progress', current: 3, total: 5 }),
    ])
    expect(screen.getByText('sources.processingTitle')).toBeInTheDocument()
    expect(screen.getByText('3/5')).toBeInTheDocument()
    expect(screen.getAllByText('sources.processingStatusInProgress').length).toBeGreaterThan(0)
  })

  it('shows the skipped status label', () => {
    renderWith([
      step({ key: 'extraction', status: 'done' }),
      step({ key: 'transformation', status: 'skipped' }),
      step({ key: 'completion', status: 'pending' }),
    ])
    expect(screen.getByText('sources.processingStatusSkipped')).toBeInTheDocument()
  })

  it('shows progress with a dash placeholder when total is unknown', () => {
    renderWith([
      step({ key: 'embedding', status: 'in_progress', current: 3, total: null }),
      step({ key: 'completion', status: 'pending' }),
    ])
    expect(screen.getByText('3/—')).toBeInTheDocument()
  })

  it('shows residual progress on a failed transformation step', () => {
    renderWith([
      step({ key: 'transformation', status: 'failed', current: 1, total: 3, error: 'insight blew up' }),
      step({ key: 'completion', status: 'pending' }),
    ])
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('insight blew up')).toBeInTheDocument()
  })

  it('shows no progress numbers on a failed embedding step', () => {
    renderWith([
      step({ key: 'embedding', status: 'failed', current: null, total: null, error: 'embed failed' }),
      step({ key: 'completion', status: 'pending' }),
    ])
    expect(screen.getByText('sources.processingStatusFailed')).toBeInTheDocument()
    expect(screen.queryByText('/—')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sources.embeddingRetry' })).toBeInTheDocument()
  })

  it('renders a failed non-embedding step with error and pipeline retry', async () => {
    renderWith([step({ key: 'extraction', status: 'failed', error: 'extraction blew up' })])

    expect(screen.getByText('extraction blew up')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'sources.retryProcessing' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith('source:1')
      expect(embedContentMock).not.toHaveBeenCalled()
    })
  })

  it('retries a failed embedding step via the embedding API', async () => {
    embedContentMock.mockResolvedValue({ success: true, message: 'ok' })
    const { invalidateSpy } = renderWith([
      step({ key: 'embedding', status: 'failed', error: 'embed failed' }),
    ])

    const button = screen.getByRole('button', { name: 'sources.embeddingRetry' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(embedContentMock).toHaveBeenCalledWith('source:1', 'source')
      expect(toastSuccessMock).toHaveBeenCalled()
      expect(mutateMock).not.toHaveBeenCalled()
    })
    expect(
      invalidateSpy.mock.calls.some(([options]) => {
        const opts = options as { queryKey?: unknown[] }
        return (
          opts?.queryKey?.[0] === 'sources' &&
          opts?.queryKey?.[1] === 'source:1' &&
          opts?.queryKey?.[2] === 'status'
        )
      })
    ).toBe(true)
  })

  it('shows an error toast when the embedding retry fails', async () => {
    embedContentMock.mockRejectedValue(new Error('network'))
    renderWith([step({ key: 'embedding', status: 'failed', error: 'embed failed' })])

    fireEvent.click(screen.getByRole('button', { name: 'sources.embeddingRetry' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled()
    })
  })
})

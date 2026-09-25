import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

import { SourceEmbeddingStatus } from '@/lib/types/api'
import { SourceEmbeddingProgress } from './SourceEmbeddingProgress'

const baseEmbedding: SourceEmbeddingStatus = {
  status: 'not_embedded',
  embedded_chunks: 0,
}

function renderWith(embedding: Partial<typeof baseEmbedding>, onEmbedSubmitted?: () => void) {
  return render(
    <SourceEmbeddingProgress
      sourceId="source:1"
      embedding={{ ...baseEmbedding, ...embedding }}
      onEmbedSubmitted={onEmbedSubmitted}
    />
  )
}

describe('SourceEmbeddingProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders queued state with worker-waiting copy', () => {
    renderWith({ status: 'queued', total_chunks: 10 })
    expect(screen.getByText('sources.embeddingStatusQueued')).toBeInTheDocument()
    expect(screen.getByText('sources.embeddingWaitingWorker')).toBeInTheDocument()
  })

  it('renders running state with a progress bar and chunk counts', () => {
    renderWith({ status: 'running', embedded_chunks: 3, total_chunks: 10 })
    expect(screen.getByText('sources.embeddingStatusRunning')).toBeInTheDocument()
    expect(
      screen.getByText('sources.embeddingProgressChunks', { exact: false })
    ).not.toBeNull()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders completed state with the chunk count', () => {
    renderWith({ status: 'completed', embedded_chunks: 7 })
    expect(screen.getByText('sources.embeddingStatusCompleted')).toBeInTheDocument()
  })

  it('renders partial/failed state with error and retry button', () => {
    renderWith({ status: 'failed', error: 'provider exploded' })
    expect(screen.getByText('sources.embeddingFailedTitle')).toBeInTheDocument()
    expect(screen.getByText('provider exploded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sources.embeddingRetry' })).toBeInTheDocument()
  })

  it('renders not_embedded state as the embedding call-to-action', () => {
    renderWith({ status: 'not_embedded' })
    expect(screen.getByText('sources.notEmbeddedAlert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sources.embeddingRetry' })).toBeInTheDocument()
  })

  it('retries the embed request and notifies the parent', async () => {
    embedContentMock.mockResolvedValue({ success: true, message: 'ok' })
    const onEmbedSubmitted = vi.fn()
    renderWith({ status: 'partial', error: 'boom' }, onEmbedSubmitted)

    fireEvent.click(screen.getByRole('button', { name: 'sources.embeddingRetry' }))

    await waitFor(() => {
      expect(embedContentMock).toHaveBeenCalledWith('source:1', 'source')
      expect(onEmbedSubmitted).toHaveBeenCalled()
      expect(toastSuccessMock).toHaveBeenCalled()
    })
  })

  it('shows an error toast when the retry request fails', async () => {
    embedContentMock.mockRejectedValue(new Error('network'))
    renderWith({ status: 'failed', error: 'boom' })

    fireEvent.click(screen.getByRole('button', { name: 'sources.embeddingRetry' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled()
    })
  })
})

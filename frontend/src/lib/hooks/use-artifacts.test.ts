import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Shared mocks (vi.hoisted so the vi.mock factories below can reference them).
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  getJobStatus: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@/lib/api/artifacts', () => ({
  artifactsApi: {
    generate: mocks.generate,
    getJobStatus: mocks.getJobStatus,
  },
}))

vi.mock('@/lib/api/query-client', () => ({
  QUERY_KEYS: {
    notes: (notebookId?: string) => ['notes', notebookId] as const,
  },
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    // Identity t(): error/timeout assertions assert on the i18n key itself.
    t: (key: string) => key,
    i18n: { language: 'en' },
    language: 'en',
    setLanguage: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Capture the options every useMutation call receives so the polling
// mutationFn can be driven directly without a real query client.
const useMutationMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: unknown) => {
    useMutationMock(options)
    return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

import { useGenerateArtifact } from './use-artifacts'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60 * 1000

interface CapturedMutationOptions {
  mutationFn: (request: { artifact_type: string }) => Promise<{ status: string }>
  onSuccess?: (data: { status: string }) => void
}

describe('useGenerateArtifact polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useMutationMock.mockClear()
    mocks.generate.mockReset()
    mocks.getJobStatus.mockReset()
    mocks.invalidateQueries.mockClear()
    mocks.generate.mockResolvedValue({ job_id: 'job-1', status: 'new' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function useLastMutationOptions(): CapturedMutationOptions {
    useGenerateArtifact('nb-1')
    const calls = useMutationMock.mock.calls
    return calls[calls.length - 1][0] as CapturedMutationOptions
  }

  it('resolves as soon as the job is completed and invalidates the notes query', async () => {
    mocks.getJobStatus.mockResolvedValue({ job_id: 'job-1', status: 'completed', result: {} })
    const options = useLastMutationOptions()
    const promise = options.mutationFn({ artifact_type: 'summary' })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    const result = await promise
    expect(result.status).toBe('completed')
    expect(mocks.getJobStatus).toHaveBeenCalledTimes(1)
    options.onSuccess?.(result)
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notes', 'nb-1'] })
  })

  it('stops polling immediately on canceled and surfaces error_message', async () => {
    mocks.getJobStatus.mockResolvedValue({
      job_id: 'job-1',
      status: 'canceled',
      error_message: 'job canceled by user',
    })
    const options = useLastMutationOptions()
    const promise = options.mutationFn({ artifact_type: 'summary' })
    // Attach the rejection expectation before advancing the clock so the
    // rejection never surfaces as unhandled.
    const expectation = expect(promise).rejects.toThrow('job canceled by user')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await expectation
    expect(mocks.getJobStatus).toHaveBeenCalledTimes(1)
  })

  it('treats unknown as terminal instead of polling until the 5-minute timeout', async () => {
    // 'unknown' is the API fallback when the job record is gone; it can never
    // change, so the poll must stop right away. error_message is absent, so
    // the error falls back to the i18n key.
    mocks.getJobStatus.mockResolvedValue({ job_id: 'job-1', status: 'unknown' })
    const options = useLastMutationOptions()
    const promise = options.mutationFn({ artifact_type: 'summary' })
    const expectation = expect(promise).rejects.toThrow('artifacts.failed')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await expectation
    expect(mocks.getJobStatus).toHaveBeenCalledTimes(1)
  })

  it('stops polling immediately on failed and surfaces error_message', async () => {
    mocks.getJobStatus.mockResolvedValue({
      job_id: 'job-1',
      status: 'failed',
      error_message: 'generation exploded',
    })
    const options = useLastMutationOptions()
    const promise = options.mutationFn({ artifact_type: 'summary' })
    const expectation = expect(promise).rejects.toThrow('generation exploded')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await expectation
    expect(mocks.getJobStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while the job is running and resolves on a later completed', async () => {
    mocks.getJobStatus
      .mockResolvedValueOnce({ job_id: 'job-1', status: 'running' })
      .mockResolvedValueOnce({ job_id: 'job-1', status: 'completed' })
    const options = useLastMutationOptions()
    const promise = options.mutationFn({ artifact_type: 'summary' })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(mocks.getJobStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    const result = await promise
    expect(result.status).toBe('completed')
    expect(mocks.getJobStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps polling through new/running (non-terminal, non-stop) statuses', async () => {
    // This endpoint only ever returns the CommandStatus enum ('new' | 'running'
    // | 'completed' | 'failed' | 'canceled') plus the 'unknown' fallback — the
    // 'queued' value belongs to the separate task-center TaskStatus domain.
    mocks.getJobStatus
      .mockResolvedValueOnce({ job_id: 'job-1', status: 'new' })
      .mockResolvedValueOnce({ job_id: 'job-1', status: 'running' })
      .mockResolvedValue({ job_id: 'job-1', status: 'completed' })
    const options = useLastMutationOptions()
    const promise = options.mutationFn({ artifact_type: 'summary' })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    const result = await promise
    expect(result.status).toBe('completed')
    expect(mocks.getJobStatus).toHaveBeenCalledTimes(3)
  })

  it('rejects with the timeout error after 5 minutes of endless running', async () => {
    mocks.getJobStatus.mockResolvedValue({ job_id: 'job-1', status: 'running' })
    const options = useLastMutationOptions()
    const promise = options.mutationFn({ artifact_type: 'summary' })
    const expectation = expect(promise).rejects.toThrow('artifacts.timeout')
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS)
    await expectation
    const callsAtTimeout = mocks.getJobStatus.mock.calls.length
    expect(callsAtTimeout).toBeGreaterThan(1)
    // The deadline has passed: no further polls may be scheduled.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(mocks.getJobStatus.mock.calls.length).toBe(callsAtTimeout)
  })
})

import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useSectionAnalysis } from './use-section-analysis'

const { analyzeSectionMock, getJobStatusMock, toastMock } = vi.hoisted(() => ({
  analyzeSectionMock: vi.fn(),
  getJobStatusMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/lib/api/source-analysis', () => ({
  sourceAnalysisApi: {
    analyzeSection: (...args: unknown[]) => analyzeSectionMock(...args),
    getJobStatus: (...args: unknown[]) => getJobStatusMock(...args),
  },
  TERMINAL_JOB_STATUSES: ['completed', 'failed', 'canceled', 'error', 'unknown'],
}))

vi.mock('@/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

// useTranslation is mocked globally in setup.ts (t returns the key string)

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  TestWrapper.displayName = 'TestWrapper'
  return TestWrapper
}

const COMPLETED_JOB = {
  job_id: 'command:abc',
  status: 'completed',
  result: {
    analysis_markdown: '# ok',
    model_name: 'm',
    provider: 'p',
    truncated: false,
  },
  error_message: null,
}

async function renderAndSubmit(overrides?: {
  args?: Record<string, unknown>
  submit?: { job_id: string; status: string }
  jobStatus?: unknown
}) {
  const onCompleted = vi.fn()
  const onFailed = vi.fn()
  analyzeSectionMock.mockResolvedValue(overrides?.submit ?? { job_id: 'command:abc', status: 'submitted' })
  getJobStatusMock.mockResolvedValue(overrides?.jobStatus ?? COMPLETED_JOB)

  const { result } = renderHook(() => useSectionAnalysis({ onCompleted, onFailed }), {
    wrapper: createWrapper(),
  })

  await act(async () => {
    await result.current.submit({
      key: '0:1:第一章',
      sourceId: 'source:1',
      sectionTitle: 'Introduction',
      sectionText: 'Some section body',
      pageStart: 3,
      pageEnd: 7,
      ...(overrides?.args ?? {}),
    })
  })

  return { result, onCompleted, onFailed }
}

describe('useSectionAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits the section payload with the current UI locale and watches the job', async () => {
    const { result, onCompleted } = await renderAndSubmit()

    expect(analyzeSectionMock).toHaveBeenCalledWith('source:1', {
      section_title: 'Introduction',
      section_text: 'Some section body',
      page_start: 3,
      page_end: 7,
      locale: 'en-US',
    })
    expect(result.current.activeJob).toEqual({ jobId: 'command:abc', key: '0:1:第一章' })
    expect(result.current.isAnalyzing).toBe(true)

    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalled()
    })
    expect(onCompleted).toHaveBeenCalledWith('0:1:第一章', COMPLETED_JOB.result)
    // Job resolved: no longer analyzing, no error toast.
    expect(result.current.isAnalyzing).toBe(false)
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('normalizes missing page bounds to null instead of undefined', async () => {
    await renderAndSubmit({
      args: { pageStart: undefined, pageEnd: undefined },
    })

    expect(analyzeSectionMock).toHaveBeenCalledWith('source:1', {
      section_title: 'Introduction',
      section_text: 'Some section body',
      page_start: null,
      page_end: null,
      locale: 'en-US',
    })
  })

  it('reports failure with the job error message when the job fails', async () => {
    const { onCompleted, onFailed } = await renderAndSubmit({
      jobStatus: {
        job_id: 'command:abc',
        status: 'failed',
        result: null,
        error_message: 'model exploded',
      },
    })

    await waitFor(() => {
      expect(onFailed).toHaveBeenCalled()
    })
    expect(onFailed).toHaveBeenCalledWith('0:1:第一章', 'model exploded')
    expect(onCompleted).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'common.error',
        description: 'model exploded',
        variant: 'destructive',
      })
    )
  })

  it('toasts a destructive error with the i18n fallback when submission fails', async () => {
    const onCompleted = vi.fn()
    const onFailed = vi.fn()
    analyzeSectionMock.mockRejectedValue(new Error('upstream exploded'))

    const { result } = renderHook(() => useSectionAnalysis({ onCompleted, onFailed }), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.submit({
        key: '0:1:第一章',
        sourceId: 'source:1',
        sectionTitle: 'Introduction',
        sectionText: 'Body',
      })
    })

    expect(onFailed).toHaveBeenCalledWith('0:1:第一章')
    expect(result.current.isAnalyzing).toBe(false)
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'common.error',
        description: 'sources.fileView.analysisFailed',
        variant: 'destructive',
      })
    )
  })
})

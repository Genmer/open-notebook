import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useSectionAnalysis } from './use-section-analysis'

const { analyzeSectionMock, toastMock } = vi.hoisted(() => ({
  analyzeSectionMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/lib/api/source-analysis', () => ({
  sourceAnalysisApi: {
    analyzeSection: (...args: unknown[]) => analyzeSectionMock(...args),
  },
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

describe('useSectionAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the section payload with the current UI locale', async () => {
    analyzeSectionMock.mockResolvedValue({
      analysis_markdown: '# ok',
      model_name: 'm',
      provider: 'p',
      truncated: false,
    })
    const { result } = renderHook(() => useSectionAnalysis(), { wrapper: createWrapper() })

    act(() => {
      result.current.mutate({
        sourceId: 'source:1',
        sectionTitle: 'Introduction',
        sectionText: 'Some section body',
        pageStart: 3,
        pageEnd: 7,
      })
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(analyzeSectionMock).toHaveBeenCalledWith('source:1', {
      section_title: 'Introduction',
      section_text: 'Some section body',
      page_start: 3,
      page_end: 7,
      locale: 'en-US',
    })
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('normalizes missing page bounds to null instead of undefined', async () => {
    analyzeSectionMock.mockResolvedValue({
      analysis_markdown: '# ok',
      model_name: null,
      provider: null,
      truncated: false,
    })
    const { result } = renderHook(() => useSectionAnalysis(), { wrapper: createWrapper() })

    act(() => {
      result.current.mutate({
        sourceId: 'source:1',
        sectionTitle: 'Whole doc',
        sectionText: 'Everything',
      })
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(analyzeSectionMock).toHaveBeenCalledWith('source:1', {
      section_title: 'Whole doc',
      section_text: 'Everything',
      page_start: null,
      page_end: null,
      locale: 'en-US',
    })
  })

  it('toasts a destructive error with the i18n fallback on failure', async () => {
    analyzeSectionMock.mockRejectedValue(new Error('upstream exploded'))
    const { result } = renderHook(() => useSectionAnalysis(), { wrapper: createWrapper() })

    act(() => {
      result.current.mutate({
        sourceId: 'source:1',
        sectionTitle: 'Introduction',
        sectionText: 'Body',
      })
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'common.error',
        description: 'sources.fileView.analysisFailed',
        variant: 'destructive',
      })
    )
  })
})

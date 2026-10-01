import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import { SourceDetailContent } from './SourceDetailContent'
import { sourcesApi } from '@/lib/api/sources'
import { insightsApi } from '@/lib/api/insights'
import { transformationsApi } from '@/lib/api/transformations'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { SourceDetailResponse } from '@/lib/types/api'
import { Transformation } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    get: vi.fn(),
    status: vi.fn().mockResolvedValue({ status: 'completed', embedding: null, steps: null }),
    update: vi.fn(),
    delete: vi.fn(),
    retry: vi.fn(),
  },
}))

vi.mock('@/lib/api/insights', () => ({
  insightsApi: {
    listForSource: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    getCommandStatus: vi.fn(),
  },
}))

vi.mock('@/lib/api/transformations', () => ({
  transformationsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/api/embedding', () => ({
  embeddingApi: {
    embedSource: vi.fn(),
    embedContent: vi.fn(),
  },
}))

vi.mock('@/components/sources/SourceInsightDialog', () => ({
  SourceInsightDialog: () => null,
}))

vi.mock('@/components/sources/NotebookAssociations', () => ({
  NotebookAssociations: () => null,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, ...props }: React.PropsWithChildren<{
    onValueChange: (value: string) => void
  }>) => (
    <select {...props} aria-label="transformation" onChange={event => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectItem: ({ children, value }: React.PropsWithChildren<{ value: string }>) => (
    <option value={value}>{children}</option>
  ),
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children }: React.PropsWithChildren) => <button role="tab">{children}</button>,
  TabsContent: ({ children }: React.PropsWithChildren) => <div role="tabpanel">{children}</div>,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockSourcesGet = vi.mocked(sourcesApi.get)
const mockListInsights = vi.mocked(insightsApi.listForSource)
const mockCreateInsight = vi.mocked(insightsApi.create)
const mockGetCommandStatus = vi.mocked(insightsApi.getCommandStatus)
const mockListTransformations = vi.mocked(transformationsApi.list)

const notFoundError = Object.assign(new Error('Request failed with status code 404'), {
  isAxiosError: true,
  response: { status: 404 },
})

const networkError = Object.assign(new Error('Network Error'), {
  isAxiosError: true,
  response: undefined,
})

function renderContent(onClose?: () => void, sourceId = 'source:missing') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SourceDetailContent sourceId={sourceId} onClose={onClose} />
    </QueryClientProvider>
  )
}

const loadedSource: SourceDetailResponse = {
  id: 'source:loaded',
  title: 'Loaded source',
  asset: null,
  embedded: false,
  embedded_chunks: 0,
  insights_count: 0,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  full_text: 'Source content',
}

async function startInsightGeneration() {
  await screen.findByText('Loaded source')
  fireEvent.change(screen.getByRole('combobox', { name: 'transformation' }), {
    target: { value: 'transformation:summary' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'common.create' }))
}

describe('SourceDetailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListInsights.mockResolvedValue([])
    mockListTransformations.mockResolvedValue([{
      id: 'transformation:summary',
      title: 'Summary',
      name: 'summary',
      description: '',
      prompt: 'Summarize',
      apply_default: false,
      model_id: null,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
    }])
  })

  it('shows the shared not-found state when the source returns 404', async () => {
    mockSourcesGet.mockRejectedValue(notFoundError)

    renderContent()

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.notFoundTitle')).toBeInTheDocument()
    expect(screen.getByText('common.contentUnavailable.notFoundDescription')).toBeInTheDocument()
  })

  it('shows the shared load-error state for non-404 failures', async () => {
    mockSourcesGet.mockRejectedValue(networkError)

    renderContent()

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.errorTitle')).toBeInTheDocument()
    expect(
      screen.queryByText('common.contentUnavailable.notFoundTitle')
    ).not.toBeInTheDocument()
  })

  it('shows the not-found state over stale cached data when a refetch returns 404', async () => {
    // Simulates the orphan-reference path: the source was viewed (cached),
    // then deleted; reopening it serves the retained cache while the
    // background refetch 404s. React Query keeps the previous data alongside
    // the error — the definitive 404 must still win over the stale render.
    mockSourcesGet.mockRejectedValue(notFoundError)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const cachedSource: SourceDetailResponse = {
      id: 'source:stale',
      title: 'Deleted but cached',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'stale content',
    }
    // Mark the cached entry as stale (older than useSource's 30s staleTime)
    // so mounting triggers a refetch, which rejects with the 404 above.
    queryClient.setQueryData(QUERY_KEYS.source('source:stale'), cachedSource, {
      updatedAt: Date.now() - 60_000,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SourceDetailContent sourceId="source:stale" />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByText('Deleted but cached')).not.toBeInTheDocument()
  })

  it('invokes onClose from the not-found close button', async () => {
    mockSourcesGet.mockRejectedValue(notFoundError)
    const onClose = vi.fn()

    renderContent(onClose)

    await waitFor(() => {
      expect(screen.getByText('common.close')).toBeInTheDocument()
    })
    screen.getByText('common.close').click()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not start polling when creation finishes after unmount', async () => {
    mockSourcesGet.mockResolvedValue(loadedSource)
    let resolveCreate!: (value: Awaited<ReturnType<typeof insightsApi.create>>) => void
    mockCreateInsight.mockReturnValue(new Promise(resolve => {
      resolveCreate = resolve
    }))

    const view = renderContent(undefined, loadedSource.id)
    await startInsightGeneration()
    await waitFor(() => expect(mockCreateInsight).toHaveBeenCalled())

    view.unmount()
    await act(async () => {
      resolveCreate({
        status: 'pending',
        message: 'started',
        source_id: loadedSource.id,
        transformation_id: 'transformation:summary',
        command_id: 'job-1',
      })
    })

    expect(mockGetCommandStatus).not.toHaveBeenCalled()
  })

  it('shows the backend error when insight generation fails', async () => {
    mockSourcesGet.mockResolvedValue(loadedSource)
    mockCreateInsight.mockResolvedValue({
      status: 'pending',
      message: 'started',
      source_id: loadedSource.id,
      transformation_id: 'transformation:summary',
      command_id: 'job-1',
    })
    mockGetCommandStatus.mockResolvedValue({
      job_id: 'job-1',
      status: 'failed',
      error_message: 'Model ran out of memory',
    })

    renderContent(undefined, loadedSource.id)
    await startInsightGeneration()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'sources.insightGenerationFailed',
        expect.objectContaining({ description: 'Model ran out of memory' })
      )
    })
  })

  it('does not apply terminal effects when the job fails after unmount', async () => {
    mockSourcesGet.mockResolvedValue(loadedSource)
    mockCreateInsight.mockResolvedValue({
      status: 'pending',
      message: 'started',
      source_id: loadedSource.id,
      transformation_id: 'transformation:summary',
      command_id: 'job-1',
    })
    let resolveStatus!: (value: { job_id: string; status: string; error_message?: string }) => void
    mockGetCommandStatus.mockReturnValue(new Promise(resolve => {
      resolveStatus = resolve
    }))

    const view = renderContent(undefined, loadedSource.id)
    await startInsightGeneration()
    await waitFor(() => expect(mockGetCommandStatus).toHaveBeenCalledWith('job-1'))

    view.unmount()
    await act(async () => {
      resolveStatus({ job_id: 'job-1', status: 'failed', error_message: 'Stale failure' })
    })

    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('SourceDetailContent transformation titles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom lacks scrollIntoView and pointer capture, both needed by Radix.
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.HTMLElement.prototype.hasPointerCapture = vi.fn()
    window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  })

  const detailSource: SourceDetailResponse = {
    id: 'source:abc',
    title: 'My Paper',
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 1,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    full_text: 'content',
  }

  const makeTransformation = (id: string, name: string, title: string): Transformation => ({
    id,
    name,
    title,
    description: '',
    prompt: 'p',
    apply_default: false,
    model_id: null,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  })

  function renderLoaded() {
    mockSourcesGet.mockResolvedValue(detailSource)
    vi.mocked(transformationsApi.list).mockResolvedValue([
      makeTransformation('trans-1', 'dense_summary', 'Dense Summary'),
      makeTransformation('trans-2', 'my_rule', 'My Custom Rule'),
    ])
    vi.mocked(insightsApi.listForSource).mockResolvedValue([
      {
        id: 'ins-1',
        source_id: 'source:abc',
        insight_type: 'Dense Summary',
        content: 'Insight text',
        created: null,
        updated: null,
      },
    ])

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <SourceDetailContent sourceId="source:abc" />
      </QueryClientProvider>
    )
  }

  it('shows the localized label for a preset insight_type in the insights list', async () => {
    renderLoaded()

    // Radix TabsTrigger activates on mousedown, not click.
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /common\.insights/ }))

    // t() returns the key, so this text only appears via displayTransformationTitle.
    // The mocked transformation select also lists the same label as an
    // <option>, so assert on the insight-row badge specifically.
    const matches = await screen.findAllByText('sources.transformationTitleDenseSummary')
    expect(matches.some(el => el.tagName === 'SPAN' && el.className.includes('text-teal'))).toBe(true)
  })

  it('offers localized preset titles and verbatim custom titles in the transformation select', async () => {
    renderLoaded()

    await screen.findByText('My Paper')
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /common\.insights/ }))

    const trigger = await screen.findByRole('combobox')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)

    expect(
      await screen.findByRole('option', { name: 'sources.transformationTitleDenseSummary' })
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'My Custom Rule' })).toBeInTheDocument()
  })
})

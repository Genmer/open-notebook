import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VerificationPanel } from './VerificationPanel'
import {
  useDismissClaim,
  useProjectEnv,
  useProjectEnvVerification,
  useRewriteClaim,
  useSuggestClaimRewrite,
} from '@/lib/hooks/use-project-envs'
import { tasksApi } from '@/lib/api/tasks'
import type {
  ProjectEnvClaimPoint,
  ProjectEnvVerificationStatus,
} from '@/lib/types/api'

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvVerification: vi.fn(),
  useDismissClaim: vi.fn(),
  useRewriteClaim: vi.fn(),
  useProjectEnv: vi.fn(),
  useSuggestClaimRewrite: vi.fn(),
}))

vi.mock('@/lib/api/tasks', () => ({
  tasksApi: { cancel: vi.fn() },
}))

// Radix AlertDialog is unreliable in jsdom; probe the ConfirmDialog contract.
vi.mock('@/components/common/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    onConfirm,
  }: {
    open: boolean
    title: React.ReactNode
    onConfirm: () => void
  }) =>
    open ? (
      <div data-testid="confirm-probe">
        <span>{title}</span>
        <button type="button" onClick={onConfirm}>
          confirm
        </button>
      </div>
    ) : null,
}))

const mockVerification = vi.mocked(useProjectEnvVerification)
const mockDismiss = vi.mocked(useDismissClaim)
const mockRewrite = vi.mocked(useRewriteClaim)
const mockSuggest = vi.mocked(useSuggestClaimRewrite)
const mockEnv = vi.mocked(useProjectEnv)
const mockCancel = vi.mocked(tasksApi.cancel)

function point(overrides: Partial<ProjectEnvClaimPoint> = {}): ProjectEnvClaimPoint {
  return {
    point_id: 'p1',
    quote: '系统采用 MySQL 8.0 存储',
    field: 'tech_background',
    state: 'manual_review',
    manual_reason: 'exhausted',
    lanes: {
      A: { verdict: 'pass', issues: [] },
      B: { verdict: 'fail', issues: ['GA after project start'] },
      C: { verdict: 'pass', issues: [] },
    },
    rounds: [{ round: 1, action: 'verify', verdict: 'fail' }],
    ...overrides,
  }
}

function status(overrides: Partial<ProjectEnvVerificationStatus> = {}): ProjectEnvVerificationStatus {
  return {
    status: 'needs_review',
    job: null,
    progress: null,
    summary: { total: 3, passed: 1, manual: 1, uncovered: 1, failed: 0 },
    points: [point()],
    degraded: { single_model: true },
    ...overrides,
  }
}

describe('VerificationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerification.mockReturnValue({
      data: status(),
      isLoading: false,
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    mockDismiss.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDismissClaim>)
    mockRewrite.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      data: undefined,
    } as unknown as ReturnType<typeof useRewriteClaim>)
    mockSuggest.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      data: undefined,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestClaimRewrite>)
    mockEnv.mockReturnValue({
      data: { source_type: 'real' },
    } as unknown as ReturnType<typeof useProjectEnv>)
  })

  it('renders the full-scope summary line and degradation badges', () => {
    render(<VerificationPanel envId="env:1" />)
    expect(screen.getByText('projectEnvs.summaryLine')).toBeDefined()
    expect(screen.getByText('projectEnvs.degradedSingleModel')).toBeDefined()
    expect(screen.getByTestId('verification-review-banner')).toBeDefined()
  })

  it('maps lane verdicts and the manual-review reason onto the point card', () => {
    render(<VerificationPanel envId="env:1" />)
    const card = screen.getByTestId('claim-point-p1')
    expect(card.querySelector('button[title]') || card).toBeDefined()
    expect(screen.getByText('projectEnvs.fieldTechBackground')).toBeDefined()
    expect(screen.getByText('projectEnvs.reasonExhausted')).toBeDefined()
    expect(screen.getAllByText('projectEnvs.laneA').length).toBeGreaterThan(0)
    expect(screen.getByText('projectEnvs.stateManual')).toBeDefined()
  })

  it('renders the llm_error reason label for error-state points without claim actions', () => {
    mockVerification.mockReturnValue({
      data: status({
        points: [point({ state: 'error', manual_reason: 'llm_error' })],
      }),
      isLoading: false,
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    render(<VerificationPanel envId="env:1" />)

    expect(screen.getByText('projectEnvs.reasonLlmError')).toBeDefined()
    expect(screen.getByText('projectEnvs.stateError')).toBeDefined()
    // dismiss/rewrite stay manual_review-only (backend 409s other states)
    expect(screen.queryByText('projectEnvs.dismissAction')).toBeNull()
    expect(screen.queryByText('projectEnvs.rewriteAction')).toBeNull()
  })

  it('dismiss asks for confirmation before mutating', () => {
    const mutate = vi.fn()
    mockDismiss.mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDismissClaim>)
    render(<VerificationPanel envId="env:1" />)

    fireEvent.click(screen.getByText('projectEnvs.dismissAction'))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('projectEnvs.dismissTitle')).toBeDefined()

    fireEvent.click(screen.getByText('confirm'))
    expect(mutate).toHaveBeenCalledWith(
      { envId: 'env:1', pointId: 'p1' },
      expect.objectContaining({ onSettled: expect.any(Function) })
    )
  })

  it('submits a rewrite through the mutation and shows the failed-lane outcome', () => {
    const mutate = vi.fn()
    mockRewrite.mockReturnValue({
      mutate,
      isPending: false,
      isSuccess: true,
      data: {
        passed: false,
        lanes: {
          A: { verdict: 'fail', issues: ['no KB evidence'] },
        },
        env: {} as never,
      },
    } as unknown as ReturnType<typeof useRewriteClaim>)
    render(<VerificationPanel envId="env:1" />)

    fireEvent.click(screen.getByText('projectEnvs.rewriteAction'))
    const textarea = screen.getByTestId('claim-rewrite-input-p1') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '改写后的表述' } })
    fireEvent.click(screen.getByText('projectEnvs.rewriteSubmit'))

    expect(mutate).toHaveBeenCalledWith(
      { envId: 'env:1', pointId: 'p1', data: { text: '改写后的表述' } },
      expect.anything()
    )
    const result = screen.getByTestId('claim-rewrite-result-p1')
    expect(result.textContent).toContain('projectEnvs.rewriteFailed')
    expect(result.textContent).toContain('no KB evidence')
  })

  it('pending runs render progress and the cancel path cancels the backend job', async () => {
    mockVerification.mockReturnValue({
      data: status({
        status: 'pending',
        job: { id: 'job:1' },
        progress: { stage: 'verifying', percent: 40 },
      }),
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    const onCancel = vi.fn()
    render(<VerificationPanel envId="env:1" onCancel={onCancel} />)

    expect(screen.getByText('40%')).toBeDefined()
    expect(screen.getByText('projectEnvs.stageVerifying')).toBeDefined()

    fireEvent.click(screen.getByText('projectEnvs.cancelVerify'))
    fireEvent.click(screen.getByText('confirm'))
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('job:1'))
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
  })

  it('renders the expand → verify stepper highlighting the current phase and the detail line', () => {
    mockVerification.mockReturnValue({
      data: status({
        status: 'pending',
        job: { id: 'job:1' },
        progress: {
          stage: 'verifying',
          percent: 55,
          message: '三路验证 · 第 1 轮：8/12 个断言点已判定',
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    render(<VerificationPanel envId="env:1" />)

    // drafting done (phase 0), verifying active (phase 1), converge pending
    const phase0 = screen.getByTestId('verification-phase-0')
    const phase1 = screen.getByTestId('verification-phase-1')
    const phase2 = screen.getByTestId('verification-phase-2')
    expect(phase0).toHaveTextContent('projectEnvs.phaseDraft')
    expect(phase1).toHaveTextContent('projectEnvs.phaseVerify')
    expect(phase2).toHaveTextContent('projectEnvs.phaseConverge')
    expect(phase0.className).toContain('text-teal/70')
    expect(phase1.className).toContain('font-medium')
    expect(phase2.className).toContain('text-muted-foreground/60')
    expect(screen.getByTestId('verification-progress-message')).toHaveTextContent(
      '三路验证 · 第 1 轮：8/12 个断言点已判定'
    )
  })

  it('mock envs read the two-lane phase and drop the lane-A badge', () => {
    mockEnv.mockReturnValue({
      data: { source_type: 'mock' },
    } as unknown as ReturnType<typeof useProjectEnv>)
    mockVerification.mockReturnValue({
      data: status({
        status: 'pending',
        progress: { stage: 'verifying', percent: 55 },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    render(<VerificationPanel envId="env:1" />)

    expect(screen.getByTestId('verification-phase-1')).toHaveTextContent(
      'projectEnvs.phaseVerifyMock'
    )
    expect(screen.queryByText('projectEnvs.laneA')).toBeNull()
    expect(screen.getByText('projectEnvs.laneB')).toBeDefined()
    expect(screen.getByText('projectEnvs.laneC')).toBeDefined()
  })

  it('highlights the expand phase while the AI drafts the material', () => {
    mockVerification.mockReturnValue({
      data: status({
        status: 'pending',
        job: { id: 'job:1' },
        progress: { stage: 'drafting', percent: 10 },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    render(<VerificationPanel envId="env:1" />)

    expect(screen.getByText('projectEnvs.stageDrafting')).toBeDefined()
    expect(screen.getByTestId('verification-phase-0').className).toContain('font-medium')
    expect(screen.getByTestId('verification-phase-1').className).toContain(
      'text-muted-foreground/60'
    )
  })

  it('prefills the rewrite box with the original paragraph', () => {
    render(<VerificationPanel envId="env:1" />)
    fireEvent.click(screen.getByText('projectEnvs.rewriteAction'))
    const textarea = screen.getByTestId('claim-rewrite-input-p1') as HTMLTextAreaElement
    expect(textarea.value).toBe('系统采用 MySQL 8.0 存储')
    // cap mirrors the backend 4000-char limit (4001 -> 422)
    expect(textarea.getAttribute('maxlength')).toBe('4000')
  })

  it('renders the point quote with pre-wrap so paragraph line breaks survive', () => {
    render(<VerificationPanel envId="env:1" />)
    const quote = screen.getByText('系统采用 MySQL 8.0 存储')
    expect(quote.className).toContain('whitespace-pre-wrap')
  })

  it('shows the AI suggest action only for lanes_failed/exhausted points', () => {
    const { unmount } = render(<VerificationPanel envId="env:1" />)
    expect(screen.getByTestId('claim-suggest-p1')).toBeDefined()
    unmount()

    mockVerification.mockReturnValue({
      data: status({
        points: [point({ manual_reason: 'off_table', lanes: {} })],
      }),
      isLoading: false,
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    render(<VerificationPanel envId="env:2" />)
    expect(screen.queryByTestId('claim-suggest-p1')).toBeNull()
  })

  it('adopting a suggestion feeds the rewrite box without saving anything', () => {
    const suggestMutate = vi.fn()
    mockSuggest.mockReturnValue({
      mutate: suggestMutate,
      isPending: false,
      isError: false,
      data: {
        suggestion: '系统采用 MySQL 5.7 存储',
        explanation: 'GA moved before period start',
      },
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestClaimRewrite>)
    render(<VerificationPanel envId="env:1" />)

    fireEvent.click(screen.getByTestId('claim-suggest-p1'))
    expect(suggestMutate).toHaveBeenCalledWith({ envId: 'env:1', pointId: 'p1' })
    expect(screen.getByTestId('suggest-panel')).toBeDefined()
    expect(screen.getByTestId('suggest-adopt')).toBeDefined()
    expect(screen.getByTestId('suggest-discard')).toBeDefined()

    fireEvent.click(screen.getByTestId('suggest-adopt'))
    const textarea = screen.getByTestId('claim-rewrite-input-p1') as HTMLTextAreaElement
    expect(textarea.value).toBe('系统采用 MySQL 5.7 存储')
  })

  it('discarding the suggestion closes the panel and shows the loading state while pending', () => {
    const reset = vi.fn()
    mockSuggest.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      data: { suggestion: 's', explanation: 'e' },
      reset,
    } as unknown as ReturnType<typeof useSuggestClaimRewrite>)
    const first = render(<VerificationPanel envId="env:1" />)
    fireEvent.click(screen.getByTestId('claim-suggest-p1'))
    fireEvent.click(screen.getByTestId('suggest-discard'))
    expect(reset).toHaveBeenCalled()
    expect(screen.queryByTestId('suggest-panel')).toBeNull()
    first.unmount()

    // Real flow: the click opens the panel, the in-flight mutation then flips
    // the same instance into its loading state.
    const idle = {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      data: undefined,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestClaimRewrite>
    mockSuggest.mockReturnValue(idle)
    const { rerender, unmount } = render(<VerificationPanel envId="env:3" />)
    fireEvent.click(screen.getByTestId('claim-suggest-p1'))

    mockSuggest.mockReturnValue({
      ...idle,
      isPending: true,
    } as unknown as ReturnType<typeof useSuggestClaimRewrite>)
    rerender(<VerificationPanel envId="env:3" />)
    expect(screen.getByTestId('suggest-loading')).toBeDefined()
    unmount()
  })
})

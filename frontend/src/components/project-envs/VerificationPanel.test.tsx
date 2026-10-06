import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VerificationPanel } from './VerificationPanel'
import {
  useDismissClaim,
  useProjectEnvVerification,
  useRewriteClaim,
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
})

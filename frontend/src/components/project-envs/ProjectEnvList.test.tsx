import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProjectEnvList } from './ProjectEnvList'
import {
  useDeleteProjectEnv,
  useDuplicateProjectEnv,
  useRegenerateProjectEnv,
  useReverifyProjectEnv,
} from '@/lib/hooks/use-project-envs'
import type { ProjectEnv } from '@/lib/types/api'

// t() is mocked globally in setup.ts (returns the key string)

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useDeleteProjectEnv: vi.fn(),
  useDuplicateProjectEnv: vi.fn(),
  useRegenerateProjectEnv: vi.fn(),
  useReverifyProjectEnv: vi.fn(),
}))

function mockMutation() {
  return { mutate: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof useRegenerateProjectEnv
  >
}

const baseEnv = {
  id: 'project_env:e1',
  name: '电商平台重构',
  background: '某电商平台微服务化改造项目',
  period_start: '2025.01',
  period_end: '2025.08',
  source_type: 'mock',
  keywords: ['微服务'],
  tech_background: 'Spring Boot 3.2',
  tuning_process: null,
  problems_solutions: null,
  my_role: null,
  scale: null,
  draft_content: null,
  status: 'verified',
  ai_assisted: null,
  time_adjusted: null,
  time_warnings: [],
  pending_claims_count: 0,
  session_ref_count: 0,
  verification_progress: null,
  has_snapshot: false,
  active_job_id: null,
  created: '',
  updated: '',
} as unknown as ProjectEnv

function setup(env: Partial<ProjectEnv>) {
  const onOpenVerification = vi.fn()
  const onOpenDetail = vi.fn()
  render(
    <ProjectEnvList
      envs={[{ ...baseEnv, ...env } as ProjectEnv]}
      isLoading={false}
      onOpenVerification={onOpenVerification}
      onOpenDetail={onOpenDetail}
    />
  )
  return { onOpenVerification, onOpenDetail }
}

describe('ProjectEnvList StatusBadge material states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDeleteProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useDeleteProjectEnv>
    )
    vi.mocked(useDuplicateProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useDuplicateProjectEnv>
    )
    vi.mocked(useRegenerateProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useRegenerateProjectEnv>
    )
    vi.mocked(useReverifyProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useReverifyProjectEnv>
    )
  })

  it('renders the material_pending badge and reopens the wizard on click', () => {
    const { onOpenVerification } = setup({ status: 'material_pending' })

    const badge = screen.getByTestId('env-material-pending-project_env:e1')
    expect(badge.textContent).toContain('projectEnvs.statusMaterialPending')
    fireEvent.click(badge)
    expect(onOpenVerification).toHaveBeenCalledWith('project_env:e1')
  })

  it('renders the material_ready badge and reopens the wizard on click', () => {
    const { onOpenVerification } = setup({ status: 'material_ready' })

    const badge = screen.getByTestId('env-material-ready-project_env:e1')
    expect(badge.textContent).toContain('projectEnvs.statusMaterialReady')
    fireEvent.click(badge)
    expect(onOpenVerification).toHaveBeenCalledWith('project_env:e1')
  })

  it('keeps failed on the destructive badge with no reopen affordance', () => {
    setup({ status: 'failed' })

    expect(screen.getByText('projectEnvs.statusFailed')).toBeInTheDocument()
    expect(
      screen.queryByTestId('env-material-pending-project_env:e1')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('env-material-ready-project_env:e1')
    ).not.toBeInTheDocument()
  })

  it('keeps verified as a plain (non-clickable) badge', () => {
    const { onOpenVerification } = setup({ status: 'verified' })

    expect(screen.getByText('projectEnvs.statusVerified')).toBeInTheDocument()
    fireEvent.click(screen.getByText('projectEnvs.statusVerified'))
    expect(onOpenVerification).not.toHaveBeenCalled()
  })

  it('disables regenerate while material_pending is running', () => {
    setup({ status: 'material_pending' })

    expect(
      screen.getByRole('button', { name: 'projectEnvs.regenerate' })
    ).toBeDisabled()
  })

  it('keeps regenerate enabled on a settled env', () => {
    setup({ status: 'verified' })

    expect(
      screen.getByRole('button', { name: 'projectEnvs.regenerate' })
    ).not.toBeDisabled()
  })
})

describe('ProjectEnvList copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDeleteProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useDeleteProjectEnv>
    )
    vi.mocked(useRegenerateProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useRegenerateProjectEnv>
    )
    vi.mocked(useReverifyProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useReverifyProjectEnv>
    )
  })

  it('carries generic_paragraph into the duplicate request', () => {
    const duplicate = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDuplicateProjectEnv).mockReturnValue(
      duplicate as unknown as ReturnType<typeof useDuplicateProjectEnv>
    )
    setup({ generic_paragraph: '通用段落内容____。' })

    fireEvent.click(screen.getByRole('button', { name: 'projectEnvs.copy' }))
    expect(duplicate.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ generic_paragraph: '通用段落内容____。' }),
      expect.anything()
    )
  })
})

describe('ProjectEnvList whole-card open detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDeleteProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useDeleteProjectEnv>
    )
    vi.mocked(useDuplicateProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useDuplicateProjectEnv>
    )
    vi.mocked(useRegenerateProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useRegenerateProjectEnv>
    )
    vi.mocked(useReverifyProjectEnv).mockReturnValue(
      mockMutation() as unknown as ReturnType<typeof useReverifyProjectEnv>
    )
  })

  it('opens the detail dialog when the card body itself is clicked', () => {
    const { onOpenDetail } = setup({})

    fireEvent.click(screen.getByTestId('env-card-project_env:e1'))
    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'project_env:e1' }))
  })

  it('opens the detail dialog on Enter and Space, but not on Tab', () => {
    const { onOpenDetail } = setup({})
    const card = screen.getByTestId('env-card-project_env:e1')

    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onOpenDetail).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(card, { key: ' ' })
    expect(onOpenDetail).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(card, { key: 'Tab' })
    expect(onOpenDetail).toHaveBeenCalledTimes(2)
  })

  it('keeps keyboard focus inside an inner button out of the card handler', () => {
    const { onOpenDetail } = setup({})

    // keydown bubbles up to the card, but the target guard must return early
    fireEvent.keyDown(screen.getByTestId('env-open-detail-project_env:e1'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'projectEnvs.copy' }), { key: 'Enter' })
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('clicking the pending badge reopens the wizard without opening the detail', () => {
    const { onOpenVerification, onOpenDetail } = setup({ status: 'pending' })

    fireEvent.click(screen.getByTestId('env-pending-project_env:e1'))
    expect(onOpenVerification).toHaveBeenCalledWith('project_env:e1')
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('clicking the material_ready badge reopens the wizard without opening the detail', () => {
    const { onOpenVerification, onOpenDetail } = setup({ status: 'material_ready' })

    fireEvent.click(screen.getByTestId('env-material-ready-project_env:e1'))
    expect(onOpenVerification).toHaveBeenCalledWith('project_env:e1')
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('regenerate, copy and delete stay isolated from the card click', () => {
    const regenerate = { mutate: vi.fn(), isPending: false }
    vi.mocked(useRegenerateProjectEnv).mockReturnValue(
      regenerate as unknown as ReturnType<typeof useRegenerateProjectEnv>
    )
    const duplicate = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDuplicateProjectEnv).mockReturnValue(
      duplicate as unknown as ReturnType<typeof useDuplicateProjectEnv>
    )
    const { onOpenDetail } = setup({})

    fireEvent.click(screen.getByRole('button', { name: 'projectEnvs.regenerate' }))
    expect(regenerate.mutate).toHaveBeenCalledWith('project_env:e1')

    fireEvent.click(screen.getByRole('button', { name: 'projectEnvs.copy' }))
    expect(duplicate.mutate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'projectEnvs.deleteTitle' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('clicking the name button opens the detail exactly once', () => {
    const { onOpenDetail } = setup({})

    fireEvent.click(screen.getByTestId('env-open-detail-project_env:e1'))
    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'project_env:e1' }))
  })
})

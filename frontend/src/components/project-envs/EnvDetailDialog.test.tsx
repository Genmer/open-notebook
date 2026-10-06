import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnvDetailDialog } from './EnvDetailDialog'
import type { ProjectEnv } from '@/lib/types/api'
import { useProjectEnvVerification } from '@/lib/hooks/use-project-envs'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvVerification: vi.fn(),
}))

const mockVerification = vi.mocked(useProjectEnvVerification)

const baseEnv = {
  id: 'project_env:e1',
  name: '内部应用助手',
  background: '系统采用 MySQL 8.0 存储。',
  period_start: '2024.12',
  period_end: '2025.09',
  source_type: 'mock',
  keywords: ['制造业', 'MES'],
  tech_background: 'Spring Boot 3.2。',
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
  has_snapshot: true,
  active_job_id: null,
  created: '',
  updated: '',
} as unknown as ProjectEnv

describe('EnvDetailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerification.mockReturnValue({
      data: { status: 'verified', summary: {}, degraded: {}, points: [] },
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
  })

  it('renders the promoted material sections and keywords', () => {
    render(
      <EnvDetailDialog env={baseEnv} open onOpenChange={vi.fn()} />
    )

    expect(screen.getByText('内部应用助手')).toBeInTheDocument()
    // Badge renders "🤖 <label>" across nodes, so match on the label fragment
    expect(screen.getByText(/projectEnvs\.sourceMock/)).toBeInTheDocument()
    expect(screen.getByText('制造业')).toBeInTheDocument()
    const sections = screen.getByTestId('env-detail-sections')
    expect(sections.textContent).toContain('MySQL 8.0')
    expect(sections.textContent).toContain('Spring Boot 3.2')
  })

  it('prefers draft content for pending mock envs and shows the empty hint when blank', () => {
    const pending = {
      ...baseEnv,
      status: 'pending',
      background: '',
      tech_background: '',
      draft_content: { background: '草稿：模拟项目背景。' },
    } as unknown as ProjectEnv
    const { rerender } = render(
      <EnvDetailDialog env={pending} open onOpenChange={vi.fn()} />
    )
    expect(screen.getByTestId('env-detail-sections').textContent).toContain('草稿：模拟项目背景')

    const blank = {
      ...baseEnv,
      background: '',
      tech_background: '',
      draft_content: null,
    } as unknown as ProjectEnv
    rerender(<EnvDetailDialog env={blank} open onOpenChange={vi.fn()} />)
    expect(screen.queryByTestId('env-detail-sections')).not.toBeInTheDocument()
    expect(screen.getByText('projectEnvs.detailEmpty')).toBeInTheDocument()
  })
})

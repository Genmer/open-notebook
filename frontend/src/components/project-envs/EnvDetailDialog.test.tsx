import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnvDetailDialog } from './EnvDetailDialog'
import type { ProjectEnv } from '@/lib/types/api'
import {
  useProjectEnv,
  useProjectEnvVerification,
  useGenerateGenericParagraph,
} from '@/lib/hooks/use-project-envs'
import { projectEnvsApi } from '@/lib/api/project-envs'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvVerification: vi.fn(),
  useProjectEnv: vi.fn(),
  useGenerateGenericParagraph: vi.fn(),
}))

vi.mock('@/lib/api/project-envs', () => ({
  projectEnvsApi: { update: vi.fn() },
}))

vi.mock('@/lib/utils/error-handler', () => ({
  getApiErrorMessage: vi.fn(() => ''),
}))

// GenericParagraphSection only invalidates queries after a successful save;
// the stub keeps the dialog testable without a QueryClientProvider wrapper.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

const mockVerification = vi.mocked(useProjectEnvVerification)
const mockEnv = vi.mocked(useProjectEnv)
const mockGenerate = vi.mocked(useGenerateGenericParagraph)
const mockUpdate = vi.mocked(projectEnvsApi.update)

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

function mutationStub() {
  return { mutate: vi.fn(), isPending: false, reset: vi.fn() }
}

// Real mock-material sample (verified TMS environment): dense single-paragraph
// Chinese prose the visual blocks are extracted from.
const tmsEnv = {
  ...baseEnv,
  id: 'project_env:jpal7suzy62ytdyjdpym',
  name: 'AI 模拟项目',
  background:
    '2024年12月，我所在的软件公司承接了某全国连锁便利企业的智能TMS（运输管理系统）建设项目。该企业在全国拥有超过6000家门店，城配物流体系庞大，但排线长期依赖调度员的人工经验：单次排线耗时超过2小时，车辆平均装载率仅为68%，排线质量参差不齐。我作为项目负责人，全面主持了需求分析、架构设计与实施落地工作，项目最终于2025年9月通过验收。',
  tech_background:
    '在技术选型上，我主导确定了以开源路径优化组合为核心的AI技术栈。路径优化内核选用Google OR-Tools 9.11求解带时间窗的车辆路径问题（VRPTW），其约束编程与元启发式能力可灵活建模多车型、多时间窗等城配约束；距离矩阵由OSRM 5.28基于真实路网预计算；地理数据采用PostgreSQL 17加PostGIS 3.5进行空间存储与分析。此外，系统整体采用微服务架构，排线服务无状态化设计。',
  tuning_process:
    '2025年5月，系统进入性能攻坚阶段。我组织团队使用JMeter 5.6对排线接口开展压测，模拟早高峰批量排线场景，发现P99响应时间高达9秒，远超3秒的性能目标。经定位，耗时主要集中于求解器的首次解构造与串行搜索过程。为此我主导了针对性参数调优：一是将OR-Tools的首次解策略由默认的自动选择调整为路径最短启发式（PATH_CHEAPEST_ARC），显著改善初始解质量；二是引入大规模邻域搜索（LNS）增强局部寻优能力；三是开启并行搜索，充分利用多核算力并行探索解空间。复测显示，排线接口P99降至2.1秒。随后系统完成灰度上线并全量推广。',
  problems_solutions:
    '项目实施中我重点解决了三个关键问题。其一，超大规模门店订单使距离矩阵计算与整体求解耗时不可控。我利用OSRM离线预计算门店间距离矩阵并缓存于Redis，同时按配送区域将大规模VRPTW问题拆分为区域子问题并行求解，使排线耗时从小时级降至分钟级。其二，车辆平均装载率长期偏低。我重新设计了排线目标函数，引入软约束平衡行驶距离与装载率。其三，高峰期订单激增导致求解超时。我设计了动态分级求解策略，按订单优先级分批求解，保证高峰期服务可用。最终装载率稳定达到85%以上，排线自动化率达到90%，全面达成立项目标。',
  my_role:
    '作为项目负责人兼系统架构师，我全面主持项目的立项论证、需求分析、总体架构设计与技术选型。',
  scale: '我组建并带领项目团队共15人，涵盖项目经理、系统架构师、算法工程师、前后端开发、测试及运维等角色。系统管理该企业全国门店的主数据与空间坐标信息，日均处理约2.8万条配送订单。',
} as unknown as ProjectEnv

describe('EnvDetailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockResolvedValue(baseEnv)
    mockGenerate.mockReturnValue(
      mutationStub() as unknown as ReturnType<typeof useGenerateGenericParagraph>
    )
    mockVerification.mockReturnValue({
      data: { status: 'verified', summary: {}, degraded: {}, points: [] },
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvVerification>)
    // VerificationPanel reads the env row for lane-mode awareness.
    mockEnv.mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useProjectEnv>)
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

  it('offers a stop button while a verification run is pending', () => {
    mockVerification.mockReturnValue({
      data: {
        status: 'pending',
        summary: {},
        degraded: {},
        points: [],
        progress: { stage: 'verifying', percent: 5 },
      },
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvVerification>)

    render(
      <EnvDetailDialog env={{ ...baseEnv, status: 'pending' } as unknown as ProjectEnv} open onOpenChange={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'projectEnvs.cancelVerify' })).toBeInTheDocument()
  })

  it('renders the generic paragraph markup literally and never via innerHTML', () => {
    const { container } = render(
      <EnvDetailDialog
        env={
          {
            ...baseEnv,
            generic_paragraph: '项目采用<u>微服务架构</u>，团队规模____人。',
          } as unknown as ProjectEnv
        }
        open
        onOpenChange={vi.fn()}
      />
    )

    const text = screen.getByTestId('generic-paragraph-text')
    // Literal markup, no HTML rendering
    expect(text.textContent).toContain('<u>微服务架构</u>')
    expect(text.textContent).toContain('____')
    expect(container.innerHTML).not.toContain('<u>')
    expect(container.querySelector('u')).toBeNull()
  })

  it('saves the edited paragraph through PUT with the trimmed value', async () => {
    render(
      <EnvDetailDialog
        env={{ ...baseEnv, generic_paragraph: ' 旧段落 ' } as unknown as ProjectEnv}
        open
        onOpenChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('generic-paragraph-edit'))
    const input = screen.getByTestId('generic-paragraph-input') as HTMLTextAreaElement
    expect(input.value).toBe(' 旧段落 ')
    fireEvent.change(input, { target: { value: ' 新段落内容 ' } })
    fireEvent.click(screen.getByTestId('generic-paragraph-save'))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('project_env:e1', {
        generic_paragraph: '新段落内容',
      })
    )
    // Saved state drops the textarea again
    await waitFor(() =>
      expect(screen.getByTestId('generic-paragraph-text').textContent).toBe('旧段落')
    )
  })

  it('fills the edit box with an AI-generated paragraph without saving it', () => {
    const generateMutate = vi.fn((_envId: string, opts?: { onSuccess?: (d: { paragraph: string }) => void }) => {
      opts?.onSuccess?.({ paragraph: 'AI 生成的通用段落，规模____。' })
    })
    mockGenerate.mockReturnValue(
      {
        mutate: generateMutate,
        isPending: false,
        reset: vi.fn(),
      } as unknown as ReturnType<typeof useGenerateGenericParagraph>
    )
    render(<EnvDetailDialog env={baseEnv} open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByTestId('generic-paragraph-generate'))

    const input = screen.getByTestId('generic-paragraph-input') as HTMLTextAreaElement
    expect(input.value).toBe('AI 生成的通用段落，规模____。')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('caps the edit box at 5000 chars and clears the paragraph with an empty save', async () => {
    render(
      <EnvDetailDialog
        env={{ ...baseEnv, generic_paragraph: '旧段落' } as unknown as ProjectEnv}
        open
        onOpenChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('generic-paragraph-edit'))
    const input = screen.getByTestId('generic-paragraph-input') as HTMLTextAreaElement
    expect(input.getAttribute('maxlength')).toBe('5000')

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByTestId('generic-paragraph-save'))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('project_env:e1', {
        generic_paragraph: null,
      })
    )
  })

  it('renders the header timeline with the period labels', () => {
    render(<EnvDetailDialog env={baseEnv} open onOpenChange={vi.fn()} />)

    const timeline = screen.getByTestId('env-detail-timeline')
    expect(timeline.textContent).toContain('2024.12')
    expect(timeline.textContent).toContain('2025.09')
  })

  it('renders the structured visual blocks for dense mock material', () => {
    render(<EnvDetailDialog env={tmsEnv} open onOpenChange={vi.fn()} />)

    // Metric tiles — scale 退出扫描源后仅 background 容量卡（15人 卡废除）
    const metrics = screen.getByTestId('env-detail-metrics')
    expect(metrics.textContent).toContain('6000')
    expect(metrics.textContent).not.toContain('15')

    // Tech stack cards
    const tech = screen.getByTestId('env-detail-tech')
    expect(tech.textContent).toContain('OR-Tools')
    expect(tech.textContent).toContain('9.11')
    expect(tech.textContent).toContain('OSRM')

    // Tuning flow with numbered action steps and the outcome node
    expect(screen.getByTestId('env-detail-tuning-flow')).toBeInTheDocument()
    expect(screen.getByTestId('env-detail-tuning-lead')).toBeInTheDocument()
    expect(screen.getByTestId('env-detail-step-1')).toBeInTheDocument()
    expect(screen.getByTestId('env-detail-step-2')).toBeInTheDocument()
    expect(screen.getByTestId('env-detail-step-3')).toBeInTheDocument()
    const outcome = screen.getByTestId('env-detail-tuning-outcome')
    expect(outcome.textContent).toContain('2.1秒')

    // Problem→solution pairs
    expect(screen.getByTestId('env-detail-pairs').textContent).toContain('三个关键问题')
    expect(screen.getByTestId('env-detail-pair-problem-0').textContent).toContain(
      '超大规模门店订单'
    )
    expect(screen.getByTestId('env-detail-pair-solution-0').textContent).toContain('Redis')

    // Role card with the extracted headline
    const roleCard = screen.getByTestId('env-detail-role-card')
    expect(roleCard.textContent).toContain('项目负责人兼系统架构师')
    expect(roleCard.textContent).toContain('立项论证')

    // Scale 卡退场：即使存量数据仍带 scale 文本也不渲染
    expect(screen.queryByTestId('env-detail-scale-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('env-detail-sections').textContent).not.toContain('2.8万条')
  })

  it('falls back to the plain text sections when no structure can be extracted', () => {
    const unstructured = {
      ...baseEnv,
      tech_background: '技术细节涉及内部合规要求，暂不展开。',
      my_role: '我负责后端开发工作。',
      tuning_process: '我们持续观察线上指标并逐步调整参数，整体平稳。',
      problems_solutions: '项目推进整体顺利。',
    } as unknown as ProjectEnv
    render(<EnvDetailDialog env={unstructured} open onOpenChange={vi.fn()} />)

    expect(screen.queryByTestId('env-detail-tech')).not.toBeInTheDocument()
    expect(screen.queryByTestId('env-detail-metrics')).not.toBeInTheDocument()
    expect(screen.queryByTestId('env-detail-role-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('env-detail-tuning-flow')).not.toBeInTheDocument()
    expect(screen.queryByTestId('env-detail-pairs')).not.toBeInTheDocument()

    // Open sections render inline (always in the DOM)
    const sections = screen.getByTestId('env-detail-sections')
    expect(sections.textContent).toContain('内部合规要求')
    expect(sections.textContent).toContain('我负责后端开发工作')

    // Collapsed fallbacks keep the source text out of the DOM until opened
    expect(sections.textContent).not.toContain('我们持续观察线上指标')
    fireEvent.click(screen.getByText('projectEnvs.fieldTuning'))
    expect(sections.textContent).toContain('我们持续观察线上指标并逐步调整参数')

    expect(sections.textContent).not.toContain('项目推进整体顺利')
    fireEvent.click(screen.getByText('projectEnvs.fieldProblems'))
    expect(sections.textContent).toContain('项目推进整体顺利')
  })
})

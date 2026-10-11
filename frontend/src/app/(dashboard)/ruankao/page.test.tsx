import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuankaoPage from './page'
import { RUANKAO_TABS } from '@/lib/ruankao/tabs'

let tabParam: string | null = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/ruankao',
  useSearchParams: () => new URLSearchParams(tabParam ? `tab=${tabParam}` : ''),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvs: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCreateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  useMockGenerateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  usePolishBackground: () => ({ mutate: vi.fn(), isPending: false }),
  useProjectEnv: () => ({ data: undefined, isError: false }),
}))

// modelLibrary 已填槽：面板走真实 react-query hooks，页测试无 QueryClient
// 包装，照 EnvironmentsPanel.test 的子组件 stub 先例替换为纯 div
vi.mock('@/components/ruankao/ModelLibraryPanel', () => ({
  ModelLibraryPanel: () => <div data-testid="model-library-stub" />,
}))

// questionBank 已填槽：面板为 localStorage 纯前端组件，同样 stub 成纯 div，
// 让页测试只关心 tab 壳行为
vi.mock('@/components/ruankao/QuestionBankPanel', () => ({
  QuestionBankPanel: () => <div data-testid="question-bank-stub" />,
}))

// essay 已填槽（批次4 第一步）：EssayPanel 真渲染（home 视图 + read 深链），
// 其数据 hooks 用罐头（空库 + 无标记状态），照 use-project-envs mock 块同位追加
vi.mock('@/lib/hooks/use-essay-marks', () => ({
  useEssayMarksLibrary: () => ({
    data: {
      stats: { marked_sources: 0, marked_groups: 0, effective_total: 0 },
      groups: [],
      sources: [],
      dangling_marks: [],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useEssayMarkStatus: () => ({ data: { source: null }, isError: false, refetch: vi.fn() }),
}))

function activeTab() {
  return screen
    .getAllByTestId(/^ruankao-tab-/)
    .find((el) => el.getAttribute('data-state') === 'active')
}

describe('RuankaoPage tab container', () => {
  beforeEach(() => {
    tabParam = null
  })

  it('keeps the registry as the single source of truth for tab order and ids', () => {
    expect(RUANKAO_TABS.map((tab) => tab.key)).toEqual([
      'environments',
      'questionBank',
      'modelLibrary',
      'essay',
      'hotTopics',
    ])
    expect(RUANKAO_TABS.map((tab) => tab.testid)).toEqual([
      'ruankao-tab-environments',
      'ruankao-tab-questionBank',
      'ruankao-tab-modelLibrary',
      'ruankao-tab-essay',
      'ruankao-tab-hotTopics',
    ])
  })

  it('lands on the environments tab by default with the migrated page body', () => {
    render(<RuankaoPage />)

    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-environments')
    // 原样平移：标题/新建按钮（页头+空态各一枚，沿用原 testid）/行业池小节
    expect(screen.getAllByTestId('env-create-button').length).toBeGreaterThan(0)
    expect(screen.getByTestId('ruankao-industry-search')).toBeInTheDocument()
  })

  it('honours a valid ?tab= deep link as the initial tab only', () => {
    tabParam = 'hotTopics'
    render(<RuankaoPage />)

    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-hotTopics')
    expect(screen.getByText('ruankao.hotTopics.plannedTitle')).toBeInTheDocument()
  })

  it('falls back to the first tab on an invalid ?tab=', () => {
    tabParam = 'not-a-tab'
    render(<RuankaoPage />)

    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-environments')
  })

  it('honours a ?tab=questionBank deep link to the filled slot', () => {
    tabParam = 'questionBank'
    render(<RuankaoPage />)

    // questionBank 填槽后深链直达（内容为 stub）
    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-questionBank')
    expect(screen.getByTestId('question-bank-stub')).toBeInTheDocument()
  })

  it('shows all five tabs now that the essay slot is filled, and deep-links into it', () => {
    tabParam = 'essay'
    render(<RuankaoPage />)

    // essay 填槽后注册表五 tab 全部在场（此前唯一 null 槽已交付）
    expect(screen.getByTestId('ruankao-tab-environments')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-tab-questionBank')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-tab-modelLibrary')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-tab-essay')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-tab-hotTopics')).toBeInTheDocument()
    // essay 深链直达：真实 EssayPanel 渲染 home 视图（数据 hooks 已 mock）
    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-essay')
    expect(screen.getByTestId('ruankao-essay-home')).toBeInTheDocument()
  })

  it('switches tabs in place without unmounting the page shell', () => {
    render(<RuankaoPage />)

    // Radix TabsTrigger activates on mousedown, not click (repo precedent)
    fireEvent.mouseDown(screen.getByTestId('ruankao-tab-hotTopics'))

    // 同页切换：模块标题仍在，热度榜空态出现，未激活 tab 的内容卸载
    expect(screen.getByText('ruankao.title')).toBeInTheDocument()
    expect(screen.getByText('ruankao.hotTopics.plannedTitle')).toBeInTheDocument()
    expect(screen.queryByTestId('env-create-button')).not.toBeInTheDocument()
  })

  it('follows an in-page ?tab= change (question-bank detail deep links)', () => {
    tabParam = 'questionBank'
    const { rerender } = render(<RuankaoPage />)
    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-questionBank')

    // 题库详情动作 router.push 切 tab（?tab=environments / ?tab=essay&read=…）：
    // URL 变化经同步 effect 跟随，页面壳不重挂载（模块标题元素仍在文档中）
    tabParam = 'environments'
    rerender(<RuankaoPage />)
    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-environments')

    // 非法 tab 不打扰当前激活 tab
    tabParam = 'not-a-tab'
    rerender(<RuankaoPage />)
    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-environments')
  })

  it('constrains the content column with the L-line container convention (宽屏治理 P1-1)', () => {
    render(<RuankaoPage />)

    // 内容列宽约定（L 线 §2.1）：容器同含 mx-auto 与 max-w-6xl，
    // 一处覆盖全部 tab；testid 供布局门禁寻址
    const container = screen.getByTestId('ruankao-page-content')
    expect(container).toHaveClass('mx-auto')
    expect(container).toHaveClass('max-w-6xl')
  })
})

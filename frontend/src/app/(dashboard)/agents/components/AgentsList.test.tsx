import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentsList } from './AgentsList'
import { Agent } from '@/lib/types/agents'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-agents', () => ({
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({
    data: [
      { id: 'model:gpt', name: 'GPT Test', provider: 'openai', type: 'language' },
    ],
    isLoading: false,
  }),
}))

// Mock Tooltip components to avoid Radix UI async issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'agent:1',
  name: 'Researcher',
  system_prompt: 'Be rigorous.',
  description: 'Default research persona',
  model_id: 'model:gpt',
  temperature: 0.2,
  max_tokens: 1024,
  enabled: true,
  sort_order: 0,
  in_use_session_count: 0,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('AgentsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an empty state when there are no agents', () => {
    render(<AgentsList agents={[]} isLoading={false} onEdit={vi.fn()} />)
    expect(screen.getByTestId('agents-empty')).toBeInTheDocument()
  })

  it('renders one card per agent with model and sampling info', () => {
    render(
      <AgentsList
        agents={[makeAgent(), makeAgent({ id: 'agent:2', name: 'Writer' })]}
        isLoading={false}
        onEdit={vi.fn()}
      />
    )
    expect(screen.getByTestId('agent-card-agent:1')).toBeInTheDocument()
    expect(screen.getByTestId('agent-card-agent:2')).toBeInTheDocument()
    // both cards bind model:gpt, so shared badges appear once per card
    expect(screen.getAllByText('GPT Test')).toHaveLength(2)
    expect(screen.getAllByText('agents.temperatureLabel')).toHaveLength(2)
    expect(screen.getAllByText('agents.maxTokensLabel')).toHaveLength(2)
  })

  it('marks disabled agents and hides unset sampling params', () => {
    render(
      <AgentsList
        agents={[makeAgent({ enabled: false, temperature: null, max_tokens: null, model_id: null })]}
        isLoading={false}
        onEdit={vi.fn()}
      />
    )
    expect(screen.getByText('agents.disabled')).toBeInTheDocument()
    expect(screen.queryByText(/temperatureLabel/)).not.toBeInTheDocument()
    expect(screen.queryByText(/maxTokensLabel/)).not.toBeInTheDocument()
  })

  it('shows in-use count and asks for confirmation before delete', () => {
    render(
      <AgentsList
        agents={[makeAgent({ in_use_session_count: 3 })]}
        isLoading={false}
        onEdit={vi.fn()}
      />
    )
    expect(screen.getByText('agents.inUse')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('agent-delete-agent:1'))
    expect(screen.getByText('agents.deleteConfirmDesc')).toBeInTheDocument()
  })

  it('calls onEdit with the agent id', () => {
    const onEdit = vi.fn()
    render(<AgentsList agents={[makeAgent()]} isLoading={false} onEdit={onEdit} />)
    fireEvent.click(screen.getByTestId('agent-edit-agent:1'))
    expect(onEdit).toHaveBeenCalledWith('agent:1')
  })

  it('renders a help tooltip next to the temperature value', () => {
    render(<AgentsList agents={[makeAgent()]} isLoading={false} onEdit={vi.fn()} />)
    // 触发器 span：温度文本可见，且携带帮助文案的 aria-label 与图标
    const trigger = screen.getByText('agents.temperatureLabel').closest('span')
    expect(trigger).toHaveAttribute('aria-label', 'agents.temperatureHelp')
    // 提示内容本体（tooltip 直通 mock）也渲染帮助文案
    expect(screen.getByText('agents.temperatureHelp')).toBeInTheDocument()
  })

  it('applies compact design tokens: single-layer padding, 3-line clamp, gradient avatar, 6-col grid', () => {
    render(<AgentsList agents={[makeAgent()]} isLoading={false} onEdit={vi.fn()} />)
    // ① 渐变头像（新 testid）：完整渐变类 + 圆形 48px 白字 + 首字符
    const avatar = screen.getByTestId('agent-avatar-agent:1')
    expect(avatar).toHaveClass('bg-gradient-to-br', 'rounded-full', 'size-12', 'text-white')
    expect(avatar).toHaveTextContent('R') // 'Researcher' 首字符
    // ② 描述放开到 3 行
    expect(screen.getByText('Default research persona')).toHaveClass('line-clamp-3')
    // ③ 单层 padding 防回归：Card 无自身纵向 padding，CardContent 唯一 padding 层
    const card = screen.getByTestId('agent-card-agent:1')
    expect(card).toHaveClass('py-0', 'gap-0')
    expect(card.querySelector('[data-slot="card-content"]')).toHaveClass('px-3', 'py-2')
    // ④ 超宽屏第 6 列（globals.css 注册的 3xl 断点 + important 后缀：
    //     Tailwind v4 把 @theme 新增断点排到标准断点之前，不加 ! 会被 2xl 覆盖）
    expect(screen.getByTestId('agents-list')).toHaveClass('3xl:grid-cols-6!')
  })
})

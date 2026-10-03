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
})

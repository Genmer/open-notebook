import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentEditorDialog } from './AgentEditorDialog'
import { Agent } from '@/lib/types/agents'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const createAgent = vi.fn()
const updateAgent = vi.fn()

vi.mock('@/lib/hooks/use-agents', () => ({
  useCreateAgent: () => ({ mutate: createAgent, isPending: false }),
  useUpdateAgent: () => ({ mutate: updateAgent, isPending: false }),
}))

vi.mock('@/lib/api/agents', () => ({
  agentsApi: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

// ModelSelector pulls react-query data; stub both hooks to keep the dialog
// render hermetic.
vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({
    data: [
      { id: 'model:gpt', name: 'GPT Test', provider: 'openai', type: 'language' },
    ],
    isLoading: false,
  }),
  useModelDefaults: () => ({ data: null, isLoading: false }),
}))

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'agent:1',
  name: 'Researcher',
  system_prompt: 'Be rigorous.',
  description: 'persona',
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

describe('AgentEditorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks submit when name or prompt is empty', () => {
    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId={null} />)
    fireEvent.click(screen.getByTestId('agent-form-submit'))
    expect(screen.getByTestId('agent-form-error')).toHaveTextContent(
      'agents.validationRequired'
    )
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('submits a create payload with parsed sampling params', () => {
    const onOpenChange = vi.fn()
    render(<AgentEditorDialog open onOpenChange={onOpenChange} agentId={null} />)

    fireEvent.change(screen.getByTestId('agent-form-name'), {
      target: { value: ' Scholar ' },
    })
    fireEvent.change(screen.getByTestId('agent-form-prompt'), {
      target: { value: 'Think carefully.' },
    })
    fireEvent.change(screen.getByTestId('agent-form-temperature'), {
      target: { value: '0.5' },
    })
    fireEvent.change(screen.getByTestId('agent-form-max-tokens'), {
      target: { value: '2048' },
    })
    fireEvent.click(screen.getByTestId('agent-form-submit'))

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Scholar',
        system_prompt: 'Think carefully.',
        temperature: 0.5,
        max_tokens: 2048,
        model: null,
        enabled: true,
      }),
      expect.anything()
    )
  })

  it('rejects out-of-range temperature before hitting the API', () => {
    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId={null} />)
    fireEvent.change(screen.getByTestId('agent-form-name'), {
      target: { value: 'Scholar' },
    })
    fireEvent.change(screen.getByTestId('agent-form-prompt'), {
      target: { value: 'Think.' },
    })
    fireEvent.change(screen.getByTestId('agent-form-temperature'), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByTestId('agent-form-submit'))

    expect(screen.getByTestId('agent-form-error')).toHaveTextContent(
      'agents.validationTemperature'
    )
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('loads an existing agent and routes to update', async () => {
    const { agentsApi } = await import('@/lib/api/agents')
    ;(agentsApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAgent({ id: 'agent:9', name: 'Writer' })
    )

    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId="agent:9" />)

    await waitFor(() => {
      expect(screen.getByTestId('agent-form-name')).toHaveValue('Writer')
    })
    fireEvent.click(screen.getByTestId('agent-form-submit'))

    expect(updateAgent).toHaveBeenCalledWith(
      {
        id: 'agent:9',
        data: expect.objectContaining({
          name: 'Writer',
          system_prompt: 'Be rigorous.',
          temperature: 0.2,
          max_tokens: 1024,
        }),
      },
      expect.anything()
    )
  })
})

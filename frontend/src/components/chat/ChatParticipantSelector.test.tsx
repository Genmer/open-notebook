import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ChatParticipantSelector,
  decodeParticipant,
} from '@/components/chat/ChatParticipantSelector'
import { Agent } from '@/lib/types/agents'
import { Model } from '@/lib/types/models'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Radix Select won't open in jsdom (project precedent: mock it always-open
// and assert option behavior directly).
const selectState = vi.hoisted(
  () => ({}) as { onValueChange?: (value: string) => void }
)
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode
    value?: string
    onValueChange?: (value: string) => void
  }) => {
    selectState.onValueChange = onValueChange
    return (
      <div data-testid="select-root" data-value={value ?? ''}>
        {children}
      </div>
    )
  },
  SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectTrigger: ({ children, ...props }: Record<string, unknown> & { children: React.ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode
    value: string
  }) => (
    <div
      role="option"
      aria-selected="false"
      data-value={value}
      onClick={() => selectState.onValueChange?.(value)}
    >
      {children}
    </div>
  ),
}))

const modelsState = vi.hoisted(
  () => ({ current: { data: [] as Model[], isLoading: false } })
)
const defaultsState = vi.hoisted(
  () => ({ current: { data: {} as { default_chat_model?: string | null }, isLoading: false } })
)

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => modelsState.current,
  useModelDefaults: () => defaultsState.current,
}))

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'agent:1',
  name: 'Researcher',
  system_prompt: 'Be rigorous.',
  description: null,
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

const agentsHook = { current: { data: [] as Agent[], isLoading: false } }

vi.mock('@/lib/hooks/use-agents', () => ({
  useAgents: () => agentsHook.current,
}))

describe('decodeParticipant', () => {
  it('decodes default / agent / model encodings', () => {
    expect(decodeParticipant('default')).toEqual({
      agent: null,
      modelOverride: null,
    })
    expect(decodeParticipant('agent:agent:1')).toEqual({
      agent: 'agent:1',
      modelOverride: null,
    })
    expect(decodeParticipant('model:model:gpt')).toEqual({
      agent: null,
      modelOverride: 'model:gpt',
    })
  })
})

describe('ChatParticipantSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelsState.current = {
      data: [
        { id: 'model:gpt', name: 'GPT Test', provider: 'openai', type: 'language', created: '', updated: '' },
        { id: 'model:claude', name: 'Claude Test', provider: 'anthropic', type: 'language', created: '', updated: '' },
        { id: 'model:embed', name: 'Embedder', provider: 'openai', type: 'embedding', created: '', updated: '' },
      ],
      isLoading: false,
    }
    defaultsState.current = {
      data: { default_chat_model: 'model:gpt' },
      isLoading: false,
    }
    agentsHook.current = {
      data: [
        makeAgent({ id: 'agent:3', name: 'Analyzer', sort_order: -1 }),
        makeAgent(),
        makeAgent({ id: 'agent:2', name: 'Writer', enabled: false }),
      ],
      isLoading: false,
    }
  })

  it('shows the agent name when an agent is bound', () => {
    render(
      <ChatParticipantSelector
        value={{ agent: 'agent:1', modelOverride: null }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByTestId('chat-participant-trigger')).toHaveTextContent(
      'Researcher'
    )
  })

  it('shows the default chat model name when nothing is bound', () => {
    render(
      <ChatParticipantSelector
        value={{ agent: null, modelOverride: null }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByTestId('chat-participant-trigger')).toHaveTextContent(
      'common.default (GPT Test)'
    )
  })

  it('lists enabled agents and language models in groups, hides disabled agents', () => {
    render(
      <ChatParticipantSelector value={{ agent: null, modelOverride: null }} onChange={vi.fn()} />
    )
    expect(screen.getByRole('option', { name: /Researcher/ })).toBeInTheDocument()
    // embedding models are filtered out; disabled agents are hidden
    expect(screen.queryByRole('option', { name: /Writer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Embedder/ })).not.toBeInTheDocument()
  })

  it('emits mutually exclusive participant on select', () => {
    const onChange = vi.fn()
    render(
      <ChatParticipantSelector
        value={{ agent: null, modelOverride: null }}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('option', { name: /Researcher/ }))

    expect(onChange).toHaveBeenCalledWith({ agent: 'agent:1', modelOverride: null })
  })

  it('emits a model-only participant when a language model is selected', () => {
    const onChange = vi.fn()
    render(
      <ChatParticipantSelector
        value={{ agent: null, modelOverride: null }}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('option', { name: /^GPT Test/ }))

    expect(onChange).toHaveBeenCalledWith({ agent: null, modelOverride: 'model:gpt' })
  })

  it('shows the overridden model name when a model is bound', () => {
    render(
      <ChatParticipantSelector
        value={{ agent: null, modelOverride: 'model:gpt' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByTestId('chat-participant-trigger')).toHaveTextContent('GPT Test')
  })

  it('shows the plain default label when no default chat model is configured', () => {
    defaultsState.current = { data: {}, isLoading: false }
    render(
      <ChatParticipantSelector
        value={{ agent: null, modelOverride: null }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByTestId('chat-participant-trigger')).toHaveTextContent('common.default')
    expect(screen.getByTestId('chat-participant-trigger')).not.toHaveTextContent('(GPT Test)')
  })

  it('selecting the default option clears both bindings', () => {
    const onChange = vi.fn()
    render(
      <ChatParticipantSelector
        value={{ agent: 'agent:1', modelOverride: null }}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('option', { name: /common.default/ }))

    expect(onChange).toHaveBeenCalledWith({ agent: null, modelOverride: null })
  })

  it('flags a dangling agent binding', () => {
    render(
      <ChatParticipantSelector
        value={{ agent: 'agent:gone', modelOverride: null }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByTestId('chat-participant-trigger')).toHaveTextContent(
      'chat.agentMissing'
    )
  })
})

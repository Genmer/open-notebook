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

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({
    data: [
      {
        id: 'model:gpt',
        name: 'GPT Test',
        provider: 'openai',
        type: 'language',
      },
      {
        id: 'model:embed',
        name: 'Embedder',
        provider: 'openai',
        type: 'embedding',
      },
    ] as Model[],
    isLoading: false,
  }),
  useModelDefaults: () => ({
    data: { default_chat_model: 'model:gpt' },
    isLoading: false,
  }),
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
    agentsHook.current = {
      data: [
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
    // open the dialog (Radix Dialog gates the mocked always-open Select)
    fireEvent.click(screen.getByTestId('chat-participant-trigger'))
    expect(screen.getByRole('option', { name: /Researcher/ })).toBeInTheDocument()
    // embedding models are filtered out; disabled agents are hidden
    expect(screen.queryByRole('option', { name: /Writer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Embedder/ })).not.toBeInTheDocument()
  })

  it('emits mutually exclusive participant on save', () => {
    const onChange = vi.fn()
    render(
      <ChatParticipantSelector
        value={{ agent: null, modelOverride: null }}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByTestId('chat-participant-trigger'))
    fireEvent.click(screen.getByRole('option', { name: /Researcher/ }))
    fireEvent.click(screen.getByRole('button', { name: 'common.saveChanges' }))

    expect(onChange).toHaveBeenCalledWith({ agent: 'agent:1', modelOverride: null })
  })

  it('reset clears both bindings', async () => {
    const onChange = vi.fn()
    render(
      <ChatParticipantSelector
        value={{ agent: 'agent:1', modelOverride: null }}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByTestId('chat-participant-trigger'))
    fireEvent.click(screen.getByRole('button', { name: 'common.resetToDefault' }))

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

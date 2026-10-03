import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentEditorDialog } from './AgentEditorDialog'
import { Agent } from '@/lib/types/agents'
import {
  AGENT_TEMPLATES,
  pickTemplateText,
} from '@/lib/agent-templates'

// useTranslation is mocked globally in setup.ts (t returns the key string,
// language is 'en-US' — so pickTemplateText resolves to the English variant)

const createAgent = vi.fn()
const updateAgent = vi.fn()
const toastMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-agents', () => ({
  useCreateAgent: () => ({ mutate: createAgent, isPending: false }),
  useUpdateAgent: () => ({ mutate: updateAgent, isPending: false }),
}))

vi.mock('@/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock('@/lib/api/agents', () => ({
  agentsApi: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    polishPrompt: vi.fn(),
  },
}))

// Radix Select won't open in jsdom (project precedent: mock it always-open
// and assert option behavior directly). Two Selects render inside this
// dialog (template picker + ModelSelector), so onValueChange is routed via
// a context instead of a shared capture object.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
  }>({})
  return {
    Select: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode
      value?: string
      onValueChange?: (value: string) => void
    }) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div data-testid="select-root" data-value={value ?? ''}>
          {children}
        </div>
      </SelectContext.Provider>
    ),
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => null,
    SelectTrigger: ({
      children,
      ...props
    }: Record<string, unknown> & { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      children,
      value,
    }: {
      children: React.ReactNode
      value: string
    }) => {
      const { onValueChange } = React.useContext(SelectContext)
      return (
        <div
          role="option"
          aria-selected="false"
          data-value={value}
          onClick={() => onValueChange?.(value)}
        >
          {children}
        </div>
      )
    },
  }
})

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

describe('AgentEditorDialog template picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the picker in create mode with blank option and every template grouped by category', () => {
    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId={null} />)

    expect(screen.getByTestId('agent-form-template')).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'agents.templateBlank' })
    ).toBeInTheDocument()
    for (const tpl of AGENT_TEMPLATES) {
      expect(
        screen.getByRole('option', { name: pickTemplateText(tpl.name, 'en-US') })
      ).toBeInTheDocument()
    }
    // category group labels come from i18n (t returns the key)
    expect(screen.getByText('agents.templateCat.software')).toBeInTheDocument()
    expect(screen.getByText('agents.templateCat.general')).toBeInTheDocument()
  })

  it('fills the form from the selected template and keeps values when switching back to blank', () => {
    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId={null} />)

    const tpl = AGENT_TEMPLATES.find((t) => t.key === 'senior-software-engineer')!
    fireEvent.click(
      screen.getByRole('option', { name: pickTemplateText(tpl.name, 'en-US') })
    )

    expect(screen.getByTestId('agent-form-name')).toHaveValue(
      pickTemplateText(tpl.name, 'en-US')
    )
    expect(screen.getByTestId('agent-form-description')).toHaveValue(
      pickTemplateText(tpl.description, 'en-US')
    )
    expect(screen.getByTestId('agent-form-prompt')).toHaveValue(
      pickTemplateText(tpl.systemPrompt, 'en-US')
    )
    // number inputs: jest-dom compares numeric values
    expect(screen.getByTestId('agent-form-temperature')).toHaveValue(
      tpl.temperature
    )
    expect(screen.getByTestId('agent-form-max-tokens')).toHaveValue(tpl.maxTokens)

    // blank is non-destructive: the filled form stays as-is
    fireEvent.click(screen.getByRole('option', { name: 'agents.templateBlank' }))
    expect(screen.getByTestId('agent-form-name')).toHaveValue(
      pickTemplateText(tpl.name, 'en-US')
    )
    expect(screen.getByTestId('agent-form-prompt')).toHaveValue(
      pickTemplateText(tpl.systemPrompt, 'en-US')
    )
  })

  it('hides the picker in edit mode', async () => {
    const { agentsApi } = await import('@/lib/api/agents')
    ;(agentsApi.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeAgent())

    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId="agent:1" />)

    await waitFor(() => {
      expect(screen.getByTestId('agent-form-name')).toHaveValue('Researcher')
    })
    expect(screen.queryByTestId('agent-form-template')).not.toBeInTheDocument()
    for (const tpl of AGENT_TEMPLATES) {
      expect(
        screen.queryByRole('option', { name: pickTemplateText(tpl.name, 'en-US') })
      ).not.toBeInTheDocument()
    }
  })
})

describe('AgentEditorDialog prompt polish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables the polish button while the draft is empty', () => {
    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId={null} />)
    expect(screen.getByTestId('agent-form-polish')).toBeDisabled()

    fireEvent.change(screen.getByTestId('agent-form-prompt'), {
      target: { value: 'raw idea' },
    })
    expect(screen.getByTestId('agent-form-polish')).toBeEnabled()
  })

  it('polishes the draft with name/description context and writes the result back', async () => {
    const { agentsApi } = await import('@/lib/api/agents')
    ;(agentsApi.polishPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
      polished: 'Polished prompt.',
    })

    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId={null} />)
    fireEvent.change(screen.getByTestId('agent-form-name'), {
      target: { value: 'Scholar' },
    })
    fireEvent.change(screen.getByTestId('agent-form-prompt'), {
      target: { value: '  raw idea  ' },
    })
    fireEvent.click(screen.getByTestId('agent-form-polish'))

    await waitFor(() => {
      expect(screen.getByTestId('agent-form-prompt')).toHaveValue('Polished prompt.')
    })
    expect(agentsApi.polishPrompt).toHaveBeenCalledWith({
      draft: 'raw idea',
      name: 'Scholar',
      description: null,
    })
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('shows a destructive toast on polish failure and keeps the draft', async () => {
    const { agentsApi } = await import('@/lib/api/agents')
    ;(agentsApi.polishPrompt as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom')
    )

    render(<AgentEditorDialog open onOpenChange={vi.fn()} agentId={null} />)
    fireEvent.change(screen.getByTestId('agent-form-prompt'), {
      target: { value: 'raw idea' },
    })
    fireEvent.click(screen.getByTestId('agent-form-polish'))

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'agents.polishFailed',
          description: 'boom',
          variant: 'destructive',
        })
      )
    })
    expect(screen.getByTestId('agent-form-prompt')).toHaveValue('raw idea')
  })
})

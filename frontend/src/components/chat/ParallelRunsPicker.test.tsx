import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ParallelRunsPicker } from './ParallelRunsPicker'
import { Agent } from '@/lib/types/agents'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Radix Popover won't open in jsdom (project precedent: mock always-open).
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="parallel-runs-popover">{children}</div>
  ),
}))

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({
    data: [
      { id: 'model:gpt', name: 'GPT Test', provider: 'openai', type: 'language' },
      { id: 'model:embed', name: 'Embedder', provider: 'openai', type: 'embedding' },
    ],
    isLoading: false,
  }),
}))

vi.mock('@/lib/hooks/use-agents', () => ({
  useAgents: () => ({
    data: [
      {
        id: 'agent:1',
        name: 'Researcher',
        enabled: true,
        model_id: 'model:gpt',
        sort_order: 0,
      } as Agent,
    ],
    isLoading: false,
  }),
}))

describe('ParallelRunsPicker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists default, enabled agents and language models only', () => {
    render(<ParallelRunsPicker onSend={vi.fn()} />)
    fireEvent.click(screen.getByTestId('parallel-runs-trigger'))
    expect(screen.getByTestId('parallel-option-default')).toBeInTheDocument()
    expect(screen.getByTestId('parallel-option-agent:agent:1')).toHaveTextContent('Researcher')
    expect(screen.getByTestId('parallel-option-model:model:gpt')).toBeInTheDocument()
    expect(screen.queryByTestId('parallel-option-model:model:embed')).not.toBeInTheDocument()
  })

  it('sends the encoded keys of the checked participants', () => {
    const onSend = vi.fn()
    render(<ParallelRunsPicker onSend={onSend} />)
    fireEvent.click(screen.getByTestId('parallel-runs-trigger'))
    fireEvent.click(screen.getByTestId('parallel-option-agent:agent:1'))
    fireEvent.click(screen.getByTestId('parallel-option-model:model:gpt'))
    fireEvent.click(screen.getByTestId('parallel-runs-confirm'))

    expect(onSend).toHaveBeenCalledWith(['agent:agent:1', 'model:model:gpt'])
  })

  it('blocks the confirm button until something is picked', () => {
    render(<ParallelRunsPicker onSend={vi.fn()} />)
    fireEvent.click(screen.getByTestId('parallel-runs-trigger'))
    expect(screen.getByTestId('parallel-runs-confirm')).toBeDisabled()
  })

  it('unchecking removes a participant from the send payload', () => {
    const onSend = vi.fn()
    render(<ParallelRunsPicker onSend={onSend} />)
    fireEvent.click(screen.getByTestId('parallel-runs-trigger'))
    fireEvent.click(screen.getByTestId('parallel-option-agent:agent:1'))
    fireEvent.click(screen.getByTestId('parallel-option-model:model:gpt'))
    // uncheck the model again
    fireEvent.click(screen.getByTestId('parallel-option-model:model:gpt'))
    fireEvent.click(screen.getByTestId('parallel-runs-confirm'))

    expect(onSend).toHaveBeenCalledWith(['agent:agent:1'])
  })
})

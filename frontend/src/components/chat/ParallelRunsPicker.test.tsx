import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { ParallelRunsPicker } from './ParallelRunsPicker'
import { Agent } from '@/lib/types/agents'

// Radix Popover won't open in jsdom (project precedent: mock it). This mock
// keeps the real contract — `open` gates PopoverContent and clicking the
// trigger calls onOpenChange — so tests can close and reopen the picker.
vi.mock('@/components/ui/popover', async () => {
  const { createContext, useContext } = await import('react')
  type PopoverCtx = { open: boolean; setOpen: (open: boolean) => void }
  const PopoverContext = createContext<PopoverCtx | null>(null)
  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode
      open: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <PopoverContext.Provider value={{ open, setOpen: v => onOpenChange?.(v) }}>
        {children}
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const ctx = useContext(PopoverContext)
      return <div onClick={() => ctx?.setOpen(!ctx.open)}>{children}</div>
    },
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const ctx = useContext(PopoverContext)
      if (!ctx?.open) return null
      return <div data-testid="parallel-runs-popover">{children}</div>
    },
  }
})

// setup.ts mocks t() as identity (returns the key). The trigger-count test
// asserts the interpolated number, so this file replaces it with a mock that
// appends "name:value" pairs: t('chat.x', { count: 1 }) → "chat.x count:1".
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key
      const interpolations = Object.entries(params)
        .map(([name, value]) => `${name}:${String(value)}`)
        .join(' ')
      return `${key} ${interpolations}`
    },
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
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

  it('keeps the selection across close/reopen and shows the count on the trigger', () => {
    render(<ParallelRunsPicker onSend={vi.fn()} />)
    const trigger = screen.getByTestId('parallel-runs-trigger')

    // nothing picked yet: outline variant, base label
    expect(trigger.className).toContain('bg-transparent')
    expect(trigger.className).not.toContain('bg-primary')
    expect(trigger).toHaveTextContent('chat.parallelSend')

    // open and pick exactly one participant
    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('parallel-option-agent:agent:1'))

    // trigger switches to the filled variant and shows the count
    expect(trigger.className).toContain('bg-primary')
    expect(trigger).toHaveTextContent('1')
    expect(trigger).toHaveAttribute('aria-label', 'chat.parallelSend')

    // close the popover (click outside/ESC equivalent) — content unmounts
    fireEvent.click(trigger)
    expect(screen.queryByTestId('parallel-runs-popover')).not.toBeInTheDocument()

    // the pick survives the close: the trigger still shows the count
    expect(trigger).toHaveTextContent('1')

    // reopen: the checkbox is still checked and the count still shows
    fireEvent.click(trigger)
    const row = screen.getByTestId('parallel-option-agent:agent:1')
    expect(row.querySelector('[role="checkbox"]')).toHaveAttribute('data-state', 'checked')
    expect(trigger).toHaveTextContent('1')
  })

  it('clears the selection and the trigger state after a successful send', () => {
    const onSend = vi.fn()
    render(<ParallelRunsPicker onSend={onSend} />)
    const trigger = screen.getByTestId('parallel-runs-trigger')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('parallel-option-agent:agent:1'))
    expect(trigger).toHaveTextContent('1')

    fireEvent.click(screen.getByTestId('parallel-runs-confirm'))

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveTextContent('chat.parallelSend')
    expect(trigger.className).toContain('bg-transparent')
    expect(trigger.className).not.toContain('bg-primary')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatColumn } from './ChatColumn'
import { useNotes } from '@/lib/hooks/use-notes'
import { useNotebookChat } from '@/lib/hooks/use-notebook-chat'

// Mock the hooks
vi.mock('@/lib/hooks/use-notes')
vi.mock('@/lib/hooks/use-notebook-chat')
vi.mock('@/components/sources/ChatPanel', () => ({
  ChatPanel: ({
    sourceGrouping,
  }: {
    sourceGrouping?: { viewId?: string; group?: string }
  }) => (
    <div
      data-testid="chat-panel"
      data-source-grouping={sourceGrouping ? JSON.stringify(sourceGrouping) : ''}
    />
  )
}))

// Type-safe mock factory for useNotes hook
function createNotesMock(overrides: { isLoading?: boolean } = {}) {
  return {
    data: [],
    isLoading: overrides.isLoading ?? false,
  } as unknown as ReturnType<typeof useNotes>
}

// Type-safe mock factory for useNotebookChat hook
function createChatMock() {
  return {
    messages: [],
    isSending: false,
    tokenCount: 0,
    charCount: 0,
    sessions: [],
    currentSessionId: null,
    setAgentOverride: vi.fn(),
    parallel: {
      phase: 'idle' as const,
      runs: [],
      groupId: null,
      synthesis: null,
      isSynthesizing: false,
      start: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
      synthesize: vi.fn(),
    },
    sendParallelMessage: vi.fn(),
    synthesizeParallel: vi.fn(),
  } as unknown as ReturnType<typeof useNotebookChat>
}

describe('ChatColumn', () => {
  const baseProps = {
    notebookId: 'test-notebook',
    contextSelections: {
      sources: {},
      notes: {}
    },
    onOpenContextPicker: vi.fn(),
    sources: [],
  }

  it('shows loading spinner when fetching data', () => {
    vi.mocked(useNotes).mockReturnValue(createNotesMock({ isLoading: true }))
    vi.mocked(useNotebookChat).mockReturnValue(createChatMock())

    render(<ChatColumn {...baseProps} sourcesLoading={true} />)

    // Should show loading spinner
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('renders chat panel when data is loaded', () => {
    vi.mocked(useNotes).mockReturnValue(createNotesMock({ isLoading: false }))
    vi.mocked(useNotebookChat).mockReturnValue(createChatMock())

    render(<ChatColumn {...baseProps} sourcesLoading={false} />)

    // Should show chat panel
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
  })

  it('forwards sourceGrouping to the chat panel unchanged', () => {
    vi.mocked(useNotes).mockReturnValue(createNotesMock({ isLoading: false }))
    vi.mocked(useNotebookChat).mockReturnValue(createChatMock())

    const sourceGrouping = { viewId: 'view:1', group: 'group:9' }
    render(<ChatColumn {...baseProps} sourcesLoading={false} sourceGrouping={sourceGrouping} />)

    expect(screen.getByTestId('chat-panel')).toHaveAttribute(
      'data-source-grouping',
      JSON.stringify(sourceGrouping)
    )
  })

  it('renders without sourceGrouping (no grouping scope)', () => {
    vi.mocked(useNotes).mockReturnValue(createNotesMock({ isLoading: false }))
    vi.mocked(useNotebookChat).mockReturnValue(createChatMock())

    render(<ChatColumn {...baseProps} sourcesLoading={false} />)

    expect(screen.getByTestId('chat-panel')).toHaveAttribute('data-source-grouping', '')
  })
})

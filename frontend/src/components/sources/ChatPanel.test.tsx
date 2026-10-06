import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatPanel } from './ChatPanel'
import { useChatPreferencesStore } from '@/lib/stores/chat-preferences-store'
import { useSourceTitles } from '@/lib/hooks/use-sources'
import { toast } from 'sonner'
import type { SourceTitleResponse } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: () => ({ openModal: vi.fn() }),
}))

// Stubbed so the empty-input parallel hint can be asserted without a Toaster.
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

// The real picker mounts react-query hooks (use-models/use-agents) and a Radix
// Popover that never opens in jsdom. This probe stands in and surfaces the
// exact `disabled` prop ChatComposer computes, clicking through to onSend.
vi.mock('@/components/chat/ParallelRunsPicker', () => ({
  ParallelRunsPicker: ({
    disabled,
    onSend,
  }: {
    disabled?: boolean
    onSend: (runs: string[]) => void
  }) => (
    <button
      type="button"
      data-testid="parallel-runs-trigger"
      disabled={disabled}
      onClick={() => onSend(['default'])}
    />
  ),
}))

const mockToastError = vi.mocked(toast.error)

vi.mock('@/lib/hooks/use-sources', () => ({
  hasActiveInsightJobs: () => false,
  useSourceTitles: vi.fn(),
}))

// Keep the message-content deps light for this composer-focused test.
// Probe: expose the received sourceGrouping so the ChatPanel → memo ChatMessage
// → MessageActions hand-off is asserted with a same-value check.
vi.mock('@/components/sources/MessageActions', () => ({
  MessageActions: ({
    sourceGrouping,
  }: {
    sourceGrouping?: { viewId?: string; group?: string }
  }) => (
    <div
      data-testid="message-actions-probe"
      data-source-grouping={sourceGrouping ? JSON.stringify(sourceGrouping) : ''}
    />
  ),
}))

const mockUseSourceTitles = vi.mocked(useSourceTitles)

function mockTitles(titles: SourceTitleResponse[]) {
  mockUseSourceTitles.mockReturnValue({ data: titles } as ReturnType<typeof useSourceTitles>)
}

describe('ChatPanel composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom does not implement scrollIntoView (used by the auto-scroll effect).
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  const getTextarea = () => screen.getByRole('textbox') as HTMLTextAreaElement

  it('sends the typed message and clears the input on send-button click', () => {
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: '  hello world  ' } })

    // The header fullscreen toggle also renders as a button; the send button
    // is the icon-only one without an accessible name.
    const sendButton = screen.getByRole('button', { name: '' })
    fireEvent.click(sendButton)

    expect(onSendMessage).toHaveBeenCalledTimes(1)
    expect(onSendMessage).toHaveBeenCalledWith('hello world', undefined)
    expect(textarea.value).toBe('')
  })

  it('sends on Cmd+Enter on macOS', () => {
    const uaSpy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    )
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'via cmd' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true, ctrlKey: false })

    expect(onSendMessage).toHaveBeenCalledWith('via cmd', undefined)
    expect(textarea.value).toBe('')
    uaSpy.mockRestore()
  })

  it('sends on Ctrl+Enter on non-macOS', () => {
    const uaSpy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    )
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'via ctrl' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true, metaKey: false })

    expect(onSendMessage).toHaveBeenCalledWith('via ctrl', undefined)
    expect(textarea.value).toBe('')
    uaSpy.mockRestore()
  })

  it('does not send while streaming', () => {
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    // Textarea is disabled while streaming, but the guard must also hold.
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(onSendMessage).not.toHaveBeenCalled()
  })
})

describe('ChatPanel parallel composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom does not implement scrollIntoView (used by the auto-scroll effect).
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  const renderWithParallel = () => {
    const parallelChat = {
      phase: 'idle' as const,
      runs: [],
      synthesis: null,
      isSynthesizing: false,
      send: vi.fn(),
      synthesize: vi.fn(),
    }
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={vi.fn()}
        parallelChat={parallelChat}
      />
    )
    return {
      parallelChat,
      textarea: screen.getByRole('textbox') as HTMLTextAreaElement,
    }
  }

  it('keeps the parallel trigger clickable while the input is empty', () => {
    const { textarea } = renderWithParallel()
    expect(textarea.value).toBe('')

    expect(screen.getByTestId('parallel-runs-trigger')).not.toBeDisabled()
  })

  it('hints and refocuses the composer instead of sending on an empty-input confirm', () => {
    const { parallelChat, textarea } = renderWithParallel()

    fireEvent.click(screen.getByTestId('parallel-runs-trigger'))

    expect(parallelChat.send).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('chat.parallelEmptyHint')
    expect(textarea).toHaveFocus()
  })

  it('sends the trimmed input through the parallel channel and clears it', () => {
    const { parallelChat, textarea } = renderWithParallel()
    fireEvent.change(textarea, { target: { value: '  fan out  ' } })

    fireEvent.click(screen.getByTestId('parallel-runs-trigger'))

    expect(parallelChat.send).toHaveBeenCalledWith('fan out', ['default'])
    expect(textarea.value).toBe('')
  })
})

describe('ChatPanel composer enter-to-send preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom does not implement scrollIntoView (used by the auto-scroll effect).
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    useChatPreferencesStore.setState({ enterToSend: false })
    localStorage.removeItem('chat-preferences-storage')
  })

  const renderPanel = (onSendMessage = vi.fn()) => {
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )
    return {
      onSendMessage,
      textarea: screen.getByRole('textbox') as HTMLTextAreaElement,
    }
  }

  it('does not send on plain Enter when the preference is off', () => {
    const { onSendMessage, textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'plain' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it('still sends on modifier+Enter when the preference is off', () => {
    const { onSendMessage, textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'via modifier' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true, ctrlKey: true })

    expect(onSendMessage).toHaveBeenCalledWith('via modifier', undefined)
  })

  it('sends on plain Enter once the toggle is switched on', () => {
    const { onSendMessage, textarea } = renderPanel()

    fireEvent.click(screen.getByLabelText('chat.enterToSend'))
    fireEvent.change(textarea, { target: { value: 'direct' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSendMessage).toHaveBeenCalledWith('direct', undefined)
  })

  it('updates the placeholder hint when the toggle is on', () => {
    renderPanel()
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toContain('chat.pressToSend')

    fireEvent.click(screen.getByLabelText('chat.enterToSend'))

    expect(screen.getByRole('textbox').getAttribute('placeholder')).toContain('chat.enterToSendHint')
    expect(screen.getByRole('textbox').getAttribute('placeholder')).not.toContain('chat.pressToSend')
  })

  it('keeps Shift+Enter for a newline while enter-to-send is on', () => {
    useChatPreferencesStore.setState({ enterToSend: true })
    const { onSendMessage, textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'newline' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSendMessage).not.toHaveBeenCalled()
  })

  // fireEvent returns false iff the cancelable event was default-prevented.
  it('does not preventDefault on Shift+Enter so the browser inserts the newline', () => {
    useChatPreferencesStore.setState({ enterToSend: true })
    const { textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'line' } })

    const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(notPrevented).toBe(true)
    expect(textarea.value).toBe('line')
  })

  it('prevents the default newline when Enter sends while enter-to-send is on', () => {
    useChatPreferencesStore.setState({ enterToSend: true })
    const { onSendMessage, textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'send me' } })

    const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(notPrevented).toBe(false)
    expect(onSendMessage).toHaveBeenCalledTimes(1)
  })

  it('never sends while the IME is composing', () => {
    useChatPreferencesStore.setState({ enterToSend: true })
    const { onSendMessage, textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'composing' } })

    // jsdom supports isComposing in KeyboardEventInit.
    const composingEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    })
    const notPrevented = fireEvent(textarea, composingEnter)

    expect(onSendMessage).not.toHaveBeenCalled()
    // Composition Enter must reach the IME, not be swallowed by the composer.
    expect(notPrevented).toBe(true)
  })

  it('does not send Ctrl+Enter while the IME is composing when the preference is off', () => {
    const { onSendMessage, textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'composing ctrl' } })

    const composingCtrlEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      isComposing: true,
    })
    const notPrevented = fireEvent(textarea, composingCtrlEnter)

    expect(onSendMessage).not.toHaveBeenCalled()
    expect(notPrevented).toBe(true)
  })

  // Safari fires compositionend BEFORE the confirming keydown, so isComposing is
  // already false by then; the composingRef delay must swallow that Enter.
  it('does not send the Safari composition-confirm Enter (compositionend precedes keydown)', () => {
    useChatPreferencesStore.setState({ enterToSend: true })
    const { onSendMessage, textarea } = renderPanel()
    fireEvent.change(textarea, { target: { value: 'safari ime' } })

    fireEvent.compositionStart(textarea)
    fireEvent.compositionEnd(textarea)
    const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSendMessage).not.toHaveBeenCalled()
    expect(notPrevented).toBe(true)
  })

  it('keeps enter-to-send after a simulated reload via the persisted preference', async () => {
    localStorage.setItem(
      'chat-preferences-storage',
      JSON.stringify({ state: { enterToSend: true }, version: 0 })
    )
    // Fresh module graph = fresh store, as on a page reload.
    vi.resetModules()
    const { ChatPanel: FreshChatPanel } = await import('./ChatPanel')
    const onSendMessage = vi.fn()
    render(
      <FreshChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.placeholder).toContain('chat.enterToSendHint')

    fireEvent.change(textarea, { target: { value: 'after reload' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSendMessage).toHaveBeenCalledTimes(1)
    expect(onSendMessage).toHaveBeenCalledWith('after reload', undefined)
  })
})

describe('ChatPanel AI message reference titles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  const aiMessage = { id: 'm1', type: 'ai' as const, content: 'See [source:abc] for details.' }

  const renderWithMessage = (content: string) => {
    render(
      <ChatPanel
        messages={[{ ...aiMessage, content }]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )
  }

  it('renders resolved source titles in the reference list', () => {
    mockTitles([{ id: 'source:abc', title: 'Quarterly Report' }])
    renderWithMessage(aiMessage.content)

    expect(mockUseSourceTitles).toHaveBeenCalledWith(['abc'])
    expect(screen.getByText('Quarterly Report')).toBeInTheDocument()
  })

  it('falls back to source:id when no titles resolve', () => {
    mockTitles([])
    renderWithMessage(aiMessage.content)

    expect(screen.getByText('source:abc')).toBeInTheDocument()
  })

  it('does not look up titles for messages without source references', () => {
    mockTitles([])
    renderWithMessage('Plain answer with no references.')

    expect(mockUseSourceTitles).toHaveBeenCalledWith([])
    expect(screen.queryByText('References:')).not.toBeInTheDocument()
  })
})

describe('ChatPanel fullscreen toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  const renderForFullscreen = () =>
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

  const getCard = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-slot="card"]')!

  it('enters fullscreen on toggle and exits on Escape', () => {
    const { container } = renderForFullscreen()
    const card = getCard(container)

    // Normal mode is anchored by the flex parent (h-full flex-1).
    expect(card.className).toContain('h-full flex-1')
    expect(card.className).not.toContain('fixed')

    fireEvent.click(screen.getByRole('button', { name: 'chat.enterFullscreen' }))

    expect(card.className).toContain('fixed inset-0 z-50 h-screen w-screen rounded-none')
    expect(card.className).not.toContain('h-full flex-1')
    expect(screen.getByRole('button', { name: 'chat.exitFullscreen' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(card.className).toContain('h-full flex-1')
    expect(card.className).not.toContain('fixed inset-0')
    expect(screen.getByRole('button', { name: 'chat.enterFullscreen' })).toBeInTheDocument()
  })

  it('returns to the flex-anchored width when the toggle is clicked again', () => {
    const { container } = renderForFullscreen()
    const card = getCard(container)

    fireEvent.click(screen.getByRole('button', { name: 'chat.enterFullscreen' }))
    fireEvent.click(screen.getByRole('button', { name: 'chat.exitFullscreen' }))

    expect(card.className).toContain('h-full flex-1')
    expect(card.className).not.toContain('w-screen')
  })

  it('ignores Escape while not fullscreen', () => {
    const { container } = renderForFullscreen()
    const card = getCard(container)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(card.className).toContain('h-full flex-1')
    expect(card.className).not.toContain('fixed')
  })
})

describe('ChatPanel streaming bubble', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    mockTitles([])
  })

  // The waiting/streaming bubble is the only element carrying max-w-[80%];
  // the composer's send button also spins an animate-spin Loader2 while
  // isStreaming, so spinner assertions must scope inside the bubble.
  const getBubble = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('.max-w-\\[80\\%\\]')

  it('renders streaming text as plain text with a cursor, not markdown', () => {
    const { container } = render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        streamingMessage={{ content: '# Partial answer' }}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

    // Raw text stays literal — MarkdownRenderer would turn it into an h1
    expect(screen.getByText('# Partial answer')).toBeInTheDocument()
    expect(container.querySelector('h1')).toBeNull()
    const bubble = getBubble(container)
    // blinking cursor marks the live stream
    expect(bubble?.querySelector('.animate-pulse')).not.toBeNull()
    // no markdown container class inside the streaming bubble
    expect(bubble?.textContent).toContain('# Partial answer')
  })

  it('filters think segments from the streaming text', () => {
    render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        streamingMessage={{ content: '<think>hidden</think>visible part' }}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

    expect(screen.getByText('visible part')).toBeInTheDocument()
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
  })

  it('shows the waiting stream window while no delta has arrived yet', () => {
    const { container } = render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        streamingMessage={{ content: '' }}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

    const bubble = getBubble(container)
    // header spinner + blinking waiting cursor, but no stream text yet
    expect(bubble?.querySelector('.animate-spin')).not.toBeNull()
    expect(bubble?.querySelector('.animate-pulse')).not.toBeNull()
    expect(bubble).toHaveTextContent('chat.streamBuilding')
  })

  it('renders the generic waiting line when streamingMessage is not provided (source chat)', () => {
    const { container } = render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

    const bubble = getBubble(container)
    expect(bubble?.querySelector('.animate-spin')).not.toBeNull()
    expect(bubble).toHaveTextContent('chat.streamWaitingGeneric')
  })
})

describe('ChatPanel message actions grouping hand-off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    mockTitles([])
  })

  const aiMessage = { id: 'm1', type: 'ai' as const, content: 'Answer body' }

  it('hands sourceGrouping to MessageActions of an AI message unchanged', () => {
    const sourceGrouping = { viewId: 'view:1', group: 'group:9' }
    render(
      <ChatPanel
        messages={[aiMessage]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={vi.fn()}
        notebookId="nb:1"
        sourceGrouping={sourceGrouping}
      />
    )

    expect(screen.getByTestId('message-actions-probe')).toHaveAttribute(
      'data-source-grouping',
      JSON.stringify(sourceGrouping)
    )
  })

  it('leaves MessageActions without grouping when none is given', () => {
    render(
      <ChatPanel
        messages={[aiMessage]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={vi.fn()}
        notebookId="nb:1"
      />
    )

    expect(screen.getByTestId('message-actions-probe')).toHaveAttribute('data-source-grouping', '')
  })
})

describe('ChatPanel live stream window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    mockTitles([])
  })

  it('shows the fixed-height terminal window with the waiting hint while no tokens arrived', () => {
    render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        streamingMessage={{ content: '' }}
        contextIndicators={{ sources: [{ id: 's1' }], insights: [], notes: [{ id: 'n1' }] }}
        onSendMessage={vi.fn()}
      />
    )

    const win = screen.getByTestId('chat-stream-window')
    // Fixed height + inner scrolling: the stream body never grows the bubble.
    const body = win.querySelector('.h-40.overflow-y-auto')
    expect(body).not.toBeNull()
    expect(body).toHaveClass('font-mono')
    // t is key-mocked: the localized waiting hint resolves to its key.
    expect(screen.getByText(/chat\.streamWaitingHint/)).toBeInTheDocument()
  })

  it('falls back to the generic waiting line without context indicators', () => {
    render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        streamingMessage={null}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

    expect(screen.getByTestId('chat-stream-window')).toBeInTheDocument()
    expect(screen.getByText(/chat\.streamWaitingGeneric/)).toBeInTheDocument()
  })

  it('streams model text inside the monospace window with a char counter', () => {
    render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        streamingMessage={{ content: 'SurrealDB 多模型架构：结合文档与图关系…' }}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

    const win = screen.getByTestId('chat-stream-window')
    expect(win).toHaveTextContent('SurrealDB 多模型架构')
    expect(win).toHaveTextContent('chat.streamGenerating')
    expect(win).toHaveTextContent('chat.streamChars')
  })

  it('removes the stream window once streaming ends', () => {
    const { rerender } = render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        streamingMessage={{ content: 'partial' }}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )
    expect(screen.getByTestId('chat-stream-window')).toBeInTheDocument()

    rerender(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        streamingMessage={null}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )
    expect(screen.queryByTestId('chat-stream-window')).not.toBeInTheDocument()
  })
})

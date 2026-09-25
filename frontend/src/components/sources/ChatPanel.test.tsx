import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatPanel } from './ChatPanel'
import { useChatPreferencesStore } from '@/lib/stores/chat-preferences-store'
import { useSourceTitles } from '@/lib/hooks/use-sources'
import type { SourceTitleResponse } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: () => ({ openModal: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useSourceTitles: vi.fn(),
}))

// Keep the message-content deps light for this composer-focused test.
vi.mock('@/components/sources/MessageActions', () => ({
  MessageActions: () => null,
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

    const sendButton = screen.getByRole('button')
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

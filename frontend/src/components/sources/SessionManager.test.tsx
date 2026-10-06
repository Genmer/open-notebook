import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionManager } from './SessionManager'
import type { BaseChatSession } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string).
// The model badge lookup is the only react-query dependency — stubbed so the
// component renders without a QueryClientProvider.
vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({ data: [{ id: 'model:a', name: 'GPT-4o' }] }),
}))

function mkSession(
  id: string,
  title: string,
  extra: Partial<BaseChatSession> = {},
): BaseChatSession {
  return {
    id,
    title,
    created: '2026-01-01T10:00:00Z',
    updated: '2026-01-01T10:00:00Z',
    message_count: 3,
    ...extra,
  }
}

const baseSessions: BaseChatSession[] = [
  mkSession('s1', 'Alpha Session'),
  mkSession('s2', 'Beta Session', { message_count: 5 }),
]

type SetupOptions = {
  sessions?: BaseChatSession[]
  currentSessionId?: string | null
  isDeletingSession?: boolean
  deleteDisabled?: boolean
}

function setup({
  sessions = baseSessions,
  currentSessionId = 's1',
  isDeletingSession = false,
  deleteDisabled = false,
}: SetupOptions = {}) {
  const handlers = {
    onCreateSession: vi.fn(),
    onSelectSession: vi.fn(),
    onUpdateSession: vi.fn(),
    onDeleteSession: vi.fn(),
  }
  render(
    <SessionManager
      sessions={sessions}
      currentSessionId={currentSessionId}
      onCreateSession={handlers.onCreateSession}
      onSelectSession={handlers.onSelectSession}
      onUpdateSession={handlers.onUpdateSession}
      onDeleteSession={handlers.onDeleteSession}
      loadingSessions={false}
      isDeletingSession={isDeletingSession}
      deleteDisabled={deleteDisabled}
    />
  )
  return handlers
}

const getCard = (title: string) =>
  screen.getByText(title).closest('div.cursor-pointer') as HTMLElement

describe('SessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders every session with its title and message count', () => {
    setup()

    expect(screen.getByText('sessions.managerTitle')).toBeInTheDocument()
    expect(screen.getByText('Alpha Session')).toBeInTheDocument()
    expect(screen.getByText('Beta Session')).toBeInTheDocument()
    // Both fixtures carry message_count > 0, so both render the count badge.
    expect(screen.getAllByText('sessions.messagesCount')).toHaveLength(2)
  })

  it('highlights the current session only', () => {
    render(
      <SessionManager
        sessions={baseSessions}
        currentSessionId="s1"
        onCreateSession={vi.fn()}
        onSelectSession={vi.fn()}
        onUpdateSession={vi.fn()}
        onDeleteSession={vi.fn()}
        loadingSessions={false}
      />
    )

    const currentCard = screen
      .getByText('Alpha Session')
      .closest('div.cursor-pointer')!
    const otherCard = screen
      .getByText('Beta Session')
      .closest('div.cursor-pointer')!

    expect(currentCard.className).toContain('bg-primary/10 border-primary')
    expect(otherCard.className).not.toContain('bg-primary/10')
  })

  it('switches sessions on card click', () => {
    const { onSelectSession } = setup({ currentSessionId: 's1' })

    fireEvent.click(getCard('Beta Session'))

    expect(onSelectSession).toHaveBeenCalledTimes(1)
    expect(onSelectSession).toHaveBeenCalledWith('s2')
  })

  it('renders the list ordered by updated descending regardless of input order (A1)', () => {
    // Source sessions arrive created-desc from the API while notebook ones
    // arrive updated-desc — the panel must read updated-desc in both hosts.
    const shuffled: BaseChatSession[] = [
      mkSession('s1', 'Old Touch', { updated: '2026-01-01T10:00:00Z' }),
      mkSession('s2', 'New Touch', { updated: '2026-03-01T10:00:00Z' }),
      mkSession('s3', 'Mid Touch', { updated: '2026-02-01T10:00:00Z' }),
    ]
    setup({ sessions: shuffled, currentSessionId: 's1' })

    const titles = screen
      .getAllByText(/Touch$/)
      .map((el) => el.textContent)

    expect(titles).toEqual(['New Touch', 'Mid Touch', 'Old Touch'])
  })

  it('keeps input order for sessions sharing the same updated timestamp', () => {
    // Same-updated fixtures must not reshuffle (stable sort fallback).
    const sameTime: BaseChatSession[] = [
      mkSession('s1', 'First Session'),
      mkSession('s2', 'Second Session'),
    ]
    setup({ sessions: sameTime, currentSessionId: 's1' })

    const titles = screen
      .getAllByText(/Session$/)
      .map((el) => el.textContent)

    expect(titles).toEqual(['First Session', 'Second Session'])
  })

  it('falls back to the untitled placeholder for blank titles', () => {
    setup({ sessions: [mkSession('s1', '')] })

    expect(screen.getByText('sessions.untitled')).toBeInTheDocument()
  })

  describe('create', () => {
    it('creates a session from the create form on Enter', () => {
      const { onCreateSession } = setup()

      fireEvent.click(screen.getByLabelText('common.create'))
      const input = screen.getByPlaceholderText('sessions.newSessionPlaceholder')
      fireEvent.change(input, { target: { value: '  Fresh Chat  ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onCreateSession).toHaveBeenCalledTimes(1)
      expect(onCreateSession).toHaveBeenCalledWith('Fresh Chat')
      expect(
        screen.queryByPlaceholderText('sessions.newSessionPlaceholder')
      ).not.toBeInTheDocument()
    })

    it('keeps the form open on Enter when the title is blank', () => {
      const { onCreateSession } = setup()

      fireEvent.click(screen.getByLabelText('common.create'))
      const input = screen.getByPlaceholderText('sessions.newSessionPlaceholder')
      fireEvent.change(input, { target: { value: '   ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onCreateSession).not.toHaveBeenCalled()
      expect(
        screen.getByPlaceholderText('sessions.newSessionPlaceholder')
      ).toBeInTheDocument()
    })
  })

  describe('rename', () => {
    it('renames inline on Enter with the trimmed title', () => {
      const { onUpdateSession } = setup()

      fireEvent.click(within(getCard('Alpha Session')).getByLabelText('sessions.rename'))
      const input = screen.getByDisplayValue('Alpha Session')
      fireEvent.change(input, { target: { value: ' Renamed ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onUpdateSession).toHaveBeenCalledTimes(1)
      expect(onUpdateSession).toHaveBeenCalledWith('s1', 'Renamed')
    })

    it('cancels the rename on Escape without saving', () => {
      const { onUpdateSession } = setup()

      fireEvent.click(within(getCard('Alpha Session')).getByLabelText('sessions.rename'))
      const input = screen.getByDisplayValue('Alpha Session')
      fireEvent.change(input, { target: { value: 'Discarded' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(onUpdateSession).not.toHaveBeenCalled()
      expect(screen.getByText('Alpha Session')).toBeInTheDocument()
    })
  })

  describe('search', () => {
    it('filters sessions by a case-insensitive title substring', () => {
      setup()

      fireEvent.change(screen.getByPlaceholderText('sessions.searchPlaceholder'), {
        target: { value: 'BETA' },
      })

      expect(screen.queryByText('Alpha Session')).not.toBeInTheDocument()
      expect(screen.getByText('Beta Session')).toBeInTheDocument()
    })

    it('restores the full list when the query is cleared', () => {
      setup()

      const search = screen.getByPlaceholderText('sessions.searchPlaceholder')
      fireEvent.change(search, { target: { value: 'Alpha' } })
      fireEvent.change(search, { target: { value: '' } })

      expect(screen.getByText('Alpha Session')).toBeInTheDocument()
      expect(screen.getByText('Beta Session')).toBeInTheDocument()
    })

    it('shows the no-results state when nothing matches', () => {
      setup()

      fireEvent.change(screen.getByPlaceholderText('sessions.searchPlaceholder'), {
        target: { value: 'does-not-exist' },
      })

      expect(screen.getByText('sessions.noResults')).toBeInTheDocument()
      expect(screen.queryByText('Alpha Session')).not.toBeInTheDocument()
    })
  })

  describe('delete', () => {
    it('opens a destructive confirm naming the target session and deletes on confirm', () => {
      const { onDeleteSession } = setup({ currentSessionId: 's1' })

      fireEvent.click(within(getCard('Beta Session')).getByLabelText('sessions.deleteSession'))

      expect(screen.getByText('sessions.deleteSession')).toBeInTheDocument()
      const confirm = screen.getByText('common.delete').closest('button')!
      expect(confirm.className).toContain('bg-destructive')

      fireEvent.click(confirm)

      expect(onDeleteSession).toHaveBeenCalledTimes(1)
      expect(onDeleteSession).toHaveBeenCalledWith('s2')
    })

    it('keeps the session when the confirm dialog is cancelled', () => {
      const { onDeleteSession } = setup({ currentSessionId: 's1' })

      fireEvent.click(within(getCard('Beta Session')).getByLabelText('sessions.deleteSession'))
      fireEvent.click(screen.getByText('common.cancel'))

      expect(onDeleteSession).not.toHaveBeenCalled()
      expect(screen.getByText('Beta Session')).toBeInTheDocument()
    })

    it('disables the delete entry and opens no dialog while locked (A12)', () => {
      const { onDeleteSession } = setup({ currentSessionId: 's1', deleteDisabled: true })

      const deleteButton = within(getCard('Beta Session')).getByLabelText(
        'sessions.deleteSession'
      )
      expect(deleteButton).toBeDisabled()

      fireEvent.click(deleteButton)

      // No confirm dialog, no delete callback.
      expect(screen.queryByText('common.delete')).not.toBeInTheDocument()
      expect(onDeleteSession).not.toHaveBeenCalled()
    })

    it('locks the already-open confirm dialog when a generation starts (A12)', () => {
      // Dialog opened while idle, then a parallel run starts underneath it.
      const onDeleteSession = vi.fn()
      const props = (deleteDisabled: boolean) => ({
        sessions: baseSessions,
        currentSessionId: 's1' as const,
        onCreateSession: vi.fn(),
        onSelectSession: vi.fn(),
        onUpdateSession: vi.fn(),
        onDeleteSession,
        loadingSessions: false,
        deleteDisabled,
      })
      const { rerender } = render(<SessionManager {...props(false)} />)

      fireEvent.click(within(getCard('Beta Session')).getByLabelText('sessions.deleteSession'))
      rerender(<SessionManager {...props(true)} />)

      const confirm = screen.getByText('common.delete').closest('button')!
      expect(confirm).toBeDisabled()

      fireEvent.click(confirm)
      expect(onDeleteSession).not.toHaveBeenCalled()
    })
  })

  it('shows the empty state when there are no sessions at all', () => {
    setup({ sessions: [] })

    expect(screen.getByText('sessions.empty')).toBeInTheDocument()
    expect(screen.getByText('sessions.emptyHint')).toBeInTheDocument()
  })
})

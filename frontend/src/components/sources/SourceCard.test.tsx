import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SourceCard } from './SourceCard'
import { SourceListResponse } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useSourceStatus: vi.fn(() => ({ data: undefined, isLoading: false })),
}))

const baseSource: SourceListResponse = {
  id: 'source:1',
  title: 'My source',
  topics: [],
  asset: null,
  embedded: false,
  embedded_chunks: 0,
  insights_count: 0,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
}

function renderCard(embedding_status?: string | null, onClick?: (id: string) => void) {
  return render(<SourceCard source={{ ...baseSource, embedding_status }} onClick={onClick} />)
}

describe('SourceCard embedding-incomplete badge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['failed', 'partial', 'not_embedded'])(
    'shows the warning badge when embedding_status is %s',
    (status) => {
      renderCard(status)

      expect(screen.getByText('sources.embeddingIncomplete')).toBeInTheDocument()
      expect(screen.getByTitle('sources.embeddingIncompleteHint')).toBeInTheDocument()
    }
  )

  it.each(['queued', 'running', 'completed', undefined, null])(
    'hides the badge when embedding_status is %s',
    (status) => {
      renderCard(status)

      expect(screen.queryByText('sources.embeddingIncomplete')).not.toBeInTheDocument()
    }
  )

  it('navigates to the source detail page without triggering the card click', () => {
    const onClick = vi.fn()
    renderCard('failed', onClick)

    fireEvent.click(screen.getByText('sources.embeddingIncomplete'))

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/sources/source:1')
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('SourceCard context menu wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderCardWithMenuActions() {
    const actions = {
      onOpenSource: vi.fn(),
      onRename: vi.fn(),
      onMoveToFolder: vi.fn(),
      onNewFolder: vi.fn(),
    }
    render(<SourceCard source={{ ...baseSource }} {...actions} />)
    return actions
  }

  it('skips the context menu entirely when no menu callbacks are passed', () => {
    renderCard()
    fireEvent.contextMenu(screen.getByText('My source'))
    // Menu never mounts, so its items never appear in the DOM
    expect(document.querySelector('[data-slot="context-menu-content"]')).toBeNull()
  })

  it('opens the context menu on right-click and fires the clicked action', () => {
    const actions = renderCardWithMenuActions()
    fireEvent.contextMenu(screen.getByText('My source'))

    // The Radix content actually mounted, not just the trigger
    expect(document.querySelector('[data-slot="context-menu-content"]')).not.toBeNull()

    fireEvent.click(screen.getByText('sources.grouping.openSource'))
    expect(actions.onOpenSource).toHaveBeenCalledWith('source:1')

    fireEvent.contextMenu(screen.getByText('My source'))
    fireEvent.click(screen.getByText('sources.grouping.moveToFolder'))
    expect(actions.onMoveToFolder).toHaveBeenCalledWith('source:1')
  })

  it('adds rename/move/new-folder to the ⋮ dropdown when callbacks are passed', () => {
    renderCardWithMenuActions()

    // Radix dropdowns open on keyDown (pointerdown is not synthetic-clickable)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' })
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveToFolder')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.newFolder')).toBeInTheDocument()
  })

  it('opens the ⋮ dropdown with a full pointer sequence', () => {
    renderCardWithMenuActions()

    // jsdom has no PointerEvent class, and fireEvent's synthesized pointerdown
    // degrades to a bare Event (no button) which fails Radix's trigger guard
    // (button === 0, ctrlKey false). Building the pointerdown as a MouseEvent
    // keeps those properties, so the real pointer activation path works.
    fireEvent(
      screen.getByRole('button'),
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    )
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
  })

  it('re-renders the menu when a handler appears after first render (memo staleness)', () => {
    // Cold load: sources arrive before views, so onNewFolder starts undefined
    const { rerender } = render(
      <SourceCard source={{ ...baseSource }} onRename={vi.fn()} onNewFolder={undefined} />
    )
    fireEvent.contextMenu(screen.getByText('My source'))
    expect(screen.queryByText('sources.grouping.newFolder')).toBeNull()

    // views load and the handler flips to defined with identical source data —
    // areEqual must not swallow the change
    rerender(
      <SourceCard source={{ ...baseSource }} onRename={vi.fn()} onNewFolder={vi.fn()} />
    )
    fireEvent.contextMenu(screen.getByText('My source'))
    expect(screen.getByText('sources.grouping.newFolder')).toBeInTheDocument()
  })

  it('re-renders the menu when menuContextKey changes with identical source data', () => {
    // Switching view/group filters rebuilds organization closures; the key makes
    // memo respect the context change even though every source field is equal
    const ungroup = vi.fn()
    const { rerender } = render(
      <SourceCard
        source={{ ...baseSource }}
        onRename={vi.fn()}
        onUngroupFromFolder={ungroup}
        menuContextKey="source_view:a:all"
      />
    )
    rerender(
      <SourceCard
        source={{ ...baseSource }}
        onRename={vi.fn()}
        onUngroupFromFolder={ungroup}
        menuContextKey="source_view:b:g2"
      />
    )
    fireEvent.contextMenu(screen.getByText('My source'))
    // The new context's card still exposes the action (stale memo would drop it
    // if presence or key were ignored)
    expect(screen.getByText('sources.grouping.ungroupAction')).toBeInTheDocument()
  })
})

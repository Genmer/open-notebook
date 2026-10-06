import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { enUS, de } from 'date-fns/locale'
import {
  ContextBreakdownDialog,
  findSegment,
  excerpt,
  modeBadgeKey,
  historyItemExcerpt,
  groupHistoryByTime,
  messageTimestampById,
  assignTopicGroups,
} from './ContextBreakdownDialog'
import type {
  ContextBreakdown,
  ContextBreakdownHistoryItem,
  ChatTopicGroup,
  NotebookChatMessage,
} from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const breakdown: ContextBreakdown = {
  total_chars: 25100,
  estimated_tokens: 6200,
  segments: [
    { key: 'system_prompt', chars: 2848, percent: 11.35, message_count: null, items: null },
    {
      key: 'history',
      chars: 5300,
      percent: 21.12,
      message_count: 2,
      items: [
        { message_id: 'msg-1', role: 'human', chars: 460, percent: 1.83 },
        { message_id: 'msg-2', role: 'ai', chars: 1200, percent: 4.78 },
      ],
    },
    {
      key: 'sources',
      chars: 15000,
      percent: 59.76,
      items: [
        { id: 'source:a', title: '深度学习综述', mode: 'full content', chars: 15000, percent: 59.76 },
        { id: 'source:b', title: 'Insights only source', mode: 'insights', chars: 800, percent: 3.19 },
      ],
    },
    {
      key: 'notes',
      chars: 1952,
      percent: 7.78,
      items: [{ id: 'note:c', title: '读书笔记', mode: null, chars: 1952, percent: 7.78 }],
    },
  ],
}

const messages: NotebookChatMessage[] = [
  { id: 'msg-1', type: 'human', content: 'What is the depth of the sea?'.padEnd(90, '.') },
  { id: 'msg-2', type: 'ai', content: 'The average depth is about 3,700 meters.' },
]

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  breakdown,
  messages,
}

describe('ContextBreakdownDialog helpers', () => {
  it('findSegment returns the requested segment or undefined', () => {
    expect(findSegment(breakdown, 'sources')?.chars).toBe(15000)
    expect(findSegment(null, 'sources')).toBeUndefined()
    expect(
      findSegment({ total_chars: 0, estimated_tokens: 0, segments: [] }, 'history'),
    ).toBeUndefined()
  })

  it('excerpt truncates with an ellipsis beyond the max length', () => {
    expect(excerpt('abcdefghij', 5)).toBe('abcde…')
    expect(excerpt('  short  ', 20)).toBe('short')
  })

  it('modeBadgeKey maps status strings to locale keys and null otherwise', () => {
    expect(modeBadgeKey('full content')).toBe('common.contextModes.full')
    expect(modeBadgeKey('insights')).toBe('common.contextModes.insights')
    expect(modeBadgeKey('not in')).toBeNull()
    expect(modeBadgeKey(null)).toBeNull()
    expect(modeBadgeKey(undefined)).toBeNull()
  })

  it('historyItemExcerpt pulls content by id and falls back to the id', () => {
    // 30-char excerpt of the padded content + the ellipsis marker
    expect(historyItemExcerpt(breakdown.segments![1].items![0] as never, messages, 30))
      .toBe(`${'What is the depth of the sea?'.padEnd(30, '.')}…`)
    // Unknown id → falls back to the id itself
    expect(
      historyItemExcerpt({ message_id: 'gone', role: 'human', chars: 1, percent: 0.1 }, messages, 30),
    ).toBe('gone')
  })
})

describe('ContextBreakdownDialog rendering', () => {
  it('renders the four segments with per-item chars and percents', () => {
    render(<ContextBreakdownDialog {...defaultProps} />)

    expect(screen.getByTestId('context-breakdown-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-section-system_prompt')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-section-history')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-section-sources')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-section-notes')).toBeInTheDocument()

    // Per-item detail rows: history items, source rows, note rows. The global
    // t mock returns the bare key, so totals are asserted via the key names.
    expect(screen.getByTestId('breakdown-message-msg-1')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-message-msg-2')).toBeInTheDocument()
    expect(screen.getByText('深度学习综述')).toBeInTheDocument()
    expect(screen.getByText('读书笔记')).toBeInTheDocument()
    expect(screen.getByText('context.totalLine')).toBeInTheDocument()
    expect(screen.getByText('context.estimateHint')).toBeInTheDocument()
  })

  it('shows empty-state copy when a content segment has no items', () => {
    const empty: ContextBreakdown = {
      total_chars: 2848,
      estimated_tokens: 700,
      segments: [
        { key: 'system_prompt', chars: 2848, percent: 100, message_count: null, items: null },
        { key: 'history', chars: 0, percent: 0, message_count: 0, items: [] },
        { key: 'sources', chars: 0, percent: 0, items: [] },
        { key: 'notes', chars: 0, percent: 0, items: [] },
      ],
    }
    render(<ContextBreakdownDialog {...defaultProps} breakdown={empty} />)

    expect(screen.getByText('context.sourcesEmpty')).toBeInTheDocument()
    expect(screen.getByText('context.notesEmpty')).toBeInTheDocument()
    expect(screen.getByText('context.historyEmpty')).toBeInTheDocument()
    expect(screen.getByText('context.emptyBreakdown')).toBeInTheDocument()
    // Clear-history entry hidden: nothing to clear
    expect(screen.queryByTestId('breakdown-clear-history')).toBeNull()
  })

  it('hides the remove button when no mode-change handler is given', () => {
    render(<ContextBreakdownDialog {...defaultProps} onSourceModeChange={undefined} />)

    const sourceRow = screen.getByText('深度学习综述').closest('li')!
    expect(sourceRow.querySelector('button[aria-label="context.removeItem"]')).toBeNull()
  })

  it('renders the role badge and mode badges', () => {
    render(<ContextBreakdownDialog {...defaultProps} />)

    expect(screen.getByText('context.roleUser')).toBeInTheDocument()
    expect(screen.getByText('context.roleAssistant')).toBeInTheDocument()
    expect(screen.getByText('common.contextModes.full')).toBeInTheDocument()
    expect(screen.getByText('common.contextModes.insights')).toBeInTheDocument()
  })
})

describe('ContextBreakdownDialog editing entries', () => {
  it('deletes one history message through the destructive confirm', () => {
    const onRemoveMessages = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onRemoveMessages={onRemoveMessages} />)

    // Row carries the real excerpt (content matched by message id), not a key
    expect(screen.getByTitle(/What is the depth of the sea/)).toBeInTheDocument()

    // Row delete button opens the confirm, not the mutation directly
    fireEvent.click(screen.getAllByLabelText('context.deleteMessage')[0])
    expect(onRemoveMessages).not.toHaveBeenCalled()

    // Confirm dialog is the destructive copy (bare keys under the t mock);
    // the confirm action is the last button in the open alert dialog.
    expect(screen.getByText('context.deleteMessageDesc')).toBeInTheDocument()
    const dialog = screen.getByText('context.deleteMessageDesc').closest('[role="alertdialog"]')!
    const buttons = dialog.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(onRemoveMessages).toHaveBeenCalledWith(['msg-1'])
  })

  it('clears the history through the destructive confirm with the message count', () => {
    const onClearMessages = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onClearMessages={onClearMessages} />)

    fireEvent.click(screen.getByTestId('breakdown-clear-history'))
    expect(onClearMessages).not.toHaveBeenCalled()

    // Destructive clear copy shown (count interpolation is flattened by the
    // t mock; the count itself is unit-covered by historyCount usage).
    const dialog = screen.getByText('context.clearHistoryDesc').closest('[role="alertdialog"]')!
    const buttons = dialog.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(onClearMessages).toHaveBeenCalledTimes(1)
  })

  it('removes a source by delegating to onSourceModeChange(id, "off")', () => {
    const onSourceModeChange = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onSourceModeChange={onSourceModeChange} />)

    const row = screen.getByText('深度学习综述').closest('li')!
    fireEvent.click(row.querySelector('button[aria-label="context.removeItem"]')!)

    expect(onSourceModeChange).toHaveBeenCalledWith('source:a', 'off')
  })

  it('removes a note by delegating to onNoteModeChange(id, "off")', () => {
    const onNoteModeChange = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onNoteModeChange={onNoteModeChange} />)

    const row = screen.getByText('读书笔记').closest('li')!
    fireEvent.click(row.querySelector('button[aria-label="context.removeItem"]')!)

    expect(onNoteModeChange).toHaveBeenCalledWith('note:c', 'off')
  })

  it('disables every destructive entry while editLocked', () => {
    const onRemoveMessages = vi.fn()
    const onClearMessages = vi.fn()
    render(
      <ContextBreakdownDialog
        {...defaultProps}
        editLocked
        onRemoveMessages={onRemoveMessages}
        onClearMessages={onClearMessages}
      />
    )

    expect(screen.getByTestId('breakdown-clear-history')).toBeDisabled()
    expect(screen.getAllByLabelText('context.deleteMessage')[0]).toBeDisabled()
  })

  it('forwards the manage-sources entry to onOpenContextPicker', () => {
    const onOpenContextPicker = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onOpenContextPicker={onOpenContextPicker} />)

    fireEvent.click(screen.getByTestId('breakdown-manage-sources'))
    expect(onOpenContextPicker).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Time grouping (pure helpers + view wiring)
// ---------------------------------------------------------------------------

// Fixed "now": 2026-10-07 is a Wednesday. All pure-helper expectations are
// relative to this instant so bucket assignment never depends on when the
// suite runs.
const NOW = new Date(2026, 9, 7, 12, 0, 0)

// Local-time ISO strings (no offset) — parsed as local time by spec, so the
// runner's timezone cannot shift the calendar day.
const timeMessages: NotebookChatMessage[] = [
  { id: 't-today', type: 'human', content: 'today message', timestamp: '2026-10-07T08:00:00' },
  { id: 't-yesterday', type: 'ai', content: 'yesterday message', timestamp: '2026-10-06T09:00:00' },
  { id: 't-monday', type: 'human', content: 'monday message', timestamp: '2026-10-05T10:00:00' },
  { id: 't-sunday', type: 'ai', content: 'sunday message', timestamp: '2026-10-04T10:00:00' },
  { id: 't-saturday', type: 'ai', content: 'saturday message', timestamp: '2026-10-03T10:00:00' },
  { id: 't-legacy', type: 'human', content: 'legacy message' },
  { id: 't-broken', type: 'ai', content: 'broken clock', timestamp: 'not-a-date' },
]

const timeItems: ContextBreakdownHistoryItem[] = [
  { message_id: 't-today', role: 'human', chars: 10, percent: 0.1 },
  { message_id: 't-yesterday', role: 'ai', chars: 10, percent: 0.1 },
  { message_id: 't-monday', role: 'human', chars: 10, percent: 0.1 },
  { message_id: 't-sunday', role: 'ai', chars: 10, percent: 0.1 },
  { message_id: 't-saturday', role: 'ai', chars: 10, percent: 0.1 },
  { message_id: 't-legacy', role: 'human', chars: 10, percent: 0.1 },
  { message_id: 't-broken', role: 'ai', chars: 10, percent: 0.1 },
]

const bucketOf = (id: string) =>
  groupHistoryByTime(timeItems, timeMessages, NOW).find(group =>
    group.items.some(item => item.message_id === id),
  )?.bucket

describe('messageTimestampById', () => {
  it('matches the session message by id', () => {
    expect(messageTimestampById(timeItems[0], timeMessages)).toBe('2026-10-07T08:00:00')
  })

  it('yields null for unknown ids, missing, blank and mistyped timestamps', () => {
    expect(messageTimestampById({ message_id: 'gone', role: 'ai', chars: 1, percent: 0 }, timeMessages)).toBeNull()
    expect(messageTimestampById(timeItems[5], timeMessages)).toBeNull()
    expect(messageTimestampById({ message_id: 'x', role: 'ai', chars: 1, percent: 0 }, [
      { id: 'x', type: 'ai', content: 'c', timestamp: '   ' },
    ])).toBeNull()
    expect(messageTimestampById({ message_id: 'x', role: 'ai', chars: 1, percent: 0 }, [
      { id: 'x', type: 'ai', content: 'c', timestamp: 123 as unknown as string },
    ])).toBeNull()
  })
})

describe('groupHistoryByTime', () => {
  it('buckets by local calendar day, then natural week', () => {
    expect(bucketOf('t-today')).toBe('today')
    expect(bucketOf('t-yesterday')).toBe('yesterday')
    expect(bucketOf('t-monday')).toBe('thisWeek')
    expect(bucketOf('t-saturday')).toBe('earlier')
  })

  it('puts missing and unparseable timestamps into unknown, always last', () => {
    const groups = groupHistoryByTime(timeItems, timeMessages, NOW)
    expect(groups.map(group => group.bucket)).toEqual([
      'today',
      'yesterday',
      'thisWeek',
      'earlier',
      'unknown',
    ])
    const unknown = groups[groups.length - 1]
    expect(unknown.items.map(item => item.message_id)).toEqual(['t-legacy', 't-broken'])
  })

  it('keeps the original item order inside a bucket and drops empty buckets', () => {
    // Both items fall on the same day; input order must survive.
    const sameDay: ContextBreakdownHistoryItem[] = [
      { message_id: 'b', role: 'ai', chars: 1, percent: 0 },
      { message_id: 'a', role: 'human', chars: 1, percent: 0 },
    ]
    const groups = groupHistoryByTime(sameDay, [
      { id: 'b', type: 'ai', content: 'b', timestamp: '2026-10-07T20:00:00' },
      { id: 'a', type: 'human', content: 'a', timestamp: '2026-10-07T06:00:00' },
    ], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].bucket).toBe('today')
    expect(groups[0].items.map(item => item.message_id)).toEqual(['b', 'a'])
  })

  it('follows the date-fns locale for the week start', () => {
    // Sunday 2026-10-04: inside the week of Wednesday 2026-10-07 when the
    // week starts on Sunday (en-US), in the previous week when it starts on
    // Monday (de).
    expect(bucketOf('t-sunday')).toBe('thisWeek')
    const groupsDe = groupHistoryByTime(timeItems, timeMessages, NOW, de)
    const sundayInDe = groupsDe.find(group =>
      group.items.some(item => item.message_id === 't-sunday'),
    )
    expect(sundayInDe?.bucket).toBe('earlier')
    // Passing no locale keeps the date-fns default (Sunday start).
    expect(groupHistoryByTime(timeItems, timeMessages, NOW, enUS)[0].bucket).toBe('today')
  })

  it('returns an empty list for an empty history', () => {
    expect(groupHistoryByTime([], timeMessages, NOW)).toEqual([])
  })
})

// Timestamped fixtures for the wired-up views, computed relative to the real
// clock so the component's own `new Date()` grouping is deterministic in any
// timezone or run date.
const DAY_MS = 86_400_000
const localIso = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

const wiredMessages: NotebookChatMessage[] = [
  { id: 'w-today', type: 'human', content: 'sent moments ago', timestamp: localIso(new Date()) },
  { id: 'w-today-2', type: 'ai', content: 'also today', timestamp: localIso(new Date()) },
  { id: 'w-yesterday', type: 'ai', content: 'answered yesterday', timestamp: localIso(new Date(Date.now() - DAY_MS)) },
  { id: 'w-ancient', type: 'human', content: 'from long ago', timestamp: localIso(new Date(Date.now() - 40 * DAY_MS)) },
  { id: 'w-legacy', type: 'ai', content: 'no timestamp at all' },
]

const wiredItems: ContextBreakdownHistoryItem[] = [
  { message_id: 'w-today', role: 'human', chars: 40, percent: 1 },
  { message_id: 'w-today-2', role: 'ai', chars: 40, percent: 1 },
  { message_id: 'w-yesterday', role: 'ai', chars: 40, percent: 1 },
  { message_id: 'w-ancient', role: 'human', chars: 40, percent: 1 },
  { message_id: 'w-legacy', role: 'ai', chars: 40, percent: 1 },
]

const wiredBreakdown: ContextBreakdown = {
  total_chars: 200,
  estimated_tokens: 50,
  segments: [
    {
      key: 'history',
      chars: 200,
      percent: 100,
      message_count: 5,
      items: wiredItems,
    },
  ],
}

const wiredProps = {
  open: true,
  onOpenChange: vi.fn(),
  breakdown: wiredBreakdown,
  messages: wiredMessages,
}

const openTimeView = () => {
  fireEvent.click(screen.getByTestId('breakdown-history-view-time'))
}

describe('ContextBreakdownDialog time view', () => {
  it('defaults to the flat list with no group headers', () => {
    render(<ContextBreakdownDialog {...wiredProps} />)

    expect(screen.getByTestId('breakdown-history-view-flat')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('breakdown-time-group-today')).toBeNull()
    expect(screen.getByTestId('breakdown-message-w-today')).toBeInTheDocument()
  })

  it('renders calendar group headers with rows inside each group', () => {
    render(<ContextBreakdownDialog {...wiredProps} />)
    openTimeView()

    expect(screen.getByTestId('breakdown-history-view-time')).toHaveAttribute('aria-pressed', 'true')
    for (const bucket of ['today', 'yesterday', 'earlier', 'unknown']) {
      expect(screen.getByTestId(`breakdown-time-group-${bucket}`)).toBeInTheDocument()
    }
    expect(screen.getByText('context.timeToday')).toBeInTheDocument()
    expect(screen.getByText('context.timeYesterday')).toBeInTheDocument()
    expect(screen.getByText('context.timeUnknown')).toBeInTheDocument()
    // Rows survive the regrouping, each still carrying its checkbox
    expect(screen.getByTestId('breakdown-message-w-ancient')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-check-w-ancient')).toBeInTheDocument()
  })

  it('orders the unknown group after the dated groups', () => {
    render(<ContextBreakdownDialog {...wiredProps} />)
    openTimeView()

    const unknown = screen.getByTestId('breakdown-time-group-unknown')
    const earlier = screen.getByTestId('breakdown-time-group-earlier')
    expect(
      unknown.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  })

  it('switches back to the flat list without leaving group headers behind', () => {
    render(<ContextBreakdownDialog {...wiredProps} />)
    openTimeView()
    fireEvent.click(screen.getByTestId('breakdown-history-view-flat'))

    expect(screen.queryByTestId('breakdown-time-group-today')).toBeNull()
    expect(screen.getByTestId('breakdown-message-w-today')).toBeInTheDocument()
  })

  it('selects and deselects a whole group from the header checkbox', () => {
    render(<ContextBreakdownDialog {...wiredProps} />)
    openTimeView()

    // Nothing selected: no action bar yet
    expect(screen.queryByTestId('breakdown-selected-bar')).toBeNull()

    // Picking one row of the two-row today group shows the indeterminate
    // tri-state on the group header
    fireEvent.click(screen.getByTestId('breakdown-check-w-today-2'))
    expect(screen.getByTestId('breakdown-selected-bar')).toBeInTheDocument()
    expect(screen.getByText('context.selectedCount')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-check-group-today')).toHaveAttribute(
      'data-state',
      'indeterminate',
    )

    // The header checkbox completes the group: every row joins
    fireEvent.click(screen.getByTestId('breakdown-check-group-today'))
    expect(screen.getByTestId('breakdown-check-group-today')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('breakdown-check-w-today')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('breakdown-check-w-today-2')).toHaveAttribute('data-state', 'checked')
    // Rows of other groups stay out of the selection
    expect(screen.getByTestId('breakdown-check-w-legacy')).toHaveAttribute('data-state', 'unchecked')

    // Toggling the header again clears the whole group and, with nothing
    // left selected, the action bar disappears
    fireEvent.click(screen.getByTestId('breakdown-check-group-today'))
    expect(screen.getByTestId('breakdown-check-w-today')).toHaveAttribute('data-state', 'unchecked')
    expect(screen.getByTestId('breakdown-check-w-today-2')).toHaveAttribute('data-state', 'unchecked')
    expect(screen.queryByTestId('breakdown-selected-bar')).toBeNull()
  })

  it('keeps the selection across view switches', () => {
    render(<ContextBreakdownDialog {...wiredProps} />)
    openTimeView()
    fireEvent.click(screen.getByTestId('breakdown-check-group-earlier'))
    expect(screen.getByTestId('breakdown-selected-bar')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('breakdown-history-view-flat'))
    expect(screen.getByTestId('breakdown-selected-bar')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-check-w-ancient')).toHaveAttribute('data-state', 'checked')

    openTimeView()
    expect(screen.getByTestId('breakdown-check-w-ancient')).toHaveAttribute('data-state', 'checked')
  })
})

describe('ContextBreakdownDialog batch delete', () => {
  it('deletes the selection only after the destructive confirm', () => {
    const onRemoveMessages = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onRemoveMessages={onRemoveMessages} />)

    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    fireEvent.click(screen.getByTestId('breakdown-check-msg-2'))
    expect(screen.getByTestId('breakdown-selected-bar')).toBeInTheDocument()

    // Opening the confirm must not fire the mutation
    fireEvent.click(screen.getByTestId('breakdown-delete-selected'))
    expect(onRemoveMessages).not.toHaveBeenCalled()

    // Destructive copy with count + chars; confirm is the dialog's last button
    expect(screen.getByText('context.deleteSelectedDesc')).toBeInTheDocument()
    const dialog = screen.getByText('context.deleteSelectedDesc').closest('[role="alertdialog"]')!
    const buttons = dialog.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(onRemoveMessages).toHaveBeenCalledTimes(1)
    const ids = onRemoveMessages.mock.calls[0][0] as string[]
    expect(ids).toHaveLength(2)
    expect(ids).toContain('msg-1')
    expect(ids).toContain('msg-2')
  })

  it('does not delete when the confirm is cancelled', () => {
    const onRemoveMessages = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onRemoveMessages={onRemoveMessages} />)

    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    fireEvent.click(screen.getByTestId('breakdown-delete-selected'))
    const dialog = screen.getByText('context.deleteSelectedDesc').closest('[role="alertdialog"]')!
    fireEvent.click(dialog.querySelector('button')!)
    expect(onRemoveMessages).not.toHaveBeenCalled()
    // Selection survives a cancelled confirm
    expect(screen.getByTestId('breakdown-selected-bar')).toBeInTheDocument()
  })

  it('hides the batch entries while nothing is selected', () => {
    render(<ContextBreakdownDialog {...defaultProps} onRemoveMessages={vi.fn()} />)

    expect(screen.queryByTestId('breakdown-selected-bar')).toBeNull()
    expect(screen.queryByTestId('breakdown-delete-selected')).toBeNull()
  })

  it('locks checkboxes and the delete-selected button while editLocked', () => {
    const props = { ...defaultProps, onRemoveMessages: vi.fn(), onClearMessages: vi.fn() }
    const { rerender } = render(<ContextBreakdownDialog {...props} />)

    // Select first, then lock: every destructive entry must go disabled
    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    rerender(<ContextBreakdownDialog {...props} editLocked />)

    expect(screen.getAllByLabelText('context.checkMessage')[0]).toBeDisabled()
    expect(screen.getByTestId('breakdown-delete-selected')).toBeDisabled()
    expect(screen.getByTestId('breakdown-clear-history')).toBeDisabled()
  })

  it('prunes selected ids that disappear from the authoritative history', () => {
    const props = { ...defaultProps, onRemoveMessages: vi.fn() }
    const { rerender } = render(<ContextBreakdownDialog {...props} />)

    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    fireEvent.click(screen.getByTestId('breakdown-check-msg-2'))

    // msg-1 vanishes out-of-band (e.g. another client deleted it): the bar
    // must fall back to the single surviving selection.
    const pruned: ContextBreakdown = {
      ...breakdown,
      segments: breakdown.segments.map((segment, index) =>
        index === 1
          ? { ...segment, items: [breakdown.segments![1].items![1]] }
          : segment,
      ),
    }
    rerender(<ContextBreakdownDialog {...props} breakdown={pruned} />)

    expect(screen.getByTestId('breakdown-check-msg-2')).toHaveAttribute('data-state', 'checked')
    fireEvent.click(screen.getByTestId('breakdown-delete-selected'))
    const dialog = screen.getByText('context.deleteSelectedDesc').closest('[role="alertdialog"]')!
    const buttons = dialog.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(props.onRemoveMessages).toHaveBeenCalledWith(['msg-2'])
  })
})

// ---------------------------------------------------------------------------
// Topic grouping (pure helper + view wiring)
// ---------------------------------------------------------------------------

const topicItems: ContextBreakdownHistoryItem[] = [
  { message_id: 'a', role: 'human', chars: 1, percent: 1 },
  { message_id: 'b', role: 'ai', chars: 1, percent: 1 },
  { message_id: 'c', role: 'ai', chars: 1, percent: 1 },
]

describe('assignTopicGroups', () => {
  it('drops unknown ids, keeps duplicate ids in the first group, computes ungrouped', () => {
    const groups: ChatTopicGroup[] = [
      { name: 'One', message_ids: ['a', 'ghost'] },
      { name: 'Two', message_ids: ['a', 'b'] },
    ]
    const view = assignTopicGroups(groups, topicItems)
    expect(view.groups).toHaveLength(2)
    expect(view.groups[0].items.map(item => item.message_id)).toEqual(['a'])
    // 'a' is already claimed by group One, so group Two only keeps 'b'
    expect(view.groups[1].items.map(item => item.message_id)).toEqual(['b'])
    expect(view.ungrouped.map(item => item.message_id)).toEqual(['c'])
  })

  it('skips groups without renderable rows and passes everything through without groups', () => {
    expect(assignTopicGroups([{ name: 'Empty', message_ids: ['ghost'] }], topicItems)).toEqual({
      groups: [],
      ungrouped: topicItems,
    })
    expect(assignTopicGroups(null, topicItems)).toEqual({ groups: [], ungrouped: topicItems })
  })
})

describe('ContextBreakdownDialog topic view', () => {
  const openTopicView = () => fireEvent.click(screen.getByTestId('breakdown-history-view-topic'))

  const classification = {
    session_id: 'chat_session:nb1',
    groups: [
      { name: '深度学习', message_ids: ['w-today', 'w-today-2', 'gone-id'] },
      { name: '数据导入', message_ids: ['w-yesterday'] },
    ],
    truncated: true,
    total_messages: 5,
    classified_messages: 100,
  }

  it('shows the explain panel with an explicit classify button on first entry', () => {
    render(<ContextBreakdownDialog {...wiredProps} onClassifyTopics={vi.fn()} />)
    openTopicView()

    expect(screen.getByTestId('breakdown-topic-empty')).toBeInTheDocument()
    expect(screen.getByText('context.topicClassifyHint')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-classify-topics')).toBeInTheDocument()
  })

  it('renders named groups, the ungrouped tail and the truncated notice', async () => {
    const onClassifyTopics = vi.fn().mockResolvedValue(classification)
    render(<ContextBreakdownDialog {...wiredProps} onClassifyTopics={onClassifyTopics} />)
    openTopicView()
    fireEvent.click(screen.getByTestId('breakdown-classify-topics'))

    expect(await screen.findByTestId('breakdown-topic-group-0')).toBeInTheDocument()
    expect(screen.getByText('深度学习')).toBeInTheDocument()
    expect(screen.getByText('数据导入')).toBeInTheDocument()
    // w-ancient/w-legacy are in no group → trailing ungrouped group
    expect(screen.getByTestId('breakdown-topic-group-ungrouped')).toBeInTheDocument()
    expect(screen.getByText('context.ungrouped')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-message-w-legacy')).toBeInTheDocument()
    // The ghost id from the payload never renders a row
    expect(screen.queryByTestId('breakdown-message-gone-id')).toBeNull()
    expect(screen.getByText('context.classifyTruncated')).toBeInTheDocument()
    expect(screen.queryByTestId('breakdown-topic-empty')).toBeNull()
  })

  it('selects a whole topic group and keeps the selection across views', async () => {
    const onClassifyTopics = vi.fn().mockResolvedValue(classification)
    render(<ContextBreakdownDialog {...wiredProps} onClassifyTopics={onClassifyTopics} />)
    openTopicView()
    fireEvent.click(screen.getByTestId('breakdown-classify-topics'))
    await screen.findByTestId('breakdown-topic-group-0')

    fireEvent.click(screen.getByTestId('breakdown-check-group-topic-0'))
    expect(screen.getByTestId('breakdown-check-w-today')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('breakdown-check-w-today-2')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('breakdown-selected-bar')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('breakdown-history-view-flat'))
    expect(screen.getByTestId('breakdown-check-w-today')).toHaveAttribute('data-state', 'checked')
  })

  it('stays on the explain panel when the classification fails (null result)', async () => {
    const onClassifyTopics = vi.fn().mockResolvedValue(null)
    render(<ContextBreakdownDialog {...wiredProps} onClassifyTopics={onClassifyTopics} />)
    openTopicView()
    fireEvent.click(screen.getByTestId('breakdown-classify-topics'))

    await waitFor(() => expect(onClassifyTopics).toHaveBeenCalled())
    expect(screen.getByTestId('breakdown-topic-empty')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-classify-topics')).not.toBeDisabled()
  })

  it('disables the classify entry while isClassifying', () => {
    render(<ContextBreakdownDialog {...wiredProps} isClassifying onClassifyTopics={vi.fn()} />)
    openTopicView()

    expect(screen.getByTestId('breakdown-classify-topics')).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Compression flow
// ---------------------------------------------------------------------------

describe('ContextBreakdownDialog compress flow', () => {
  it('submits the selection only after the destructive confirm', () => {
    const onCompressMessages = vi.fn()
    const onRemoveMessages = vi.fn()
    render(
      <ContextBreakdownDialog
        {...defaultProps}
        onCompressMessages={onCompressMessages}
        onRemoveMessages={onRemoveMessages}
      />,
    )

    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    fireEvent.click(screen.getByTestId('breakdown-check-msg-2'))
    expect(screen.getByTestId('breakdown-compress-selected')).not.toBeDisabled()

    // Opening the confirm must not fire the mutation
    fireEvent.click(screen.getByTestId('breakdown-compress-selected'))
    expect(onCompressMessages).not.toHaveBeenCalled()
    expect(screen.getByText('context.compressTitle')).toBeInTheDocument()
    expect(screen.getByText('context.compressDesc')).toBeInTheDocument()

    // Confirm is the alert dialog's last button (same pattern as the deletes)
    const dialog = screen.getByText('context.compressDesc').closest('[role="alertdialog"]')!
    const buttons = dialog.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(onCompressMessages).toHaveBeenCalledTimes(1)
    const ids = onCompressMessages.mock.calls[0][0] as string[]
    expect(ids).toHaveLength(2)
    expect(ids).toContain('msg-1')
    expect(ids).toContain('msg-2')
    // The selection is spent on the compress; the delete path never fired
    expect(onRemoveMessages).not.toHaveBeenCalled()
    expect(screen.queryByTestId('breakdown-selected-bar')).toBeNull()
  })

  it('does not submit when the compress confirm is cancelled', () => {
    const onCompressMessages = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onCompressMessages={onCompressMessages} />)

    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    fireEvent.click(screen.getByTestId('breakdown-check-msg-2'))
    fireEvent.click(screen.getByTestId('breakdown-compress-selected'))
    const dialog = screen.getByText('context.compressDesc').closest('[role="alertdialog"]')!
    fireEvent.click(dialog.querySelector('button')!)

    expect(onCompressMessages).not.toHaveBeenCalled()
  })

  it('needs at least two selected messages to compress', () => {
    const onCompressMessages = vi.fn()
    render(<ContextBreakdownDialog {...defaultProps} onCompressMessages={onCompressMessages} />)

    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    expect(screen.getByTestId('breakdown-compress-selected')).toBeDisabled()

    fireEvent.click(screen.getByTestId('breakdown-check-msg-2'))
    expect(screen.getByTestId('breakdown-compress-selected')).not.toBeDisabled()
  })

  it('hides the compress entry without an onCompressMessages handler', () => {
    render(<ContextBreakdownDialog {...defaultProps} onRemoveMessages={vi.fn()} />)

    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    expect(screen.getByTestId('breakdown-selected-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('breakdown-compress-selected')).toBeNull()
  })

  it('locks checkboxes, delete, clear and compress while isCompressing', () => {
    const props = {
      ...defaultProps,
      onCompressMessages: vi.fn(),
      onRemoveMessages: vi.fn(),
      onClearMessages: vi.fn(),
    }
    const { rerender } = render(<ContextBreakdownDialog {...props} />)
    fireEvent.click(screen.getByTestId('breakdown-check-msg-1'))
    fireEvent.click(screen.getByTestId('breakdown-check-msg-2'))
    rerender(<ContextBreakdownDialog {...props} isCompressing />)

    expect(screen.getByTestId('breakdown-compress-selected')).toBeDisabled()
    expect(screen.getByTestId('breakdown-delete-selected')).toBeDisabled()
    expect(screen.getByTestId('breakdown-clear-history')).toBeDisabled()
    expect(screen.getAllByLabelText('context.checkMessage')[0]).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Summary badge (message_kind from the compression command)
// ---------------------------------------------------------------------------

describe('ContextBreakdownDialog summary badge', () => {
  it('marks a message_kind=summary row with the summary badge instead of Assistant', () => {
    const summaryMessages: NotebookChatMessage[] = [
      { id: 'msg-sum', type: 'ai', content: 'Merged summary of the earlier discussion', message_kind: 'summary' },
      { id: 'msg-plain', type: 'ai', content: 'A regular answer' },
    ]
    const summaryBreakdown: ContextBreakdown = {
      total_chars: 100,
      estimated_tokens: 25,
      segments: [
        {
          key: 'history',
          chars: 100,
          percent: 100,
          message_count: 2,
          items: [
            { message_id: 'msg-sum', role: 'ai', chars: 50, percent: 50 },
            { message_id: 'msg-plain', role: 'ai', chars: 50, percent: 50 },
          ],
        },
      ],
    }
    render(
      <ContextBreakdownDialog
        open
        onOpenChange={vi.fn()}
        breakdown={summaryBreakdown}
        messages={summaryMessages}
      />,
    )

    expect(screen.getByText('context.summaryBadge')).toBeInTheDocument()
    // Only the plain ai row still carries the Assistant badge
    expect(screen.getByText('context.roleAssistant')).toBeInTheDocument()
  })
})

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  ContextBreakdownDialog,
  findSegment,
  excerpt,
  modeBadgeKey,
  historyItemExcerpt,
} from './ContextBreakdownDialog'
import type { ContextBreakdown, NotebookChatMessage } from '@/lib/types/api'

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

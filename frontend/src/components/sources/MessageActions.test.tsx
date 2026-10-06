import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageActions } from './MessageActions'

// 探针：保存按钮现在只负责开弹窗，提交逻辑在 SaveNoteDialog 内部（自有测试覆盖）
vi.mock('./SaveNoteDialog', () => ({
  SaveNoteDialog: ({
    open,
    content,
    notebookId,
    sourceGrouping,
  }: {
    open: boolean
    content: string
    notebookId: string
    sourceGrouping?: unknown
  }) => (
    <div
      data-testid="save-note-probe"
      data-open={String(open)}
      data-content={content}
      data-notebook={notebookId}
      data-source-grouping={sourceGrouping ? JSON.stringify(sourceGrouping) : ''}
    />
  ),
}))

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

// useTranslation is mocked globally in setup.ts (t returns the key string)

describe('MessageActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the save dialog instead of mutating directly when the text save button is clicked', () => {
    render(<MessageActions content="answer" notebookId="nb:1" />)

    const save = screen.getByRole('button', { name: /common\.save/ })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)

    const probe = screen.getByTestId('save-note-probe')
    expect(probe).toHaveAttribute('data-open', 'true')
    expect(probe).toHaveAttribute('data-content', 'answer')
    expect(probe).toHaveAttribute('data-notebook', 'nb:1')
  })

  it('passes the grouping scope to the save dialog by reference when provided', () => {
    const sourceGrouping = { viewId: 'view:1', group: 'group:1' }
    render(
      <MessageActions content="answer" notebookId="nb:1" sourceGrouping={sourceGrouping} />
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    expect(screen.getByTestId('save-note-probe')).toHaveAttribute(
      'data-source-grouping',
      JSON.stringify(sourceGrouping)
    )
  })

  it('leaves the grouping scope empty for the save dialog when not provided', () => {
    render(<MessageActions content="answer" notebookId="nb:1" />)

    fireEvent.click(screen.getByRole('button', { name: /common\.save/ }))

    expect(screen.getByTestId('save-note-probe')).toHaveAttribute('data-source-grouping', '')
  })

  it('opens the save dialog from the tooltip icon variant', () => {
    render(<MessageActions content="answer" notebookId="nb:1" showTextLabel={false} />)

    // 图标按钮无文字，用 tooltip 文案对应的触发器定位（title 按钮组里唯一）
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    expect(screen.getByTestId('save-note-probe')).toHaveAttribute('data-open', 'true')
  })

  it('renders only the copy action when no notebook context exists', () => {
    render(<MessageActions content="answer" showTextLabel={false} />)

    // 无 notebookId：无保存按钮、无弹窗，仅剩复制
    expect(screen.queryByTestId('save-note-probe')).not.toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).not.toBeDisabled()
  })

  it('labels copy state through i18n keys', () => {
    render(<MessageActions content="answer" notebookId="nb:1" />)

    expect(screen.getByText('sources.copy')).toBeInTheDocument()
    expect(screen.queryByText('sources.copied')).not.toBeInTheDocument()
  })
})

describe('MessageActions delete entry (onDelete)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a delete icon button when onDelete is given (icon branch)', () => {
    const onDelete = vi.fn()
    render(<MessageActions content="answer" onDelete={onDelete} />)

    const deleteButton = screen.getByRole('button', {
      name: 'sessions.deleteMessage',
    })
    fireEvent.click(deleteButton)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('renders no delete button when onDelete is absent (icon branch)', () => {
    render(<MessageActions content="answer" />)

    expect(
      screen.queryByRole('button', { name: 'sessions.deleteMessage' })
    ).not.toBeInTheDocument()
    // Save/copy actions are unaffected: same single copy button as before.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
  })

  it('renders a labelled delete button in the text-label branch', () => {
    const onDelete = vi.fn()
    render(
      <MessageActions content="answer" notebookId="nb:1" onDelete={onDelete} />
    )

    fireEvent.click(screen.getByText('sessions.deleteMessage'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

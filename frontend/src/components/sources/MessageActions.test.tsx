import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageActions } from './MessageActions'

// 探针：保存按钮现在只负责开弹窗，提交逻辑在 SaveNoteDialog 内部（自有测试覆盖）
vi.mock('./SaveNoteDialog', () => ({
  SaveNoteDialog: ({
    open,
    content,
    notebookId,
  }: {
    open: boolean
    content: string
    notebookId: string
  }) => (
    <div
      data-testid="save-note-probe"
      data-open={String(open)}
      data-content={content}
      data-notebook={notebookId}
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

    const save = screen.getByRole('button', { name: /common\.saveToNote/ })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)

    const probe = screen.getByTestId('save-note-probe')
    expect(probe).toHaveAttribute('data-open', 'true')
    expect(probe).toHaveAttribute('data-content', 'answer')
    expect(probe).toHaveAttribute('data-notebook', 'nb:1')
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

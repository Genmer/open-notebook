import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SaveNoteDialog } from './SaveNoteDialog'

const { createNoteMock } = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
}))

vi.mock('@/lib/hooks/use-notes', () => ({
  useCreateNote: () => ({ mutateAsync: createNoteMock, isPending: false }),
}))

const nameInput = () => screen.getByTestId('save-note-name-input') as HTMLInputElement
const submitButton = () => screen.getByTestId('save-note-submit')

describe('SaveNoteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createNoteMock.mockResolvedValue({ id: 'note:new' })
  })

  it('derives the default title from the first non-empty markdown-stripped line, capped at 40 chars', () => {
    const content = '\n\n## ' + 'L'.repeat(60) + '\nbody'
    render(
      <SaveNoteDialog open onOpenChange={vi.fn()} content={content} notebookId="nb:1" />
    )

    // 去掉 ## 记号 + 截前 40 字符，跳过开头空行
    expect(nameInput().value).toBe('L'.repeat(40))
  })

  it('strips list markers from the first line', () => {
    // JSX 属性字符串不处理 \n 转义，必须用花括号表达式传真实换行
    render(
      <SaveNoteDialog
        open
        onOpenChange={vi.fn()}
        content={'- Topic summary\nbody'}
        notebookId="nb:1"
      />
    )

    expect(nameInput().value).toBe('Topic summary')
  })

  it('keeps the name editable and submits title, content and notebook binding', async () => {
    const onOpenChange = vi.fn()
    render(
      <SaveNoteDialog open onOpenChange={onOpenChange} content="Answer body" notebookId="nb:1" />
    )

    fireEvent.change(nameInput(), { target: { value: 'My custom name' } })
    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith({
        title: 'My custom name',
        content: 'Answer body',
        note_type: 'ai',
        notebook_id: 'nb:1',
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables submit when the name is blank', () => {
    render(
      <SaveNoteDialog open onOpenChange={vi.fn()} content="Answer body" notebookId="nb:1" />
    )

    fireEvent.change(nameInput(), { target: { value: '' } })
    expect(submitButton()).toBeDisabled()
    expect(createNoteMock).not.toHaveBeenCalled()
  })

  it('re-prefills the name from the current content when reopened', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <SaveNoteDialog open onOpenChange={onOpenChange} content="First answer" notebookId="nb:1" />
    )

    fireEvent.change(nameInput(), { target: { value: 'user typed' } })

    rerender(
      <SaveNoteDialog open={false} onOpenChange={onOpenChange} content="First answer" notebookId="nb:1" />
    )
    rerender(
      <SaveNoteDialog open onOpenChange={onOpenChange} content="## Second answer" notebookId="nb:1" />
    )

    // 不残留上次用户输入，按新内容重新预填
    expect(nameInput().value).toBe('Second answer')
  })
})

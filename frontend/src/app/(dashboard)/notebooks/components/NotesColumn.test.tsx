import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteResponse } from '@/lib/types/api'
import { NotesColumn } from './NotesColumn'

interface MockNoteEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: NoteResponse
}

vi.mock('./NoteEditorDialog', () => ({
  NoteEditorDialog: ({
    open,
    onOpenChange,
    notebookId,
    note,
  }: MockNoteEditorDialogProps) => (
    <div
      data-testid="note-editor-dialog"
      data-open={String(open)}
      data-notebook-id={notebookId}
      data-note-id={note?.id ?? ''}
    >
      <button onClick={() => onOpenChange(false)}>close editor</button>
    </div>
  ),
}))

// ArtifactViewDialog 真组件渲染正文用 MarkdownRenderer，保持轻量
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Radix DropdownMenu 在 jsdom 里 pointerDown+click 也打不开（Select 的先例
// 手法无效）：mock 成常开菜单，直接断言菜单项行为
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: (event: { stopPropagation: () => void }) => void
  }) => (
    <button onClick={(event) => onClick?.(event)}>{children}</button>
  ),
}))

vi.mock('@/lib/hooks/use-notes', () => ({
  useDeleteNote: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/stores/notebook-columns-store', () => ({
  useNotebookColumnsStore: () => ({
    notesCollapsed: false,
    toggleNotes: vi.fn(),
  }),
}))

const notebookId = 'notebook:123'
const existingNote: NoteResponse = {
  id: 'note:456',
  title: 'Existing note',
  content: 'Existing note content',
  note_type: 'human',
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
}

function renderNotes(notes: NoteResponse[]) {
  render(
    <NotesColumn
      notes={notes}
      isLoading={false}
      notebookId={notebookId}
    />
  )
  return screen.getByTestId('note-editor-dialog')
}

describe('NotesColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens, closes, and reopens the editor in create mode with loaded notes', () => {
    const editor = renderNotes([existingNote])

    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-notebook-id', notebookId)
    expect(editor).toHaveAttribute('data-note-id', '')

    fireEvent.click(screen.getByText('close editor'))
    expect(editor).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('common.writeNote'))
    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', '')
  })

  it('opens the editor in create mode when the notes list is empty', () => {
    const editor = renderNotes([])

    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-notebook-id', notebookId)
    expect(editor).toHaveAttribute('data-note-id', '')
  })

  it('clears the selected note before opening the editor in create mode', () => {
    const editor = renderNotes([existingNote])

    fireEvent.click(screen.getByText(existingNote.title!))
    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', existingNote.id)

    fireEvent.click(screen.getByText('close editor'))
    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', '')
  })

  it('jumps from the read-only view to the editor and closes the reader', async () => {
    const editor = renderNotes([existingNote])

    // MoreVertical 菜单被 mock 成常开，直接点「只读查看」菜单项
    fireEvent.click(screen.getByText('artifacts.readOnlyView'))

    // 只读弹窗打开
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()

    // 底部「编辑笔记」→ 编辑器打开（带对 note），阅读弹窗关闭防双弹窗叠开
    fireEvent.click(await screen.findByTestId('artifact-view-edit'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', existingNote.id)
    await waitFor(() => {
      expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
    })
  })
})

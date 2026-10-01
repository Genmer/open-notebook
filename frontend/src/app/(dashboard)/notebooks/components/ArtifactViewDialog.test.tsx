import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ArtifactViewDialog } from './ArtifactViewDialog'
import type { NoteResponse } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Keep the render light: only the markdown child contract matters here.
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// ArtifactSidePanels connects straight to the notebook sources cache.
const { useSourcesMock } = vi.hoisted(() => ({ useSourcesMock: vi.fn() }))
vi.mock('@/lib/hooks/use-sources', () => ({
  useSources: (...args: unknown[]) => useSourcesMock(...args),
}))
useSourcesMock.mockReturnValue({
  data: [
    {
      id: 'source:1',
      title: '需求工程.pdf',
      asset: { file_path: '/data/uploads/需求工程.pdf', url: undefined },
    },
  ],
})

const note = { title: 'Architecture Essay', content: '# Essay body' }

const notesFixture: NoteResponse[] = [
  {
    id: 'note:1',
    title: 'Note One',
    content: 'Body one',
    note_type: 'ai',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-02T00:00:00Z',
  },
  {
    id: 'note:2',
    title: 'Note Two',
    content: 'Body two',
    note_type: 'human',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-03T00:00:00Z',
  },
]

const content = () => document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!

const renderDialog = (onOpenChange = vi.fn(), props: Record<string, unknown> = {}) => {
  render(<ArtifactViewDialog open onOpenChange={onOpenChange} note={note} {...props} />)
  return { onOpenChange, content }
}

describe('ArtifactViewDialog fullscreen', () => {
  it('enters fullscreen on toggle, centering the body in a prose column', () => {
    const { content } = renderDialog()

    expect(content().className).toContain('sm:max-w-2xl')
    expect(content().className).not.toContain('w-screen')
    expect(document.querySelector('.max-w-prose')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    expect(content().className).toContain('sm:max-w-none sm:max-h-none w-screen h-screen border-none rounded-none')
    expect(screen.getByRole('button', { name: 'artifacts.exitFullscreen' })).toBeInTheDocument()

    const body = document.querySelector<HTMLElement>('.max-w-prose')!
    expect(body).not.toBeNull()
    expect(body.className).toContain('mx-auto')
    expect(body).toHaveTextContent('Essay body')
  })

  it('Escape in fullscreen exits fullscreen but keeps the dialog open', () => {
    const { onOpenChange, content } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))
    fireEvent.keyDown(content(), { key: 'Escape' })

    // Radix would dismiss the dialog unless onEscapeKeyDown preventDefaults.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(content().className).toContain('sm:max-w-2xl')
    expect(content().className).not.toContain('w-screen')
    expect(screen.getByRole('button', { name: 'artifacts.enterFullscreen' })).toBeInTheDocument()
  })

  it('Escape outside fullscreen lets Radix close the dialog', () => {
    const { onOpenChange, content } = renderDialog()

    fireEvent.keyDown(content(), { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('ArtifactViewDialog bottom action bar', () => {
  it('renders edit and save-as-source buttons and fires both callbacks', () => {
    const onEdit = vi.fn()
    const onSaveAsSource = vi.fn()
    render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={note}
        onEdit={onEdit}
        onSaveAsSource={onSaveAsSource}
      />
    )

    fireEvent.click(screen.getByTestId('artifact-view-edit'))
    expect(onEdit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('artifact-view-save-as-source'))
    expect(onSaveAsSource).toHaveBeenCalledTimes(1)
  })

  it('labels the buttons through i18n keys', () => {
    render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={note}
        onEdit={vi.fn()}
        onSaveAsSource={vi.fn()}
      />
    )

    expect(screen.getByText('artifacts.editNote')).toBeInTheDocument()
    expect(screen.getByText('notebooks.saveAsSource.action')).toBeInTheDocument()
  })

  it('renders no action bar when no callbacks are provided', () => {
    render(<ArtifactViewDialog open onOpenChange={vi.fn()} note={note} />)

    expect(screen.queryByTestId('artifact-view-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('artifact-view-save-as-source')).not.toBeInTheDocument()
  })

  it('still renders the action bar for an empty note (empty notes need the editor most)', () => {
    render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={{ title: 'Empty', content: null }}
        onEdit={vi.fn()}
      />
    )

    expect(screen.getByTestId('artifact-view-edit')).toBeInTheDocument()
    // 空内容：不渲染正文块，但操作栏仍在
    expect(screen.queryByTestId('artifact-view-save-as-source')).not.toBeInTheDocument()
  })
})

describe('ArtifactViewDialog fullscreen template (grid-rows)', () => {
  it('fullscreen DialogContent uses the 3-row template and swaps overflow classes', () => {
    const { content } = renderDialog()

    // 非全屏：滚动在弹窗层，无行模板
    expect(content().className).toContain('overflow-y-auto')
    expect(content().className).not.toContain('grid-rows-')

    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    expect(content().className).toContain('grid-rows-[auto_minmax(0,1fr)_auto]')
    expect(content().className).toContain('overflow-hidden')
    expect(content().className).not.toContain('overflow-y-auto')
  })

  it('fullscreen wraps only the body in the inner scroll layer; the action bar stays a grid row', () => {
    render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={note}
        onEdit={vi.fn()}
        notebookId="nb:1"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    const scrollLayer = document.querySelector<HTMLElement>('.min-h-0.overflow-y-auto')!
    expect(scrollLayer).not.toBeNull()
    // 滚动层是 DialogContent 的直接子级，且只包正文
    expect(scrollLayer.parentElement).toBe(content())
    expect(scrollLayer).toHaveTextContent('Essay body')
    // 操作栏不在滚动层内——它是流内第三行，全屏常驻可见
    const editButton = screen.getByTestId('artifact-view-edit')
    expect(scrollLayer.contains(editButton)).toBe(false)
    expect(editButton.closest('[data-slot="dialog-content"]')).toBe(content())
  })

  it('keeps the non-fullscreen DOM free of the scroll layer wrapper', () => {
    render(<ArtifactViewDialog open onOpenChange={vi.fn()} note={note} />)

    expect(document.querySelector('.min-h-0.overflow-y-auto')).toBeNull()
  })
})

describe('ArtifactViewDialog fullscreen side panels', () => {
  it('renders no handles or panels without notebookId (props optional, zero breakage)', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    expect(screen.queryByTestId('artifact-handle-left')).not.toBeInTheDocument()
    expect(screen.queryByTestId('artifact-handle-right')).not.toBeInTheDocument()
    expect(screen.queryByTestId('artifact-panel-sources')).not.toBeInTheDocument()
  })

  it('renders both handles in fullscreen only; opening hides its handle and shows the panel', () => {
    renderDialog(vi.fn(), { notebookId: 'nb:1', notes: notesFixture })

    // 非全屏无拉手
    expect(screen.queryByTestId('artifact-handle-left')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    expect(screen.getByTestId('artifact-handle-left')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-handle-right')).toBeInTheDocument()

    // 左拉手 → 来源面板开，拉手隐藏
    fireEvent.click(screen.getByTestId('artifact-handle-left'))
    expect(screen.queryByTestId('artifact-handle-left')).not.toBeInTheDocument()
    const sourcesPanel = screen.getByTestId('artifact-panel-sources')
    expect(sourcesPanel).toBeInTheDocument()
    // 面板 header 含退出全屏按钮
    expect(within(sourcesPanel).getByRole('button', { name: 'artifacts.exitFullscreen' })).toBeInTheDocument()
    // 面板挂为 DialogContent 子级（absolute，不 portal）
    expect(sourcesPanel.closest('[data-slot="dialog-content"]')).toBe(content())

    // 右拉手 → 笔记面板开，两面板同开
    fireEvent.click(screen.getByTestId('artifact-handle-right'))
    expect(screen.getByTestId('artifact-panel-notes')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-panel-sources')).toBeInTheDocument()

    // X 关闭面板，拉手恢复
    fireEvent.click(within(screen.getByTestId('artifact-panel-notes')).getByTestId('artifact-panel-notes-close'))
    expect(screen.queryByTestId('artifact-panel-notes')).not.toBeInTheDocument()
    expect(screen.getByTestId('artifact-handle-right')).toBeInTheDocument()
  })

  it('handle hit zones sit below the X button band (top-12)', () => {
    renderDialog(vi.fn(), { notebookId: 'nb:1' })
    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    expect(screen.getByTestId('artifact-handle-left').className).toContain('top-12')
    expect(screen.getByTestId('artifact-handle-right').className).toContain('top-12')
  })

  it('Escape closes open panels first, then exits fullscreen, then lets Radix close', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <ArtifactViewDialog
        open
        onOpenChange={onOpenChange}
        note={note}
        notebookId="nb:1"
        notes={notesFixture}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))
    fireEvent.click(screen.getByTestId('artifact-handle-right'))
    expect(screen.getByTestId('artifact-panel-notes')).toBeInTheDocument()

    // 第一段 Esc：关面板，保持全屏
    fireEvent.keyDown(content(), { key: 'Escape' })
    expect(screen.queryByTestId('artifact-panel-notes')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: 'artifacts.exitFullscreen' })).toBeInTheDocument()

    // 第二段 Esc：退全屏
    fireEvent.keyDown(content(), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'artifacts.enterFullscreen' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    // 第三段：非全屏 Esc 放行 Radix 关窗
    fireEvent.keyDown(content(), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    void rerender
  })

  it('note clicks call onNoteSelect and highlight the active note', () => {
    const onNoteSelect = vi.fn()
    const { rerender } = render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={note}
        notebookId="nb:1"
        notes={notesFixture}
        onNoteSelect={onNoteSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))
    fireEvent.click(screen.getByTestId('artifact-handle-right'))

    const noteTwo = screen.getByTestId('artifact-panel-note-note:2')
    fireEvent.click(noteTwo)
    expect(onNoteSelect).toHaveBeenCalledWith(notesFixture[1])

    // 切换后 activeNoteId 高亮（主色描边）
    rerender(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={notesFixture[1]}
        notebookId="nb:1"
        notes={notesFixture}
        activeNoteId="note:2"
        onNoteSelect={onNoteSelect}
      />
    )
    expect(screen.getByTestId('artifact-panel-note-note:2').className).toContain('border-primary/50')
    expect(screen.getByTestId('artifact-panel-note-note:1').className).not.toContain('border-primary/50')
  })

  it('source rows call onOpenSource with the source id', () => {
    const onOpenSource = vi.fn()
    renderDialog(vi.fn(), { notebookId: 'nb:1', onOpenSource })
    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))
    fireEvent.click(screen.getByTestId('artifact-handle-left'))

    fireEvent.click(screen.getByTestId('artifact-panel-source-source:1'))
    expect(onOpenSource).toHaveBeenCalledWith('source:1')
  })

  it('remounts the flashcard viewer when switching notes (flip state resets)', () => {
    const flashcards = [{ front: 'Q1', back: 'A1' }]
    const flashNote = { title: 'Deck', content: JSON.stringify(flashcards) }
    const { rerender } = render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={flashNote}
        notebookId="nb:1"
        notes={notesFixture}
        activeNoteId="note:1"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    // 翻面
    fireEvent.click(screen.getByTestId('flashcard-0'))
    expect(screen.getByTestId('flashcard-0')).toHaveTextContent('A1')

    // 切到另一条笔记：key 变化 → FlashcardViewer 重挂 → 翻面态复位
    rerender(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={{ ...flashNote, content: JSON.stringify([{ front: 'Q2', back: 'A2' }]) }}
        notebookId="nb:1"
        notes={notesFixture}
        activeNoteId="note:2"
      />
    )
    expect(screen.getByTestId('flashcard-0')).toHaveTextContent('Q2')
  })
})

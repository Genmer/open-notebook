import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SaveNoteDialog } from './SaveNoteDialog'

// Mock 组合照抄 SaveAsSourceDialog.test.tsx：useCreateSource 在 use-sources 模块；
// sourceViewsApi（moveMembers）在 api/source-views 模块；useSourceViews /
// useViewGroups / useInvalidateGrouping 都在 hooks/use-source-views 模块
// （FolderTargetSection 也从该模块取 hooks，一个工厂全覆盖）。
const { createNoteMock, createSourceMock, moveMembersMock, invalidateMock, toastWarningMock } =
  vi.hoisted(() => ({
    createNoteMock: vi.fn(),
    createSourceMock: vi.fn(),
    moveMembersMock: vi.fn(),
    invalidateMock: vi.fn(),
    toastWarningMock: vi.fn(),
  }))

vi.mock('@/lib/hooks/use-notes', () => ({
  useCreateNote: () => ({ mutateAsync: createNoteMock, isPending: false }),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useCreateSource: () => ({ mutateAsync: createSourceMock, isPending: false }),
}))

vi.mock('@/lib/api/source-views', () => ({
  sourceViewsApi: {
    moveMembers: (...args: unknown[]) => moveMembersMock(...args),
  },
}))

const mockViews = [
  {
    id: 'view:1',
    name: 'My Folders',
    view_type: 'custom',
    is_default: false,
    last_classified_at: null,
    classify_progress: null,
    created: null,
    updated: null,
  },
]

const mockGroups = [
  {
    id: 'group:1',
    view_id: 'view:1',
    name: 'Research',
    parent_id: null,
    source_count: 2,
    created: null,
    updated: null,
  },
]

vi.mock('@/lib/hooks/use-source-views', () => ({
  useSourceViews: () => ({ data: mockViews }),
  useViewGroups: () => ({ data: mockGroups }),
  useInvalidateGrouping: () => invalidateMock,
}))

vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarningMock(...args),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// useTranslation is mocked globally in setup.ts (t returns the key string)

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  TestWrapper.displayName = 'TestWrapper'
  return TestWrapper
}

const notebookId = 'nb:1'

const nameInput = () => screen.getByTestId('save-note-name-input') as HTMLInputElement
const submitButton = () => screen.getByTestId('save-note-submit')
const sourceModeRadio = () => screen.getByTestId('save-mode-source')
const noteModeRadio = () => screen.getByTestId('save-mode-note')

describe('SaveNoteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createNoteMock.mockResolvedValue({ id: 'note:new' })
    createSourceMock.mockResolvedValue({ id: 'source:new' })
    moveMembersMock.mockResolvedValue({ added: 1 })
  })

  it('derives the default title from the first non-empty markdown-stripped line, capped at 40 chars', () => {
    const content = '\n\n## ' + 'L'.repeat(60) + '\nbody'
    render(
      <SaveNoteDialog open onOpenChange={vi.fn()} content={content} notebookId={notebookId} />,
      { wrapper: createWrapper() }
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
        notebookId={notebookId}
      />,
      { wrapper: createWrapper() }
    )

    expect(nameInput().value).toBe('Topic summary')
  })

  it('defaults to source mode with the folder bar and the no-embed hint', () => {
    render(
      <SaveNoteDialog
        open
        onOpenChange={vi.fn()}
        content="Answer body"
        notebookId={notebookId}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />,
      { wrapper: createWrapper() }
    )

    // 默认「存为来源」：折叠态文件夹条显示 sourceGrouping 指定的文件夹（组名 · 视图名）
    const bar = screen.getByTestId('folder-target-bar-label')
    expect(bar).toHaveTextContent('Research')
    expect(bar).toHaveTextContent('My Folders')
    expect(screen.getByText('notebooks.saveAsSource.noEmbedHint')).toBeInTheDocument()
    expect(sourceModeRadio()).toBeChecked()
  })

  it('submits a text source with embed:false + async_processing and files it into the default folder', async () => {
    const onOpenChange = vi.fn()
    render(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="Answer body"
        notebookId={notebookId}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(createSourceMock).toHaveBeenCalledWith({
        type: 'text',
        title: 'Answer body',
        content: 'Answer body',
        notebooks: [notebookId],
        embed: false,
        async_processing: true,
      })
    })
    expect(moveMembersMock).toHaveBeenCalledWith('group:1', ['source:new'])
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createNoteMock).not.toHaveBeenCalled()
  })

  it('skips folder filing when no grouping scope is given', async () => {
    const onOpenChange = vi.fn()
    render(
      <SaveNoteDialog open onOpenChange={onOpenChange} content="Answer body" notebookId={notebookId} />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(createSourceMock).toHaveBeenCalled()
    })
    expect(moveMembersMock).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('only warns and still closes when filing the source fails', async () => {
    moveMembersMock.mockRejectedValueOnce(new Error('boom'))
    const onOpenChange = vi.fn()
    render(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="Answer body"
        notebookId={notebookId}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith('sources.grouping.folderAssignFailed')
    })
    // 来源已创建成功：弹窗照常关闭，不回滚
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createSourceMock).toHaveBeenCalledTimes(1)
  })

  it('switches to note mode, drops the folder section and creates a note instead', async () => {
    const onOpenChange = vi.fn()
    render(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="Answer body"
        notebookId={notebookId}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(noteModeRadio())
    expect(screen.queryByTestId('folder-target-bar')).not.toBeInTheDocument()
    expect(screen.queryByText('notebooks.saveAsSource.noEmbedHint')).not.toBeInTheDocument()

    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith({
        title: 'Answer body',
        content: 'Answer body',
        note_type: 'ai',
        notebook_id: notebookId,
      })
    })
    expect(createSourceMock).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the name editable and submits the custom title in note mode', async () => {
    const onOpenChange = vi.fn()
    render(
      <SaveNoteDialog open onOpenChange={onOpenChange} content="Answer body" notebookId={notebookId} />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(noteModeRadio())
    fireEvent.change(nameInput(), { target: { value: 'My custom name' } })
    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith({
        title: 'My custom name',
        content: 'Answer body',
        note_type: 'ai',
        notebook_id: notebookId,
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('re-prefills the name from the current content and resets to source mode when reopened', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="First answer"
        notebookId={notebookId}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(noteModeRadio())
    expect(screen.queryByTestId('folder-target-bar')).not.toBeInTheDocument()
    fireEvent.change(nameInput(), { target: { value: 'user typed' } })

    rerender(
      <SaveNoteDialog
        open={false}
        onOpenChange={onOpenChange}
        content="First answer"
        notebookId={notebookId}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />
    )
    rerender(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="## Second answer"
        notebookId={notebookId}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />
    )

    // 不残留上次用户输入与模式：名称按新内容重新预填，模式回到默认的存为来源
    expect(nameInput().value).toBe('Second answer')
    expect(screen.getByTestId('folder-target-bar')).toBeInTheDocument()
    expect(sourceModeRadio()).toBeChecked()
  })

  // initialMode 锚点（R3 blocker ①）：组件常驻挂载，模式必须在「打开后的
  // effect」里初始化——useState 初始化器会被每次 open→true 的 setMode 覆盖。
  // 这两条用例拦截 setMode('source') 硬编码回归：断言的是打开后的状态。
  it('honors initialMode="note" after opening (stays note, not overridden to source)', () => {
    render(
      <SaveNoteDialog
        open
        onOpenChange={vi.fn()}
        content="AI analysis markdown"
        notebookId={notebookId}
        initialMode="note"
      />,
      { wrapper: createWrapper() }
    )

    expect(noteModeRadio()).toBeChecked()
    expect(sourceModeRadio()).not.toBeChecked()
    // 笔记模式：无文件夹条、无不嵌入提示
    expect(screen.queryByTestId('folder-target-bar')).not.toBeInTheDocument()
    expect(screen.queryByText('notebooks.saveAsSource.noEmbedHint')).not.toBeInTheDocument()
  })

  it('falls back to source mode when initialMode is omitted', () => {
    render(
      <SaveNoteDialog
        open
        onOpenChange={vi.fn()}
        content="Answer body"
        notebookId={notebookId}
      />,
      { wrapper: createWrapper() }
    )

    expect(sourceModeRadio()).toBeChecked()
    expect(screen.getByTestId('folder-target-bar')).toBeInTheDocument()
  })

  it('re-applies initialMode on each open instead of keeping the last user mode', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="Answer body"
        notebookId={notebookId}
        initialMode="note"
      />,
      { wrapper: createWrapper() }
    )
    expect(noteModeRadio()).toBeChecked()

    // 关闭再以缺省 initialMode 打开 → 回到 source 模式
    rerender(
      <SaveNoteDialog
        open={false}
        onOpenChange={onOpenChange}
        content="Answer body"
        notebookId={notebookId}
        initialMode="note"
      />
    )
    rerender(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="Answer body"
        notebookId={notebookId}
      />
    )
    expect(sourceModeRadio()).toBeChecked()
  })

  it('submits a note directly when opened with initialMode="note"', async () => {
    const onOpenChange = vi.fn()
    render(
      <SaveNoteDialog
        open
        onOpenChange={onOpenChange}
        content="AI analysis markdown"
        notebookId={notebookId}
        initialMode="note"
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith({
        title: 'AI analysis markdown',
        content: 'AI analysis markdown',
        note_type: 'ai',
        notebook_id: notebookId,
      })
    })
    expect(createSourceMock).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  describe('submit disable matrix', () => {
    it('disables submit when the name is blank', () => {
      render(
        <SaveNoteDialog open onOpenChange={vi.fn()} content="Answer body" notebookId={notebookId} />,
        { wrapper: createWrapper() }
      )

      fireEvent.change(nameInput(), { target: { value: '   ' } })
      expect(submitButton()).toBeDisabled()
      expect(createSourceMock).not.toHaveBeenCalled()
      expect(createNoteMock).not.toHaveBeenCalled()
    })

    it('disables submit in source mode when the content is empty, but not in note mode', () => {
      render(
        <SaveNoteDialog
          open
          onOpenChange={vi.fn()}
          content=""
          notebookId={notebookId}
          sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
        />,
        { wrapper: createWrapper() }
      )

      // 先给定名称，隔离出「内容为空」这一条禁用维度
      fireEvent.change(nameInput(), { target: { value: 'My name' } })

      // source 模式：空内容不允许转来源（对齐 SaveAsSourceDialog 守卫）
      expect(submitButton()).toBeDisabled()

      fireEvent.click(noteModeRadio())
      // note 模式：不查内容，维持原行为
      expect(submitButton()).not.toBeDisabled()
    })

    it('disables submit while a note submission is in flight', async () => {
      createNoteMock.mockReturnValueOnce(new Promise(() => {}))
      render(
        <SaveNoteDialog open onOpenChange={vi.fn()} content="Answer body" notebookId={notebookId} />,
        { wrapper: createWrapper() }
      )

      fireEvent.click(noteModeRadio())
      expect(submitButton()).not.toBeDisabled()
      fireEvent.click(submitButton())

      expect(submitButton()).toBeDisabled()
      expect(createNoteMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('Enter submits through the same path as the button', () => {
    it('creates a text source on Enter in source mode', async () => {
      render(
        <SaveNoteDialog
          open
          onOpenChange={vi.fn()}
          content="Answer body"
          notebookId={notebookId}
          sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
        />,
        { wrapper: createWrapper() }
      )

      fireEvent.keyDown(nameInput(), { key: 'Enter' })

      await waitFor(() => {
        expect(createSourceMock).toHaveBeenCalled()
      })
      expect(createNoteMock).not.toHaveBeenCalled()
    })

    it('creates a note on Enter in note mode', async () => {
      render(
        <SaveNoteDialog open onOpenChange={vi.fn()} content="Answer body" notebookId={notebookId} />,
        { wrapper: createWrapper() }
      )

      fireEvent.click(noteModeRadio())
      fireEvent.keyDown(nameInput(), { key: 'Enter' })

      await waitFor(() => {
        expect(createNoteMock).toHaveBeenCalled()
      })
      expect(createSourceMock).not.toHaveBeenCalled()
    })

    it('does not submit on Enter when the name is blank', () => {
      render(
        <SaveNoteDialog open onOpenChange={vi.fn()} content="Answer body" notebookId={notebookId} />,
        { wrapper: createWrapper() }
      )

      fireEvent.change(nameInput(), { target: { value: '' } })
      fireEvent.keyDown(nameInput(), { key: 'Enter' })

      expect(createSourceMock).not.toHaveBeenCalled()
      expect(createNoteMock).not.toHaveBeenCalled()
    })
  })
})

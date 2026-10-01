import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SaveAsSourceDialog } from './SaveAsSourceDialog'
import type { NoteResponse, SourceGroupResponse, SourceViewResponse } from '@/lib/types/api'

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

// Mock 归属按模块真实导出划分（修订8）：useCreateSource 在 use-sources hook 模块；
// sourceViewsApi（moveMembers）在 api/source-views 模块；useSourceViews /
// useViewGroups / useInvalidateGrouping 都在 hooks/use-source-views 模块
// （FolderTargetSection 也从该模块取 hooks，一个工厂全覆盖）。
const { createSourceMock, moveMembersMock, invalidateMock, toastWarningMock } = vi.hoisted(() => ({
  createSourceMock: vi.fn(),
  moveMembersMock: vi.fn(),
  invalidateMock: vi.fn(),
  toastWarningMock: vi.fn(),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useCreateSource: () => ({ mutateAsync: createSourceMock, isPending: false }),
}))

vi.mock('@/lib/api/source-views', () => ({
  sourceViewsApi: {
    moveMembers: (...args: unknown[]) => moveMembersMock(...args),
  },
}))

const mockViews: SourceViewResponse[] = [
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

const mockGroups: SourceGroupResponse[] = [
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

const notebookId = 'notebook:1'

const makeNote = (overrides: Partial<NoteResponse> = {}): NoteResponse => ({
  id: 'note:1',
  title: 'Guide',
  content: 'Full note text',
  note_type: 'ai',
  created: '2026-09-01T00:00:00Z',
  updated: '2026-09-02T00:00:00Z',
  ...overrides,
})

const nameInput = () =>
  screen.getByTestId('save-as-source-name-input') as HTMLInputElement
const submitButton = () => screen.getByTestId('save-as-source-submit')

describe('SaveAsSourceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createSourceMock.mockResolvedValue({ id: 'source:new' })
    moveMembersMock.mockResolvedValue({ added: 1 })
  })

  it('renders nothing when no note is provided', () => {
    const { container } = render(
      <SaveAsSourceDialog open onOpenChange={vi.fn()} notebookId={notebookId} />,
      { wrapper: createWrapper() }
    )
    expect(container.innerHTML).toBe('')
  })

  it('creates a text source without embeddings and skips folder filing by default', async () => {
    const onOpenChange = vi.fn()
    render(
      <SaveAsSourceDialog
        open
        onOpenChange={onOpenChange}
        notebookId={notebookId}
        note={makeNote()}
      />,
      { wrapper: createWrapper() }
    )

    // 名称预填笔记标题
    expect(nameInput().value).toBe('Guide')

    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(createSourceMock).toHaveBeenCalledWith({
        type: 'text',
        title: 'Guide',
        content: 'Full note text',
        notebooks: [notebookId],
        embed: false,
        async_processing: true,
      })
    })
    // 未选文件夹：不归档、不失效分组缓存，但仍刷新 Gemini 左列的 contextTree
    expect(moveMembersMock).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('prefills the folder from sourceGrouping and files the created source into it', async () => {
    render(
      <SaveAsSourceDialog
        open
        onOpenChange={vi.fn()}
        notebookId={notebookId}
        note={makeNote()}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />,
      { wrapper: createWrapper() }
    )

    // 折叠态文件夹条显示当前语境（组名 · 视图名）
    const bar = await screen.findByTestId('folder-target-bar-label')
    expect(bar).toHaveTextContent('Research')
    expect(bar).toHaveTextContent('My Folders')

    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(moveMembersMock).toHaveBeenCalledWith('group:1', ['source:new'])
    })
    expect(invalidateMock).toHaveBeenCalled()
  })

  it('keeps the created source and only warns when folder filing fails', async () => {
    moveMembersMock.mockRejectedValueOnce(new Error('boom'))
    const onOpenChange = vi.fn()
    render(
      <SaveAsSourceDialog
        open
        onOpenChange={onOpenChange}
        notebookId={notebookId}
        note={makeNote()}
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
    expect(createSourceMock).toHaveBeenCalled()
  })

  it('disables submit when the name is blank', () => {
    render(
      <SaveAsSourceDialog
        open
        onOpenChange={vi.fn()}
        notebookId={notebookId}
        note={makeNote()}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.change(nameInput(), { target: { value: '   ' } })
    expect(submitButton()).toBeDisabled()
  })

  it('disables submit when the note has no content to convert', () => {
    render(
      <SaveAsSourceDialog
        open
        onOpenChange={vi.fn()}
        notebookId={notebookId}
        note={makeNote({ content: null })}
      />,
      { wrapper: createWrapper() }
    )

    expect(submitButton()).toBeDisabled()
  })

  it('falls back to a 40-char content excerpt when the note has no title', () => {
    render(
      <SaveAsSourceDialog
        open
        onOpenChange={vi.fn()}
        notebookId={notebookId}
        note={makeNote({ title: null, content: 'A'.repeat(80) })}
      />,
      { wrapper: createWrapper() }
    )

    expect(nameInput().value).toBe('A'.repeat(40))
  })

  it('re-prefills name and folder when reopened with a different note', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <SaveAsSourceDialog
        open
        onOpenChange={onOpenChange}
        notebookId={notebookId}
        note={makeNote()}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />,
      { wrapper: createWrapper() }
    )

    expect(await screen.findByTestId('folder-target-bar-label')).toHaveTextContent('Research')

    // 关闭后换一条无分组语境的笔记重新打开：不留上次残留
    rerender(
      <SaveAsSourceDialog
        open={false}
        onOpenChange={onOpenChange}
        notebookId={notebookId}
        note={makeNote()}
        sourceGrouping={{ viewId: 'view:1', group: 'group:1' }}
      />
    )
    rerender(
      <SaveAsSourceDialog
        open
        onOpenChange={onOpenChange}
        notebookId={notebookId}
        note={makeNote({ id: 'note:2', title: 'Other note' })}
      />
    )

    expect(nameInput().value).toBe('Other note')
    const bar = await screen.findByTestId('folder-target-bar-label')
    expect(bar).toHaveTextContent('sources.grouping.noFolderOption')
  })

  it('ignores virtual grouping values when deriving the default folder', () => {
    render(
      <SaveAsSourceDialog
        open
        onOpenChange={vi.fn()}
        notebookId={notebookId}
        note={makeNote()}
        sourceGrouping={{ viewId: 'view:1', group: 'all' }}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent(
      'sources.grouping.noFolderOption'
    )
  })
})

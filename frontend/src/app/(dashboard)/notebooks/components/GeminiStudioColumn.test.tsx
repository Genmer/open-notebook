import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeminiStudioColumn } from './GeminiStudioColumn'
import type { NoteResponse } from '@/lib/types/api'

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

const { mockGenerateArtifact, mockGetJobStatus, mockToastSuccess, mockToastError, routerPushMock } =
  vi.hoisted(() => ({
    mockGenerateArtifact: vi.fn(),
    mockGetJobStatus: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
    routerPushMock: vi.fn(),
  }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: vi.fn(() => ''),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/lib/api/notebooks', () => ({
  notebooksApi: {
    generateArtifact: (...args: unknown[]) => mockGenerateArtifact(...args),
  },
}))

vi.mock('@/lib/api/artifacts', () => ({
  artifactsApi: {
    getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
  },
}))

vi.mock('@/lib/hooks/use-notes', () => ({
  useDeleteNote: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateNote: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'note:new' }) }),
}))

vi.mock('@/components/podcasts/GeneratePodcastDialog', () => ({
  GeneratePodcastDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="generate-podcast-dialog" /> : null,
}))

vi.mock('./NoteEditorDialog', () => ({
  NoteEditorDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="note-editor-dialog" /> : null,
}))

// 存为来源弹窗探针：卡片按钮只负责开弹窗，提交逻辑在弹窗自有测试覆盖
vi.mock('./SaveAsSourceDialog', () => ({
  SaveAsSourceDialog: ({
    open,
    notebookId,
    note,
    sourceGrouping,
  }: {
    open: boolean
    notebookId: string
    note?: { id: string; title: string | null }
    sourceGrouping?: { viewId?: string; group?: string }
  }) => (
    <div
      data-testid="save-as-source-probe"
      data-open={String(open)}
      data-notebook={notebookId}
      data-note-id={note?.id ?? ''}
      data-grouping={sourceGrouping ? `${sourceGrouping.viewId ?? ''}:${sourceGrouping.group ?? ''}` : 'none'}
    />
  ),
}))

// ArtifactViewDialog renders note bodies through MarkdownRenderer; keep the
// test light by asserting on the raw content contract instead.
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockNotes: NoteResponse[] = [
  {
    id: 'note:1',
    title: '系统架构演进总结',
    content: '本文系统分析了分布式架构、微服务治理与高可用设计的核心要点。',
    note_type: 'human',
    created: '2026-09-01T00:00:00Z',
    updated: '2026-09-02T00:00:00Z',
  },
  {
    id: 'note:2',
    title: 'Study Guide - 核心概念复习',
    content: '整理好的关于核心术语和自测问答的 AI 总结笔记。',
    note_type: 'ai',
    created: '2026-09-02T00:00:00Z',
    updated: '2026-09-03T00:00:00Z',
  },
]

describe('GeminiStudioColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateArtifact.mockResolvedValue({ job_id: 'job:123' })
    mockGetJobStatus.mockResolvedValue({ status: 'completed' })
  })

  it('renders studio tools and notes matrix', () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    // 检查 Studio 工具箱卡片
    expect(screen.getByText('Audio Overview')).toBeInTheDocument()
    expect(screen.getByText('Study Guide')).toBeInTheDocument()
    expect(screen.getByText('Briefing Doc')).toBeInTheDocument()
    expect(screen.getByText('FAQ 问答集')).toBeInTheDocument()
    expect(screen.getByText('Flashcards')).toBeInTheDocument()

    // 检查笔记列表
    expect(screen.getByText('系统架构演进总结')).toBeInTheDocument()
    expect(screen.getByText('Study Guide - 核心概念复习')).toBeInTheDocument()
  })

  it('opens podcast dialog when clicking Audio Overview', () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(screen.getByText('Audio Overview'))
    expect(screen.getByTestId('generate-podcast-dialog')).toBeInTheDocument()
  })

  it('opens tool dialog and submits artifact generation for Study Guide', async () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    // 点击 Study Guide 打开工具生成弹窗
    fireEvent.click(screen.getByText('Study Guide'))

    // 弹窗出现
    expect(screen.getByText('立即生成并存为笔记')).toBeInTheDocument()

    // 点击立即生成
    fireEvent.click(screen.getByText('立即生成并存为笔记'))

    // 验证调用了真实的工件生成提交
    await waitFor(() => {
      expect(mockGenerateArtifact).toHaveBeenCalledWith(
        'nb:test',
        expect.objectContaining({
          artifact_type: 'study_guide',
        })
      )
    })
  })

  it('opens note full content dialog when clicking a note card', () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(screen.getByText('系统架构演进总结'))
    expect(screen.getAllByText(/本文系统分析了分布式架构/).length).toBeGreaterThanOrEqual(2)
  })

  it('switches to a progress detail view after submitting a generation job', async () => {
    mockGenerateArtifact.mockResolvedValueOnce({
      job_id: 'command:job1',
      status: 'submitted',
      artifact_type: 'study_guide',
      message: 'ok',
    })
    // 任务仍在执行：不给终态，让进度视图停留在运行中
    mockGetJobStatus.mockResolvedValue({ job_id: 'command:job1', status: 'running' })

    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(screen.getByText('Study Guide'))
    fireEvent.click(screen.getByText('立即生成并存为笔记'))

    // 提交后不再是转圈等待，而是进度详情视图
    await waitFor(() => {
      expect(screen.getByText(/生成进度/)).toBeInTheDocument()
    })
    expect(screen.getByText('tasks.inspector.running')).toBeInTheDocument()
    expect(screen.getByText('tasks.inspector.elapsed')).toBeInTheDocument()
    expect(screen.getByText(/tasks.inspector.taskId/)).toBeInTheDocument()
    // 进度管理入口
    expect(screen.getByRole('button', { name: /打开进度管理/ })).toBeInTheDocument()
    // 后台运行按钮存在（可关闭弹窗任务继续）
    expect(screen.getByRole('button', { name: /后台运行/ })).toBeInTheDocument()
  })

  it('navigates to the task center from the progress view entry', async () => {
    mockGenerateArtifact.mockResolvedValueOnce({
      job_id: 'command:job1',
      status: 'submitted',
      artifact_type: 'study_guide',
      message: 'ok',
    })
    mockGetJobStatus.mockResolvedValue({ job_id: 'command:job1', status: 'running' })

    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(screen.getByText('Study Guide'))
    fireEvent.click(screen.getByText('立即生成并存为笔记'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /打开进度管理/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /打开进度管理/ }))
    expect(routerPushMock).toHaveBeenCalledWith('/tasks')
  })

  it('shows a persistent progress-management entry in the toolbox header', () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    fireEvent.click(screen.getByTitle(/打开进度管理/))
    expect(routerPushMock).toHaveBeenCalledWith('/tasks')
  })

  it('opens the read-only artifact view with note content when clicking a note card', () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    // 点击笔记卡片 → 只读弹窗展示标题与正文（列表接口必须带回 content）
    fireEvent.click(screen.getByText('Study Guide - 核心概念复习'))

    const dialogContent = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!
    expect(dialogContent).not.toBeNull()
    expect(dialogContent).toHaveTextContent('Study Guide - 核心概念复习')
    expect(dialogContent).toHaveTextContent('整理好的关于核心术语和自测问答的 AI 总结笔记。')
  })

  it('opens the save-as-source dialog from the card hover action', () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
        sourceGrouping={{ viewId: 'view:1', group: 'group:9' }}
      />,
      { wrapper: createWrapper() }
    )

    const probe = screen.getByTestId('save-as-source-probe')
    expect(probe).toHaveAttribute('data-open', 'false')

    // 两张卡片各有一个存为来源按钮，取第一张（note:1）
    fireEvent.click(screen.getAllByTitle('notebooks.saveAsSource.action')[0])

    expect(probe).toHaveAttribute('data-open', 'true')
    expect(probe).toHaveAttribute('data-notebook', 'nb:test')
    expect(probe).toHaveAttribute('data-note-id', 'note:1')
    expect(probe).toHaveAttribute('data-grouping', 'view:1:group:9')
  })

  it('hands the note from the read-only view over to the editor via the edit action', () => {
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    // 打开只读弹窗 → 点「编辑笔记」：阅读弹窗关闭、编辑器打开
    fireEvent.click(screen.getByText('Study Guide - 核心概念复习'))
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()

    fireEvent.click(screen.getByTestId('artifact-view-edit'))

    expect(screen.getByTestId('note-editor-dialog')).toBeInTheDocument()
    // 防叠开的核心目的：阅读弹窗必须已关闭
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })

  it('marks the notes ScrollArea with the notebook-studio-scroll override class', () => {
    const { container } = render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={mockNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    // 定向 CSS 修复（globals.css .notebook-studio-scroll）挂在 ScrollArea 根上
    const scrollArea = container.querySelector('[data-slot="scroll-area"]')
    expect(scrollArea).not.toBeNull()
    expect(scrollArea!.className).toContain('notebook-studio-scroll')
  })

  it('keeps the three hover action buttons of every note card in the DOM', () => {
    const threeNotes = [
      ...mockNotes,
      {
        id: 'note:3',
        title: '多模型对话备忘',
        content: '与多模型协作的要点记录，第三张卡片用于悬停按钮回归。',
        note_type: 'human' as const,
        created: '2026-09-03T00:00:00Z',
        updated: '2026-09-04T00:00:00Z',
      },
    ]
    render(
      <GeminiStudioColumn
        notebookId="nb:test"
        notes={threeNotes}
        isLoading={false}
        sources={[]}
      />,
      { wrapper: createWrapper() }
    )

    // 每张卡片右上角悬停组：编辑 / 存为来源 / 删除 三个按钮必须存在
    const saveButtons = screen.getAllByTitle('notebooks.saveAsSource.action')
    expect(saveButtons).toHaveLength(3)
    saveButtons.forEach((button) => {
      expect(button).toHaveAttribute('aria-label', 'notebooks.saveAsSource.action')
      const card = button.closest('.group')
      expect(card).not.toBeNull()
      // 悬停组内恰好三个 ghost 小按钮（编辑 / 存为来源 / 删除）
      expect(card!.querySelectorAll('button')).toHaveLength(3)
    })
  })
})

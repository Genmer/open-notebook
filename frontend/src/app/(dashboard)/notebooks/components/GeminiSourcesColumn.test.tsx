import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeminiSourcesColumn } from './GeminiSourcesColumn'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import type { SourceListResponse } from '@/lib/types/api'
import type { ContextTreeResponse } from '@/lib/types/notebook-context'

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

const {
  mockToastSuccess,
  mockToastError,
  mockUseSourceViews,
  mockUseViewGroups,
} = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockUseSourceViews: vi.fn(),
  mockUseViewGroups: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/lib/hooks/use-context-tree')

vi.mock('@/lib/hooks/use-source-views', () => ({
  useCreateGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'group:new' }) }),
  useSourceViews: () => mockUseSourceViews(),
  useViewGroups: (viewId?: string | null) => mockUseViewGroups(viewId),
  useMoveToGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ moved: 1 }) }),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useDeleteSource: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useRemoveSourceFromNotebook: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useUpdateSource: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useRetrySource: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}))

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: () => ({ openModal: vi.fn(), closeModal: vi.fn() }),
}))

vi.mock('@/components/sources/RenameSourceDialog', () => ({
  RenameSourceDialog: () => null,
}))

vi.mock('@/components/sources/GroupPickerDialog', () => ({
  GroupPickerDialog: () => null,
}))

vi.mock('@/components/common/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('@/components/sources/AddSourceDialog', () => ({
  AddSourceDialog: () => <div data-testid="add-source-dialog" />,
}))

vi.mock('@/components/sources/AddExistingSourceDialog', () => ({
  AddExistingSourceDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-existing-source-dialog" /> : null,
}))

vi.mock('@/components/sources/GroupNameDialog', () => ({
  GroupNameDialog: () => <div data-testid="group-name-dialog" />,
}))

const mockSources: SourceListResponse[] = [
  {
    id: 'source:1',
    title: '系统架构设计.pdf',
    embedded: true,
    embedded_chunks: 5,
    insights_count: 2,
    created: '2026-09-01T00:00:00Z',
    updated: '2026-09-02T00:00:00Z',
    asset: { file_path: '/path/to/架构.pdf' },
  },
  {
    id: 'source:2',
    title: 'SurrealDB 官方白皮书',
    embedded: true,
    embedded_chunks: 3,
    insights_count: 1,
    created: '2026-09-01T00:00:00Z',
    updated: '2026-09-02T00:00:00Z',
    asset: { url: 'https://surrealdb.com' },
  },
]

// 模拟全库总计 20 篇文献：2 篇已关联本笔记本，18 篇待关联未关联文献（如论文、红宝书等）
const mockLibrarySources: SourceListResponse[] = [
  ...mockSources,
  ...Array.from({ length: 18 }, (_, i) => ({
    id: `source:extra:${i + 1}`,
    title: `全库文献 ${i + 1}`,
    embedded: true,
    embedded_chunks: 1,
    insights_count: 0,
    created: '2026-09-01T00:00:00Z',
    updated: '2026-09-02T00:00:00Z',
    asset: null,
  })),
]

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    list: vi.fn().mockImplementation(() => Promise.resolve(mockLibrarySources)),
    create: vi.fn(),
  },
}))

const mockTreeData: ContextTreeResponse = {
  groups: [
    { id: 'group:1', name: '核心架构文档', parent_id: null },
  ],
  sources: [
    { id: 'source:1', title: '系统架构设计.pdf', insights_count: 2 },
    { id: 'source:2', title: 'SurrealDB 官方白皮书', insights_count: 1 },
  ],
  memberships: [
    { source_id: 'source:1', group_id: 'group:1' },
    // source:2 属于未归档
  ],
}

describe('GeminiSourcesColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSourceViews.mockReturnValue({ data: [] })
    mockUseViewGroups.mockReturnValue({ data: [] })
    vi.mocked(useContextTree).mockReturnValue({
      data: mockTreeData,
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useContextTree>)
  })

  it('renders sources hierarchically by folders and ungrouped section', () => {
    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{ 'source:1': 'full', 'source:2': 'off' }}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 检查文件夹名称
    expect(screen.getByText('核心架构文档')).toBeInTheDocument()
    // 检查文件夹下的来源
    expect(screen.getByText('系统架构设计.pdf')).toBeInTheDocument()
    // 检查未归档资源
    expect(screen.getByText(/未归档资源/)).toBeInTheDocument()
    expect(screen.getByText('SurrealDB 官方白皮书')).toBeInTheDocument()
  })

  it('toggles folder collapse when clicking folder header', () => {
    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{ 'source:1': 'full', 'source:2': 'full' }}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 初始状态是展开的
    expect(screen.getByText('系统架构设计.pdf')).toBeInTheDocument()

    // 点击文件夹标题折叠
    fireEvent.click(screen.getByText('核心架构文档'))

    // 折叠后该来源在 DOM 中隐藏
    expect(screen.queryByText('系统架构设计.pdf')).not.toBeInTheDocument()
  })

  it('handles batch folder selection checkbox click', () => {
    const handleContextModeChange = vi.fn()
    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{ 'source:1': 'off', 'source:2': 'off' }}
        onContextModeChange={handleContextModeChange}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 点击文件夹行复选框批量勾选当前文件夹下的所有来源
    const folderLabel = screen.getByText('核心架构文档')
    const folderCheckbox = folderLabel.parentElement?.querySelector('button[role="checkbox"]')
    expect(folderCheckbox).toBeInTheDocument()
    if (folderCheckbox) {
      fireEvent.click(folderCheckbox)
      expect(handleContextModeChange).toHaveBeenCalledWith('source:1', 'full')
    }
  })

  it('switches to Web Research tab and allows research input', () => {
    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{}}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 切换到 Web Research Tab (Radix TabsTrigger activates on mousedown)
    const webTab = screen.getByRole('tab', { name: /网络导源/ })
    fireEvent.mouseDown(webTab)

    expect(screen.getByText(/智能网络导源/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/输入探索关键词或课题/)).toBeInTheDocument()
  })

  it('renders Add Existing button in header and opens AddExistingSourceDialog on click', () => {
    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{}}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 顶部操作栏应有【从已有添加】按钮
    const addExistingBtn = screen.getByRole('button', { name: /从已有添加/ })
    expect(addExistingBtn).toBeInTheDocument()

    // 初始状态下弹窗未打开
    expect(screen.queryByTestId('add-existing-source-dialog')).not.toBeInTheDocument()

    // 点击后唤起 AddExistingSourceDialog
    fireEvent.click(addExistingBtn)
    expect(screen.getByTestId('add-existing-source-dialog')).toBeInTheDocument()
  })

  it('renders Knowledge Base Global Overview at bottom with 18 unlinked documents and triggers AddExistingSourceDialog', async () => {
    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{}}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 左侧底部应显示【知识库全局资源概览】
    expect(screen.getByText('知识库全局资源概览')).toBeInTheDocument()

    // 验证异步获取计算后的指标：全库 20 篇，已关联 2 篇，待引入 18 篇文献
    expect(await screen.findByText('全库 20 篇')).toBeInTheDocument()
    expect(screen.getByText('本笔记本已关联')).toBeInTheDocument()
    expect(screen.getByText('2 篇')).toBeInTheDocument()
    expect(screen.getByText('待引入文献')).toBeInTheDocument()
    expect(screen.getByText('18 篇')).toBeInTheDocument()

    // 快捷按钮【一键引入全库文献 (18)】存在且点击唤起 AddExistingSourceDialog
    const quickImportBtn = screen.getByRole('button', { name: /一键引入全库文献/ })
    expect(quickImportBtn).toBeInTheDocument()
    expect(quickImportBtn).toHaveTextContent('一键引入全库文献 (18)')

    fireEvent.click(quickImportBtn)
    expect(screen.getByTestId('add-existing-source-dialog')).toBeInTheDocument()
  })

  it('synchronizes resolved default view to parent sourceGrouping on mount', () => {
    const handleGroupingChange = vi.fn()
    mockUseSourceViews.mockReturnValue({
      data: [
        { id: 'view:default', name: '默认视图', is_default: true, view_type: 'default' },
        { id: 'view:custom', name: '自定义分类', is_default: false, view_type: 'custom' },
      ],
    })

    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{}}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
        grouping={{}}
        onGroupingChange={handleGroupingChange}
      />,
      { wrapper: createWrapper() }
    )

    // 自定义分类优先 (custom > is_default > views[0])
    expect(handleGroupingChange).toHaveBeenCalledWith({
      viewId: 'view:custom',
      group: 'all',
    })
  })

  it('displays empty notice, total sources count, and triggers AddExistingSourceDialog for empty folder', () => {
    const emptyTreeData: ContextTreeResponse = {
      groups: [
        { id: 'group:empty', name: '项目资料库', parent_id: null },
      ],
      sources: [],
      memberships: [],
    }
    vi.mocked(useContextTree).mockReturnValue({
      data: emptyTreeData,
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useContextTree>)
    mockUseViewGroups.mockReturnValue({
      data: [
        {
          id: 'group:empty',
          view_id: 'view:1',
          name: '项目资料库',
          parent_id: null,
          source_count: 8,
          created: null,
          updated: null,
        },
      ],
    })

    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={[]}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{}}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 默认空文件夹是折叠的，点击展开它
    const folderHeader = screen.getByText('项目资料库')
    fireEvent.click(folderHeader)

    // 展开后应显示：空提示 + 该文件夹总来源数: 8 + 从已有添加 按钮
    expect(screen.getByText('该文件夹在当前笔记本中暂无资源')).toBeInTheDocument()
    expect(screen.getByText('该文件夹总来源数: 8')).toBeInTheDocument()
    const addFromExistingButtons = screen.getAllByRole('button', { name: /从已有添加/ })
    const folderAddExistingBtn = addFromExistingButtons[addFromExistingButtons.length - 1]
    expect(folderAddExistingBtn).toBeInTheDocument()

    // 点击【从已有添加】打开弹窗
    fireEvent.click(folderAddExistingBtn)
    expect(screen.getByTestId('add-existing-source-dialog')).toBeInTheDocument()
  })

  it('forces folders with sources to default to expanded', () => {
    render(
      <GeminiSourcesColumn
        notebookId="nb:test"
        sources={mockSources}
        isLoading={false}
        onRefresh={vi.fn()}
        contextSelections={{ 'source:1': 'full' }}
        onContextModeChange={vi.fn()}
        onBulkContextModeChange={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    // 包含 source:1 的文件夹默认强制展开，来源直接可见
    expect(screen.getByText('系统架构设计.pdf')).toBeVisible()
    expect(screen.getByText('核心架构文档')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeminiSourcesColumn } from './GeminiSourcesColumn'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import type { SourceListResponse } from '@/lib/types/api'
import type { ContextTreeResponse } from '@/lib/types/notebook-context'

// 本文件覆盖 setup.ts 的全局 t() mock：键回显之外把插值参数追加为可断言文本
// （sources.overview.totalBadge (count=20)），让透视区计数也能回归。
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key
      const args = Object.entries(params)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ')
      return `${key} (${args})`
    },
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
}))

const createWrapper = (client?: QueryClient) => {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  TestWrapper.displayName = 'TestWrapper'
  return { TestWrapper, queryClient }
}

const {
  mockToastSuccess,
  mockToastError,
  mockUseSourceViews,
  mockUseViewGroups,
  mockOpenModal,
  mockCopyMutateAsync,
  mockUngroupMutateAsync,
  mockRefetchTree,
} = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockUseSourceViews: vi.fn(),
  mockUseViewGroups: vi.fn(),
  mockOpenModal: vi.fn(),
  mockCopyMutateAsync: vi.fn(),
  mockUngroupMutateAsync: vi.fn(),
  mockRefetchTree: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/lib/hooks/use-context-tree')

vi.mock('@/lib/hooks/use-source-views', () => ({
  useCreateGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'group:new' }) }),
  useSourceViews: () => mockUseSourceViews(),
  useViewGroups: (viewId?: string | null) => mockUseViewGroups(viewId),
  useMoveToGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({ moved: 1 }) }),
  useCopyToGroup: () => ({ mutateAsync: (...args: unknown[]) => mockCopyMutateAsync(...args) }),
  useUngroupMembers: () => ({
    mutateAsync: (...args: unknown[]) => mockUngroupMutateAsync(...args),
  }),
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
  useModalManager: () => ({
    openModal: (...args: unknown[]) => mockOpenModal(...args),
    closeModal: vi.fn(),
    notebookId: undefined,
  }),
}))

vi.mock('@/components/sources/RenameSourceDialog', () => ({
  RenameSourceDialog: () => null,
}))

vi.mock('@/components/sources/GroupPickerDialog', () => ({
  GroupPickerDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onConfirm: (groupId: string | null) => void
  }) =>
    open ? (
      <button
        data-testid="group-picker-mock"
        onClick={() => onConfirm('group:1')}
      />
    ) : null,
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
  GroupNameDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="group-name-dialog" /> : null,
}))

vi.mock('@/components/sources/EmbedMissingPanel', () => ({
  EmbedMissingPanel: ({ variant }: { variant?: string }) => (
    <div data-testid={`embed-missing-panel-${variant ?? 'default'}`} />
  ),
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
    {
      id: 'source:1',
      title: '系统架构设计.pdf',
      insights_count: 2,
      embedded: true,
      embedding_status: null,
    },
    {
      id: 'source:2',
      title: 'SurrealDB 官方白皮书',
      insights_count: 1,
      embedded: true,
      embedding_status: null,
    },
  ],
  memberships: [
    { source_id: 'source:1', group_id: 'group:1' },
    // source:2 属于未归档
  ],
}

const baseProps = {
  notebookId: 'nb:test',
  sources: mockSources,
  isLoading: false,
  onRefresh: vi.fn(),
  contextSelections: {},
  onContextModeChange: vi.fn(),
  onBulkContextModeChange: vi.fn(),
}

const rowOf = (title: string) => {
  const row = screen.getByText(title).closest('.group')
  expect(row).not.toBeNull()
  return row as HTMLElement
}

describe('GeminiSourcesColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSourceViews.mockReturnValue({ data: [] })
    mockUseViewGroups.mockReturnValue({ data: [] })
    mockCopyMutateAsync.mockResolvedValue({ created: ['source:1-copy'], failed: [] })
    mockUngroupMutateAsync.mockResolvedValue({ ungrouped: 1 })
    vi.mocked(useContextTree).mockReturnValue({
      data: mockTreeData,
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)
  })

  it('renders sources hierarchically by folders and ungrouped section', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    // 检查文件夹名称
    expect(screen.getByText('核心架构文档')).toBeInTheDocument()
    // 检查文件夹下的来源
    expect(screen.getByText('系统架构设计.pdf')).toBeInTheDocument()
    // 检查未归档资源
    expect(screen.getByText(/geminiSources.ungrouped/)).toBeInTheDocument()
    expect(screen.getByText('SurrealDB 官方白皮书')).toBeInTheDocument()
  })

  it('opens the source detail modal when clicking the row or its title', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    // 点标题冒泡到行 → 详情弹窗供数（含 notebookId，供 AI 解析保存链路）
    fireEvent.click(screen.getByText('系统架构设计.pdf'))
    expect(mockOpenModal).toHaveBeenCalledWith('source', 'source:1', {
      notebookId: 'nb:test',
    })

    // 直接点行同样打开详情
    fireEvent.click(rowOf('SurrealDB 官方白皮书'))
    expect(mockOpenModal).toHaveBeenCalledWith('source', 'source:2', {
      notebookId: 'nb:test',
    })
  })

  it('opens the detail modal from the hover eye button', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    const row = rowOf('系统架构设计.pdf')
    const eye = within(row).getByRole('button', { name: 'sources.details' })
    fireEvent.click(eye)
    expect(mockOpenModal).toHaveBeenCalledTimes(1)
    expect(mockOpenModal).toHaveBeenCalledWith('source', 'source:1', {
      notebookId: 'nb:test',
    })
  })

  it('keeps the checkbox the only toggle entry and does not open the modal', () => {
    const handleContextModeChange = vi.fn()
    render(
      <GeminiSourcesColumn
        {...baseProps}
        contextSelections={{ 'source:1': 'full' }}
        onContextModeChange={handleContextModeChange}
      />,
      { wrapper: createWrapper().TestWrapper }
    )

    const checkbox = screen.getByRole('checkbox', { name: '系统架构设计.pdf' })
    expect(checkbox).toHaveAttribute('aria-label', '系统架构设计.pdf')

    fireEvent.click(checkbox)
    expect(handleContextModeChange).toHaveBeenCalledWith('source:1', 'off')
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('marks the row clickable and keeps the truncation tooltip on the title span', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    const row = rowOf('系统架构设计.pdf')
    expect(row.className).toContain('cursor-pointer')

    const titleSpan = screen.getByText('系统架构设计.pdf')
    expect(titleSpan.tagName).toBe('SPAN')
    expect(titleSpan).toHaveAttribute('title', '系统架构设计.pdf')
  })

  it('reveals the eye button on hover and keyboard focus', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    const eye = within(rowOf('系统架构设计.pdf')).getByRole('button', {
      name: 'sources.details',
    })
    expect(eye.className).toContain('opacity-0')
    expect(eye.className).toContain('group-hover:opacity-100')
    expect(eye.className).toContain('focus-visible:opacity-100')
    expect(eye.className).toContain('group-focus-within:opacity-100')
  })

  it('renders the embed-state dots in three states with aria labels', () => {
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        groups: [],
        sources: [
          {
            id: 'tree:failed',
            title: '嵌入失败文档',
            insights_count: 0,
            embedded: true,
            embedding_status: 'failed',
          },
          {
            id: 'tree:unembedded',
            title: '未嵌入文档',
            insights_count: 0,
            embedded: false,
            embedding_status: null,
          },
        ],
        memberships: [],
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })

    // failed → 红
    const failedDot = screen.getByRole('img', { name: 'sources.embedStateDot.failed' })
    expect(failedDot).toHaveClass('bg-destructive')
    // embedded:false 且非 failed → 琥珀（treeData 合并来源同语义）
    const unembeddedDot = screen.getByRole('img', { name: 'sources.embedStateDot.unembedded' })
    expect(unembeddedDot).toHaveClass('bg-amber-500')
  })

  it('renders no dot for fully embedded sources', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    expect(
      screen.queryByRole('img', { name: 'sources.embedStateDot.failed' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'sources.embedStateDot.unembedded' })
    ).not.toBeInTheDocument()
  })

  it('context menu: grouped row offers ungroup and fires it with view + invalidations', async () => {
    mockUseSourceViews.mockReturnValue({
      data: [{ id: 'view:1', name: '默认视图', is_default: true, view_type: 'default' }],
    })
    const onRefresh = vi.fn()
    const { queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(<GeminiSourcesColumn {...baseProps} onRefresh={onRefresh} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    fireEvent.click(screen.getByText('sources.grouping.ungroupAction'))

    await waitFor(() =>
      expect(mockUngroupMutateAsync).toHaveBeenCalledWith({
        viewId: 'view:1',
        sourceIds: ['source:1'],
      })
    )
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('sources.grouping.ungroupSuccess (count=1)')
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contextTree'] })
    expect(mockRefetchTree).toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
  })

  it('context menu: ungrouped row has no ungroup item', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    fireEvent.contextMenu(rowOf('SurrealDB 官方白皮书'))
    expect(screen.getByText('sources.grouping.openSource')).toBeInTheDocument()
    expect(screen.queryByText('sources.grouping.ungroupAction')).not.toBeInTheDocument()
  })

  it('context menu: copy opens the folder picker and reports the created copy', async () => {
    const onRefresh = vi.fn()
    const { queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(<GeminiSourcesColumn {...baseProps} onRefresh={onRefresh} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    fireEvent.click(screen.getByText('sources.grouping.copyTo'))

    // GroupPickerDialog mock 暴露 onConfirm('group:1')
    fireEvent.click(screen.getByTestId('group-picker-mock'))

    await waitFor(() =>
      expect(mockCopyMutateAsync).toHaveBeenCalledWith({
        groupId: 'group:1',
        sourceIds: ['source:1'],
      })
    )
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'sources.grouping.copyCreatedToast (title=系统架构设计.pdf)'
      )
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contextTree'] })
    expect(mockRefetchTree).toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
  })

  it('context menu: new folder entry opens the group name dialog', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    expect(screen.queryByTestId('group-name-dialog')).not.toBeInTheDocument()
    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    fireEvent.click(screen.getByText('sources.grouping.newFolder'))
    expect(screen.getByTestId('group-name-dialog')).toBeInTheDocument()
  })

  it('opens the context menu detail with the notebook context', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    fireEvent.click(screen.getByText('sources.grouping.openSource'))
    expect(mockOpenModal).toHaveBeenCalledWith('source', 'source:1', {
      notebookId: 'nb:test',
    })
  })

  it('toggles folder collapse when clicking folder header', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

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
        {...baseProps}
        contextSelections={{ 'source:1': 'off', 'source:2': 'off' }}
        onContextModeChange={handleContextModeChange}
      />,
      { wrapper: createWrapper().TestWrapper }
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
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    // 切换到 Web Research Tab (Radix TabsTrigger activates on mousedown)
    const webTab = screen.getByRole('tab', { name: /geminiSources.tabWebResearch/ })
    fireEvent.mouseDown(webTab)

    expect(screen.getByText(/geminiSources.webResearchTitle/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/geminiSources.fastPlaceholder/)).toBeInTheDocument()
  })

  it('renders Add Existing button in header and opens AddExistingSourceDialog on click', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    // 顶部操作栏应有【从已有添加】按钮
    const addExistingBtn = screen.getByRole('button', { name: /geminiSources.addExisting/ })
    expect(addExistingBtn).toBeInTheDocument()

    // 初始状态下弹窗未打开
    expect(screen.queryByTestId('add-existing-source-dialog')).not.toBeInTheDocument()

    // 点击后唤起 AddExistingSourceDialog
    fireEvent.click(addExistingBtn)
    expect(screen.getByTestId('add-existing-source-dialog')).toBeInTheDocument()
  })

  it('renders the localized knowledge base overview with counts and mounts the compact embed panel', async () => {
    const onRefresh = vi.fn()
    render(
      <GeminiSourcesColumn {...baseProps} onRefresh={onRefresh} />,
      { wrapper: createWrapper().TestWrapper }
    )

    // 左侧底部应显示【知识库全局资源概览】+ 紧凑补嵌面板
    expect(screen.getByText('sources.overview.title')).toBeInTheDocument()
    expect(screen.getByTestId('embed-missing-panel-compact')).toBeInTheDocument()

    // 验证异步获取计算后的指标：全库 20 篇，已关联 2 篇，待引入 18 篇文献
    expect(await screen.findByText('sources.overview.totalBadge (count=20)')).toBeInTheDocument()
    expect(screen.getByText('sources.overview.linkedLabel')).toBeInTheDocument()
    expect(screen.getByText('sources.overview.count (count=2)')).toBeInTheDocument()
    expect(screen.getByText('sources.overview.pendingLabel')).toBeInTheDocument()
    expect(screen.getByText('sources.overview.count (count=18)')).toBeInTheDocument()

    // 快捷按钮存在且点击唤起 AddExistingSourceDialog
    const quickImportBtn = screen.getByRole('button', {
      name: 'sources.overview.importAll (count=18)',
    })
    expect(quickImportBtn).toBeInTheDocument()

    fireEvent.click(quickImportBtn)
    expect(screen.getByTestId('add-existing-source-dialog')).toBeInTheDocument()
  })

  it('shows the all-linked overview state when nothing is unlinked', async () => {
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        groups: [{ id: 'group:1', name: '核心架构文档', parent_id: null }],
        sources: mockLibrarySources.map((s) => ({
          id: s.id,
          title: s.title,
          insights_count: 0,
          embedded: true,
          embedding_status: null,
        })),
        memberships: [],
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)

    render(<GeminiSourcesColumn {...baseProps} sources={mockLibrarySources} />, {
      wrapper: createWrapper().TestWrapper,
    })

    expect(await screen.findByText('sources.overview.allLinked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sources.overview.viewAll' })).toBeInTheDocument()
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
        {...baseProps}
        grouping={{}}
        onGroupingChange={handleGroupingChange}
      />,
      { wrapper: createWrapper().TestWrapper }
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
      refetch: mockRefetchTree,
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

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })

    // 默认空文件夹是折叠的，点击展开它
    const folderHeader = screen.getByText('项目资料库')
    fireEvent.click(folderHeader)

    // 展开后应显示：空提示 + 该文件夹总来源数: 8 + 从已有添加 按钮
    expect(screen.getByText('geminiSources.folderEmptyInNotebook')).toBeInTheDocument()
    expect(screen.getByText('geminiSources.folderTotalCount (count=8)')).toBeInTheDocument()
    const addFromExistingButtons = screen.getAllByRole('button', { name: /geminiSources.addExisting/ })
    const folderAddExistingBtn = addFromExistingButtons[addFromExistingButtons.length - 1]
    expect(folderAddExistingBtn).toBeInTheDocument()

    // 点击【从已有添加】打开弹窗
    fireEvent.click(folderAddExistingBtn)
    expect(screen.getByTestId('add-existing-source-dialog')).toBeInTheDocument()
  })

  it('forces folders with sources to default to expanded', () => {
    render(
      <GeminiSourcesColumn {...baseProps} contextSelections={{ 'source:1': 'full' }} />,
      { wrapper: createWrapper().TestWrapper }
    )

    // 包含 source:1 的文件夹默认强制展开，来源直接可见
    expect(screen.getByText('系统架构设计.pdf')).toBeVisible()
    expect(screen.getByText('核心架构文档')).toBeInTheDocument()
  })
})

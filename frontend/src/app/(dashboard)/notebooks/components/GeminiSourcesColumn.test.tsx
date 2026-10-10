import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeminiSourcesColumn } from './GeminiSourcesColumn'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import { sourcesApi } from '@/lib/api/sources'
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
  mockUpdateGroupMutateAsync,
  mockUpdateGroupMutate,
  mockDeleteGroupMutate,
  mockClipboardWrite,
} = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockUseSourceViews: vi.fn(),
  mockUseViewGroups: vi.fn(),
  mockOpenModal: vi.fn(),
  mockCopyMutateAsync: vi.fn(),
  mockUngroupMutateAsync: vi.fn(),
  mockRefetchTree: vi.fn(),
  mockUpdateGroupMutateAsync: vi.fn(),
  mockUpdateGroupMutate: vi.fn(),
  mockDeleteGroupMutate: vi.fn(),
  mockClipboardWrite: vi.fn().mockResolvedValue(undefined),
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
  useUpdateGroup: () => ({
    mutateAsync: (...args: unknown[]) => mockUpdateGroupMutateAsync(...args),
    mutate: (...args: unknown[]) => mockUpdateGroupMutate(...args),
  }),
  useDeleteGroup: () => ({
    mutate: (...args: unknown[]) => mockDeleteGroupMutate(...args),
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
  GroupNameDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onConfirm?: (name: string) => void | Promise<void>
  }) =>
    open ? (
      <div data-testid="group-name-dialog">
        <button
          data-testid="group-name-confirm"
          onClick={() => onConfirm?.('改名后的文件夹')}
        />
      </div>
    ) : null,
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
    get: vi.fn(),
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
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboardWrite },
      configurable: true,
    })
    mockUseSourceViews.mockReturnValue({ data: [] })
    mockUseViewGroups.mockReturnValue({ data: [] })
    mockCopyMutateAsync.mockResolvedValue({ created: ['source:1-copy'], failed: [] })
    mockUngroupMutateAsync.mockResolvedValue({ ungrouped: 1 })
    mockUpdateGroupMutateAsync.mockResolvedValue(undefined)
    // mutate(vars, { onSuccess })：同步调 onSuccess 以覆盖树刷新回调
    mockUpdateGroupMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
    )
    mockDeleteGroupMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
    )
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

  it('context menu: copy file name writes the source title to the clipboard', async () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    fireEvent.click(screen.getByText('sources.copyFileName'))

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalledWith('系统架构设计.pdf'))
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('sources.copiedToClipboard'))
  })

  it('context menu: copy relative path joins the folder chain, ungrouped rows copy file name only', async () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    // 分组来源：文件夹链 + 文件名
    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    fireEvent.click(screen.getByText('sources.copyRelativePath'))
    await waitFor(() =>
      expect(mockClipboardWrite).toHaveBeenCalledWith('核心架构文档/系统架构设计.pdf')
    )

    // 未分组来源：只有文件名
    fireEvent.contextMenu(rowOf('SurrealDB 官方白皮书'))
    fireEvent.click(screen.getByText('sources.copyRelativePath'))
    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalledWith('SurrealDB 官方白皮书'))
  })

  it('context menu: copy relative path joins a multi-level ancestor chain root-first', async () => {
    // 三层嵌套：论文库 / 2026 软考 / 高级架构，孙层挂来源
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        groups: [
          { id: 'group:root', name: '论文库', parent_id: null },
          { id: 'group:sub', name: '2026 软考', parent_id: 'group:root' },
          { id: 'group:leaf', name: '高级架构', parent_id: 'group:sub' },
        ],
        sources: [
          {
            id: 'source:deep',
            title: '架构真题.pdf',
            insights_count: 0,
            embedded: true,
            embedding_status: null,
          },
          {
            id: 'source:loose',
            title: '散落笔记.md',
            insights_count: 0,
            embedded: true,
            embedding_status: null,
          },
        ],
        memberships: [{ source_id: 'source:deep', group_id: 'group:leaf' }],
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })

    // 分组来源：祖先链根在前 + 自身文件夹 + 文件名
    fireEvent.contextMenu(rowOf('架构真题.pdf'))
    fireEvent.click(screen.getByText('sources.copyRelativePath'))
    await waitFor(() =>
      expect(mockClipboardWrite).toHaveBeenCalledWith('论文库/2026 软考/高级架构/架构真题.pdf')
    )

    // 同一棵树里的未分组来源：没有文件夹链，只复制文件名
    fireEvent.contextMenu(rowOf('散落笔记.md'))
    fireEvent.click(screen.getByText('sources.copyRelativePath'))
    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalledWith('散落笔记.md'))
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('sources.copiedToClipboard'))
  })

  it('context menu: copy absolute path uses asset file_path and falls back to asset url', async () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    // 上传文件 → asset.file_path
    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    fireEvent.click(screen.getByText('sources.copyAbsolutePath'))
    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalledWith('/path/to/架构.pdf'))

    // URL 来源 → asset.url
    fireEvent.contextMenu(rowOf('SurrealDB 官方白皮书'))
    fireEvent.click(screen.getByText('sources.copyAbsolutePath'))
    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalledWith('https://surrealdb.com'))
    expect(sourcesApi.get).not.toHaveBeenCalled()
  })

  it('context menu: copy absolute path fetches the detail when the row lacks asset data', async () => {
    // 分页未加载、仅存在于 context-tree 的行 asset 为 null，点击时按 id 拉详情
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        ...mockTreeData,
        sources: [
          ...mockTreeData.sources,
          { id: 'source:4', title: '分页外文献', insights_count: 0, embedded: true, embedding_status: null },
        ],
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)
    vi.mocked(sourcesApi.get).mockResolvedValue({
      ...mockSources[0],
      id: 'source:4',
      title: '分页外文献',
      full_text: '',
      asset: { file_path: '/data/uploads/分页外文献.md' },
    })

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })

    fireEvent.contextMenu(rowOf('分页外文献'))
    fireEvent.click(screen.getByText('sources.copyAbsolutePath'))

    await waitFor(() => expect(sourcesApi.get).toHaveBeenCalledWith('source:4'))
    await waitFor(() =>
      expect(mockClipboardWrite).toHaveBeenCalledWith('/data/uploads/分页外文献.md')
    )
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('sources.copiedToClipboard'))
  })

  it('context menu: copy absolute path degrades to an error toast when the detail fetch fails', async () => {
    // asset 缺失 → 按 id 拉详情；接口失败必须降级为错误提示，绝不写剪贴板
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        ...mockTreeData,
        sources: [
          ...mockTreeData.sources,
          {
            id: 'source:5',
            title: '详情拉取失败文献',
            insights_count: 0,
            embedded: true,
            embedding_status: null,
          },
        ],
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)
    vi.mocked(sourcesApi.get).mockRejectedValue(new Error('network down'))

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })

    fireEvent.contextMenu(rowOf('详情拉取失败文献'))
    fireEvent.click(screen.getByText('sources.copyAbsolutePath'))

    await waitFor(() => expect(sourcesApi.get).toHaveBeenCalledWith('source:5'))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('common.error'))
    expect(mockClipboardWrite).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalledWith('sources.copiedToClipboard')
  })

  it('context menu: copy absolute path degrades to an error toast when the fetched detail has no asset', async () => {
    // 详情拉通但 asset 仍为空（如纯文本来源）→ 无路径可复制，降级为错误提示
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        ...mockTreeData,
        sources: [
          ...mockTreeData.sources,
          {
            id: 'source:6',
            title: '无资产文献',
            insights_count: 0,
            embedded: true,
            embedding_status: null,
          },
        ],
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)
    vi.mocked(sourcesApi.get).mockResolvedValue({
      ...mockSources[0],
      id: 'source:6',
      title: '无资产文献',
      full_text: '',
      asset: null,
    })

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })

    fireEvent.contextMenu(rowOf('无资产文献'))
    fireEvent.click(screen.getByText('sources.copyAbsolutePath'))

    await waitFor(() => expect(sourcesApi.get).toHaveBeenCalledWith('source:6'))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('common.error'))
    expect(mockClipboardWrite).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalledWith('sources.copiedToClipboard')
  })

  it('context menu: copy absolute path is greyed out when asset has neither file_path nor url', async () => {
    render(
      <GeminiSourcesColumn
        {...baseProps}
        sources={[{ ...mockSources[0], asset: {} }, mockSources[1]]}
      />,
      { wrapper: createWrapper().TestWrapper }
    )

    fireEvent.contextMenu(rowOf('系统架构设计.pdf'))
    const item = screen.getByText('sources.copyAbsolutePath').closest('[role="menuitem"]')
    expect(item).not.toBeNull()
    expect(item).toHaveAttribute('data-disabled', '')

    // 点击置灰项不写剪贴板也不拉详情
    fireEvent.click(screen.getByText('sources.copyAbsolutePath'))
    await waitFor(() => expect(sourcesApi.get).not.toHaveBeenCalled())
    expect(mockClipboardWrite).not.toHaveBeenCalled()
  })

  it('folder header context menu offers subgroup/rename/move/delete entries', () => {
    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: createWrapper().TestWrapper })

    // 根层文件夹 depth 1 < MAX_GROUP_DEPTH，四项全有
    fireEvent.contextMenu(screen.getByTestId('gemini-folder-row'))
    expect(screen.getByText('sources.grouping.newSubgroup')).toBeInTheDocument()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
    expect(screen.getByText('common.delete')).toBeInTheDocument()
  })

  // 五层嵌套夹具：每层挂一个来源，保证全部默认展开、五层文件夹头都在 DOM 里
  const renderDeepNestedTree = () => {
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        groups: [
          { id: 'group:l1', name: '一级文件夹', parent_id: null },
          { id: 'group:l2', name: '二级文件夹', parent_id: 'group:l1' },
          { id: 'group:l3', name: '三级文件夹', parent_id: 'group:l2' },
          { id: 'group:l4', name: '四级文件夹', parent_id: 'group:l3' },
          { id: 'group:l5', name: '五级文件夹', parent_id: 'group:l4' },
        ],
        sources: Array.from({ length: 5 }, (_, i) => ({
          id: `source:deep:${i + 1}`,
          title: `层级来源${i + 1}`,
          insights_count: 0,
          embedded: true,
          embedding_status: null,
        })),
        memberships: Array.from({ length: 5 }, (_, i) => ({
          source_id: `source:deep:${i + 1}`,
          group_id: `group:l${i + 1}`,
        })),
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })
    return screen.getAllByTestId('gemini-folder-row')
  }

  it('folder header context menu still offers new-subgroup one level above the depth cap', () => {
    const rows = renderDeepNestedTree()
    expect(rows).toHaveLength(5)

    // 第 4 层（depth 4 < MAX_GROUP_DEPTH 5）仍可建子文件夹，防闸门误装过紧
    fireEvent.contextMenu(rows[3])
    expect(screen.getByText('sources.grouping.newSubgroup')).toBeInTheDocument()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
    expect(screen.getByText('common.delete')).toBeInTheDocument()
  })

  it('folder header context menu hides new-subgroup at the max nesting depth', () => {
    const rows = renderDeepNestedTree()
    expect(rows).toHaveLength(5)

    // 第 5 层已达 MAX_GROUP_DEPTH，隐藏「新建子文件夹」，其余三项不受影响
    fireEvent.contextMenu(rows[4])
    expect(screen.queryByText('sources.grouping.newSubgroup')).not.toBeInTheDocument()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
    expect(screen.getByText('common.delete')).toBeInTheDocument()
  })

  it('collapse-all folds every nested folder to top-level rows and expand-all restores them', () => {
    renderDeepNestedTree()

    // 全部文件夹有来源 → 初始全部展开，五层文件夹头和全部来源可见
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(5)
    expect(screen.getByText('层级来源5')).toBeInTheDocument()

    // 一键收起：只剩顶层文件夹头，嵌套文件夹与来源全部隐藏
    fireEvent.click(screen.getByRole('button', { name: 'geminiSources.collapseAll' }))
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(1)
    expect(screen.queryByText('二级文件夹')).not.toBeInTheDocument()
    expect(screen.queryByText('五级文件夹')).not.toBeInTheDocument()
    expect(screen.queryByText('层级来源1')).not.toBeInTheDocument()

    // 一键展开：五层文件夹头与来源全部恢复
    fireEvent.click(screen.getByRole('button', { name: 'geminiSources.expandAll' }))
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(5)
    expect(screen.getByText('五级文件夹')).toBeInTheDocument()
    expect(screen.getByText('层级来源5')).toBeInTheDocument()
  })

  it('collapse-all/expand-all still cover the full tree and the ungrouped section under a search filter', () => {
    // 五层嵌套 + 一条未分组来源；搜索只命中最深层的来源
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        groups: [
          { id: 'group:l1', name: '一级文件夹', parent_id: null },
          { id: 'group:l2', name: '二级文件夹', parent_id: 'group:l1' },
          { id: 'group:l3', name: '三级文件夹', parent_id: 'group:l2' },
          { id: 'group:l4', name: '四级文件夹', parent_id: 'group:l3' },
          { id: 'group:l5', name: '五级文件夹', parent_id: 'group:l4' },
        ],
        sources: [
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `source:deep:${i + 1}`,
            title: `层级来源${i + 1}`,
            insights_count: 0,
            embedded: true,
            embedding_status: null,
          })),
          {
            id: 'source:loose',
            title: '未分组资料',
            insights_count: 0,
            embedded: true,
            embedding_status: null,
          },
        ],
        memberships: Array.from({ length: 5 }, (_, i) => ({
          source_id: `source:deep:${i + 1}`,
          group_id: `group:l${i + 1}`,
        })),
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)

    render(<GeminiSourcesColumn {...baseProps} sources={[]} />, {
      wrapper: createWrapper().TestWrapper,
    })

    const search = screen.getByPlaceholderText('geminiSources.searchPlaceholder')
    fireEvent.change(search, { target: { value: '层级来源5' } })

    // 命中路径上的五层文件夹头全部保留（过滤后的来源沿祖先链上浮）；
    // 未命中来源行被过滤掉；未分组段整体隐藏
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(5)
    expect(screen.getByText('层级来源5')).toBeInTheDocument()
    expect(screen.queryByText('层级来源1')).not.toBeInTheDocument()
    expect(screen.queryByText('未分组资料')).not.toBeInTheDocument()
    expect(screen.queryByText('geminiSources.ungrouped')).not.toBeInTheDocument()

    // 过滤态一键收起：作用于全树（含被过滤隐藏的层级），只剩顶层文件夹头，命中来源随折叠隐藏
    fireEvent.click(screen.getByRole('button', { name: 'geminiSources.collapseAll' }))
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(1)
    expect(screen.queryByText('层级来源5')).not.toBeInTheDocument()

    // 过滤态一键展开：五层文件夹头与命中来源恢复
    fireEvent.click(screen.getByRole('button', { name: 'geminiSources.expandAll' }))
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(5)
    expect(screen.getByText('层级来源5')).toBeInTheDocument()

    // 收起的覆盖态不因清除搜索而重置；'ungrouped' 键同样被一键收起覆盖
    fireEvent.click(screen.getByRole('button', { name: 'geminiSources.collapseAll' }))
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(1)
    expect(screen.queryByText('层级来源3')).not.toBeInTheDocument()
    expect(screen.getByText('geminiSources.ungrouped')).toBeInTheDocument()
    expect(screen.queryByText('未分组资料')).not.toBeInTheDocument()

    // 清除搜索后一键展开：全树与未分组来源一起恢复
    fireEvent.click(screen.getByRole('button', { name: 'geminiSources.expandAll' }))
    expect(screen.getAllByTestId('gemini-folder-row')).toHaveLength(5)
    expect(screen.getByText('层级来源3')).toBeInTheDocument()
    expect(screen.getByText('未分组资料')).toBeInTheDocument()
  })

  it('folder context menu rename opens the GroupDialogs dialog and fires updateGroup + tree refresh', async () => {
    const { TestWrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(<GeminiSourcesColumn {...baseProps} />, { wrapper: TestWrapper })

    expect(screen.queryByTestId('group-name-dialog')).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('gemini-folder-row'))
    fireEvent.click(screen.getByText('common.edit'))

    // GroupDialogs 的重命名弹窗出现（复用 GroupNameDialog mock）
    expect(screen.getByTestId('group-name-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('group-name-confirm'))

    await waitFor(() =>
      expect(mockUpdateGroupMutateAsync).toHaveBeenCalledWith({
        id: 'group:1',
        name: '改名后的文件夹',
      })
    )
    // 分组 mutation 默认只失效 sourceViews+sources，树必须额外失效 contextTree 并 refetch
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contextTree'] })
    expect(mockRefetchTree).toHaveBeenCalled()
  })

  it('folder delete fires deleteGroup, resets grouping when the deleted folder is active, and refreshes the tree', async () => {
    mockUseSourceViews.mockReturnValue({
      data: [{ id: 'view:1', name: '默认视图', is_default: true, view_type: 'default' }],
    })
    const onGroupingChange = vi.fn()
    const { TestWrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <GeminiSourcesColumn
        {...baseProps}
        grouping={{ viewId: 'view:1', group: 'group:1' }}
        onGroupingChange={onGroupingChange}
      />,
      { wrapper: TestWrapper }
    )

    fireEvent.contextMenu(screen.getByTestId('gemini-folder-row'))
    fireEvent.click(screen.getByText('common.delete'))

    // 未勾选「连带删除来源」→ deleteGroup(id, false)；确认按钮与菜单项同名，菜单已关闭后按钮唯一
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() =>
      expect(mockDeleteGroupMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'group:1', deleteSources: false }),
        expect.anything()
      )
    )
    // 正在浏览的文件夹被删 → 分组选择回退 all
    expect(onGroupingChange).toHaveBeenCalledWith({ viewId: 'view:1', group: 'all' })
    // 删除后树刷新同样要求 contextTree 失效 + refetch 双保险
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contextTree'] })
    expect(mockRefetchTree).toHaveBeenCalled()
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

  it('select-all bulk passes the context-tree-merged full list, not just paginated sources', () => {
    // source:3 只存在于 context-tree（分页未加载），全选批量必须把它带上，
    // 否则树里它的勾选状态永远纹丝不动（只改到已分页的来源）。
    vi.mocked(useContextTree).mockReturnValue({
      data: {
        ...mockTreeData,
        sources: [
          ...mockTreeData.sources,
          { id: 'source:3', title: '分页外文献', insights_count: 0, embedded: true, embedding_status: null },
        ],
      },
      isLoading: false,
      refetch: mockRefetchTree,
    } as unknown as ReturnType<typeof useContextTree>)

    const handleBulk = vi.fn()
    render(
      <GeminiSourcesColumn
        {...baseProps}
        onBulkContextModeChange={handleBulk}
      />,
      { wrapper: createWrapper().TestWrapper }
    )

    // 顶栏计数分母也是全量口径：分页 2 条 + tree-only 1 条 = 3
    expect(screen.getByText('3/3')).toBeInTheDocument()

    // contextSelections 为空 → 全部默认勾选 → 点击即「全不选」，并带全量列表
    const label = screen.getByText('geminiSources.deselectAll')
    const checkbox = label.parentElement?.querySelector('button[role="checkbox"]')
    expect(checkbox).toBeInTheDocument()
    if (checkbox) {
      fireEvent.click(checkbox)
      expect(handleBulk).toHaveBeenCalledTimes(1)
      const [action, items] = handleBulk.mock.calls[0]
      expect(action).toBe('exclude')
      const ids = (items as Array<{ id: string }>).map((i) => i.id)
      expect(ids).toEqual(expect.arrayContaining(['source:1', 'source:2', 'source:3']))
      expect(ids).toHaveLength(3)
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

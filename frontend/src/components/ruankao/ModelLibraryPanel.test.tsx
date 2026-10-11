import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ModelLibraryPanel } from './ModelLibraryPanel'
import type { EssayMarksLibraryResponse, SourceViewResponse } from '@/lib/types/api'

// 测试基建（设计稿 2.8）：hooks 整模块罐头（EnvironmentsPanel.test 先例），
// 断言裸 i18n 键文本（全局 setup 恒等 t mock），QueryClientProvider 包装
// （SaveAsSourceDialog.test 先例）。
const { libraryMock, toggleMock, cleanupMock, viewsMock } = vi.hoisted(() => ({
  libraryMock: vi.fn(),
  toggleMock: vi.fn(),
  cleanupMock: vi.fn(),
  viewsMock: vi.fn(),
}))

vi.mock('@/lib/hooks/use-essay-marks', () => ({
  useEssayMarksLibrary: () => libraryMock(),
  useToggleEssayMark: () => ({ mutate: toggleMock, isPending: false }),
  useCleanupDanglingMarks: () => ({ mutate: cleanupMock, isPending: false }),
}))

vi.mock('@/lib/hooks/use-source-views', () => ({
  useSourceViews: () => ({ data: viewsMock() }),
}))

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

const singleView: SourceViewResponse = {
  id: 'source_view:ai_content',
  name: 'AI Content',
  view_type: 'ai_content',
  is_default: true,
  last_classified_at: null,
  classify_progress: null,
  created: null,
  updated: null,
}

const libraryFixture: EssayMarksLibraryResponse = {
  stats: { marked_sources: 3, marked_groups: 1, effective_total: 5 },
  groups: [
    {
      id: 'source_group:g1',
      name: 'Folder A',
      parent_id: null,
      depth: 1,
      marked: true,
      effective_count: 2,
    },
    {
      id: 'source_group:g2',
      name: 'Child B',
      parent_id: 'source_group:g1',
      depth: 2,
      marked: false,
      effective_count: 1,
    },
  ],
  sources: [
    {
      id: 'source:s1',
      title: 'Essay One',
      extension: 'pdf',
      updated: '',
      marked_direct: true,
      via_group_ids: ['source_group:g1'],
      source_group_ids: ['source_group:g1'],
    },
    {
      id: 'source:s2',
      title: 'Essay Two',
      extension: null,
      updated: '',
      marked_direct: false,
      via_group_ids: [],
      source_group_ids: ['source_group:g1'],
    },
    {
      id: 'source:s3',
      title: 'Notes Three',
      extension: 'md',
      updated: '',
      marked_direct: false,
      via_group_ids: [],
      source_group_ids: [],
    },
  ],
  dangling_marks: [],
}

function renderPanel() {
  return render(<ModelLibraryPanel />, { wrapper: createWrapper() })
}

describe('ModelLibraryPanel', () => {
  beforeEach(() => {
    libraryMock.mockReturnValue({
      data: libraryFixture,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    viewsMock.mockReturnValue([singleView])
    toggleMock.mockReset()
    cleanupMock.mockReset()
  })

  it('renders the three stat numbers from the canned library payload', () => {
    renderPanel()

    const stats = screen.getByTestId('ruankao-essay-library-stats')
    expect(within(stats).getByText('3')).toBeInTheDocument()
    expect(within(stats).getByText('1')).toBeInTheDocument()
    expect(within(stats).getByText('5')).toBeInTheDocument()
    expect(within(stats).getByText('ruankao.essayMark.statsSources')).toBeInTheDocument()
    expect(within(stats).getByText('ruankao.essayMark.statsGroups')).toBeInTheDocument()
    expect(within(stats).getByText('ruankao.essayMark.statsEffective')).toBeInTheDocument()
  })

  it('renders folder rows with effective-count badges and toggles groups via source_group', () => {
    renderPanel()

    const row = screen.getByTestId('ruankao-essay-library-group-item-source_group:g1')
    expect(within(row).getByText('Folder A')).toBeInTheDocument()
    expect(within(row).getByText('ruankao.essayMark.groupEffectiveCount')).toBeInTheDocument()
    // 子文件夹同样成行（按 parent_id 组树，默认全展开保持旧观感）
    expect(
      screen.getByTestId('ruankao-essay-library-group-item-source_group:g2')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ruankao-essay-library-group-toggle-source_group:g1'))
    expect(toggleMock).toHaveBeenCalledWith({
      target_type: 'source_group',
      target_id: 'source_group:g1',
    })
  })

  it('starts fully expanded with chevrons advertising the collapse action', () => {
    renderPanel()

    const expandG1 = screen.getByTestId('ruankao-essay-library-group-expand-source_group:g1')
    expect(expandG1).toHaveAttribute('aria-expanded', 'true')
    expect(expandG1).toHaveAttribute('aria-label', 'ruankao.essayMark.collapseFolderAction')
    expect(
      screen.getByTestId('ruankao-essay-library-group-expand-source_group:g2')
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses a folder to hide its subtree and re-expands it, leaving the flat list alone', () => {
    renderPanel()

    const expandG1 = screen.getByTestId('ruankao-essay-library-group-expand-source_group:g1')
    fireEvent.click(expandG1)
    expect(expandG1).toHaveAttribute('aria-expanded', 'false')
    expect(expandG1).toHaveAttribute('aria-label', 'ruankao.essayMark.expandFolderAction')
    expect(
      screen.queryByTestId('ruankao-essay-library-group-item-source_group:g2')
    ).not.toBeInTheDocument()
    // 收起只作用于树区：平铺区（搜索场景）的行保持原样
    expect(
      screen.getByTestId('ruankao-essay-library-source-item-source:s1')
    ).toBeInTheDocument()

    fireEvent.click(expandG1)
    expect(
      screen.getByTestId('ruankao-essay-library-group-item-source_group:g2')
    ).toBeInTheDocument()
  })

  it('mounts sources under their owning folder rows by source_group_ids', () => {
    renderPanel()

    const g1Row = screen.getByTestId('ruankao-essay-library-group-item-source_group:g1')
    const treeRowS1 = screen.getByTestId('ruankao-essay-library-tree-source-item-source:s1')
    const treeRowS2 = screen.getByTestId('ruankao-essay-library-tree-source-item-source:s2')
    const g2Row = screen.getByTestId('ruankao-essay-library-group-item-source_group:g2')
    // 归属正确：s1、s2 直接挂在 g1 行后、子文件夹 g2 行前；无归属的 s3 不进树
    expect(g1Row.compareDocumentPosition(treeRowS1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      treeRowS1.compareDocumentPosition(treeRowS2) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(treeRowS2.compareDocumentPosition(g2Row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      screen.queryByTestId('ruankao-essay-library-tree-source-item-source:s3')
    ).not.toBeInTheDocument()
    // via 徽标与平铺区一致地保留在树区文件行上
    expect(
      within(treeRowS1).getByText('ruankao.essayMark.viaGroupBadge')
    ).toBeInTheDocument()
  })

  it('hides tree-mounted files when their folder is collapsed', () => {
    renderPanel()

    fireEvent.click(screen.getByTestId('ruankao-essay-library-group-expand-source_group:g1'))
    expect(
      screen.queryByTestId('ruankao-essay-library-tree-source-item-source:s1')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-essay-library-tree-source-item-source:s2')
    ).not.toBeInTheDocument()
  })

  it('toggles marks on tree-mounted sources with target_type source', () => {
    renderPanel()

    fireEvent.click(
      screen.getByTestId('ruankao-essay-library-tree-source-toggle-source:s2')
    )
    expect(toggleMock).toHaveBeenCalledWith({
      target_type: 'source',
      target_id: 'source:s2',
    })
  })

  it('shows the empty-folder hint only while an empty folder is expanded', () => {
    libraryMock.mockReturnValue({
      data: {
        ...libraryFixture,
        groups: [
          ...libraryFixture.groups,
          {
            id: 'source_group:g3',
            name: 'Empty Folder',
            parent_id: null,
            depth: 1,
            marked: false,
            effective_count: 0,
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPanel()

    // 默认展开：空态提示可见
    expect(
      screen.getByTestId('ruankao-essay-library-group-empty-source_group:g3')
    ).toHaveTextContent('ruankao.essayMark.folderEmptyHint')

    const expandG3 = screen.getByTestId('ruankao-essay-library-group-expand-source_group:g3')
    fireEvent.click(expandG3)
    expect(
      screen.queryByTestId('ruankao-essay-library-group-empty-source_group:g3')
    ).not.toBeInTheDocument()
    fireEvent.click(expandG3)
    expect(
      screen.getByTestId('ruankao-essay-library-group-empty-source_group:g3')
    ).toBeInTheDocument()
  })

  it('shows the via-folder badge only for sources with via_group_ids', () => {
    renderPanel()

    const viaRow = screen.getByTestId('ruankao-essay-library-source-item-source:s1')
    expect(within(viaRow).getByText('Essay One')).toBeInTheDocument()
    expect(within(viaRow).getByText('ruankao.essayMark.viaGroupBadge')).toBeInTheDocument()

    const directRow = screen.getByTestId('ruankao-essay-library-source-item-source:s2')
    expect(
      within(directRow).queryByText('ruankao.essayMark.viaGroupBadge')
    ).not.toBeInTheDocument()
  })

  it('toggles sources with target_type source', () => {
    renderPanel()

    fireEvent.click(screen.getByTestId('ruankao-essay-library-source-toggle-source:s1'))
    expect(toggleMock).toHaveBeenCalledWith({
      target_type: 'source',
      target_id: 'source:s1',
    })
  })

  it('renders the dangling cleanup bar only when dangling marks exist and fires cleanup', () => {
    libraryMock.mockReturnValue({
      data: { ...libraryFixture, dangling_marks: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    const { unmount } = renderPanel()
    expect(screen.queryByTestId('ruankao-essay-library-dangling')).not.toBeInTheDocument()
    unmount()

    libraryMock.mockReturnValue({
      data: {
        ...libraryFixture,
        dangling_marks: [
          { id: 'option:m1', target_type: 'source_group', target_id: 'source_group:g9' },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPanel()

    expect(screen.getByTestId('ruankao-essay-library-dangling')).toBeInTheDocument()
    expect(screen.getByText('ruankao.essayMark.danglingTitle')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ruankao-essay-library-dangling-action'))
    expect(cleanupMock).toHaveBeenCalled()
  })

  it('filters the source list locally by title', () => {
    renderPanel()

    fireEvent.change(screen.getByPlaceholderText('ruankao.essayMark.sourcesSearchPlaceholder'), {
      target: { value: 'Two' },
    })

    expect(screen.getByTestId('ruankao-essay-library-source-item-source:s2')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-essay-library-source-item-source:s1')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-essay-library-source-item-source:s3')
    ).not.toBeInTheDocument()
  })

  it('renders the view select only when more than one view exists', () => {
    const { unmount } = renderPanel()
    expect(
      screen.queryByTestId('ruankao-essay-library-view-select')
    ).not.toBeInTheDocument()
    unmount()

    viewsMock.mockReturnValue([
      singleView,
      {
        id: 'source_view:v1',
        name: 'Research',
        view_type: 'custom',
        is_default: false,
        last_classified_at: null,
        classify_progress: null,
        created: null,
        updated: null,
      },
    ])
    renderPanel()

    expect(screen.getByTestId('ruankao-essay-library-view-select')).toBeInTheDocument()
  })

  it('navigates to the essay read view via full-page deep link on the read button', () => {
    // jsdom's window.location can't navigate; swap in a stubbed assign
    const assignMock = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignMock, href: originalLocation.href },
    })

    try {
      renderPanel()

      const button = screen.getByTestId('ruankao-essay-library-source-read-source:s1')
      expect(button).toHaveAttribute('aria-label', 'ruankao.essay.home.readCard')

      fireEvent.click(button)
      expect(assignMock).toHaveBeenCalledWith(
        `/ruankao?tab=essay&read=${encodeURIComponent('source:s1')}`
      )
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('keeps library rows single-flow with the L-line title cap (宽屏治理 P1-3)', () => {
    renderPanel()

    // 题库行同款机械套用：行内无 flex-1 簇（操作按钮紧跟内容），
    // 标题 truncate + max-w-md/lg:max-w-lg 封顶，行根不再两端撑开
    const row = screen.getByTestId('ruankao-essay-library-source-item-source:s1')
    expect(row).not.toHaveClass('justify-between')
    expect(row.querySelector('.flex-1')).toBeNull()
    const title = within(row).getByText('Essay One')
    expect(title).toHaveClass('truncate')
    expect(title).toHaveClass('max-w-md')
    expect(title).toHaveClass('lg:max-w-lg')

    // 文件夹树行同样去两端化（标记开关跟随内容，文件夹名截断封顶）
    const groupRow = screen.getByTestId(
      'ruankao-essay-library-group-item-source_group:g1',
    )
    expect(groupRow.querySelector('.flex-1')).toBeNull()
  })
})

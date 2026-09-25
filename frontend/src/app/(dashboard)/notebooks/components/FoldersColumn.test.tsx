import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// FoldersColumn 接线测试：视图切换 → onGroupingChange，树选中/建夹 → 对应 mutation hook。
// hooks 全 mock，GroupTree 渲染真实组件。

const { collapsedMock, toggleFoldersMock, viewsMock, viewGroupsMock, createGroupMock, updateGroupMock, deleteGroupMock } =
  vi.hoisted(() => ({
    collapsedMock: vi.fn(),
    toggleFoldersMock: vi.fn(),
    viewsMock: vi.fn(),
    viewGroupsMock: vi.fn(),
    createGroupMock: vi.fn().mockResolvedValue({ id: 'source_group:new' }),
    updateGroupMock: vi.fn().mockResolvedValue(undefined),
    deleteGroupMock: vi.fn().mockResolvedValue(undefined),
  }))

vi.mock('@/lib/hooks/use-source-views', () => ({
  useSourceViews: () => ({ data: viewsMock() }),
  useViewGroups: (viewId?: string | null) => ({ data: viewGroupsMock(viewId) }),
  useCreateGroup: () => ({ mutateAsync: createGroupMock, isPending: false }),
  useUpdateGroup: () => ({ mutate: updateGroupMock, mutateAsync: updateGroupMock, isPending: false }),
  useDeleteGroup: () => ({ mutate: deleteGroupMock, isPending: false }),
}))

vi.mock('@/lib/stores/notebook-columns-store', () => ({
  useNotebookColumnsStore: () => ({
    foldersCollapsed: collapsedMock(),
    toggleFolders: toggleFoldersMock,
  }),
}))

import { FoldersColumn } from './FoldersColumn'

// t returns the key string (setup.ts).

// jsdom 没有 scrollIntoView：Radix Select 打开时滚动选中项会崩掉整棵树
Element.prototype.scrollIntoView = () => {}

const VIEW_AI = {
  id: 'source_view:ai',
  name: 'AI Content',
  view_type: 'ai_content',
  is_default: true,
  last_classified_at: null,
  classify_progress: null,
  created: null,
  updated: null,
}
const VIEW_CUSTOM = {
  id: 'source_view:v1',
  name: 'Research',
  view_type: 'custom',
  is_default: false,
  last_classified_at: null,
  classify_progress: null,
  created: null,
  updated: null,
}
const G1 = {
  id: 'source_group:g1',
  view_id: 'source_view:v1',
  name: 'G1',
  parent_id: null,
  source_count: 2,
  created: null,
  updated: null,
}

const onGroupingChange = vi.fn()

function renderColumn(props: Partial<Parameters<typeof FoldersColumn>[0]> = {}) {
  return render(<FoldersColumn onGroupingChange={onGroupingChange} {...props} />)
}

describe('FoldersColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collapsedMock.mockReturnValue(false)
    viewsMock.mockReturnValue([VIEW_AI, VIEW_CUSTOM])
    viewGroupsMock.mockReturnValue([G1])
  })

  it('renders the tree of the resolved view (custom wins when nothing is selected)', () => {
    renderColumn()
    expect(viewGroupsMock).toHaveBeenCalledWith('source_view:v1')
    expect(screen.getByText('sources.grouping.folderRailTitle')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.all')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungrouped')).toBeInTheDocument()
    expect(screen.getByText('G1')).toBeInTheDocument()
    // custom 视图无 AI 覆盖提示
    expect(screen.queryByTestId('group-tree-ai-hint')).toBeNull()
  })

  it('switches views through the select and resets to the view root', () => {
    renderColumn({ grouping: { viewId: 'source_view:v1', group: 'all' } })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'sources.grouping.viewSelectLabel' }), {
      key: 'Enter',
    })
    fireEvent.click(screen.getByRole('option', { name: 'AI Content' }))

    expect(onGroupingChange).toHaveBeenCalledWith({ viewId: 'source_view:ai', group: 'all' })
  })

  it('navigates to a folder on tree click, carrying the resolved view id', () => {
    renderColumn({ grouping: { viewId: undefined, group: 'all' } })
    fireEvent.click(screen.getByText('G1'))

    expect(onGroupingChange).toHaveBeenCalledWith({
      viewId: 'source_view:v1',
      group: 'source_group:g1',
    })
  })

  it('marks the folder from grouping as the active tree row', () => {
    renderColumn({ grouping: { viewId: 'source_view:v1', group: 'source_group:g1' } })
    const row = screen.getByText('G1').closest('div.group')
    expect(row?.className).toContain('bg-accent')
  })

  it('shows the AI overwrite hint when browsing an AI view', () => {
    renderColumn({ grouping: { viewId: 'source_view:ai', group: 'all' } })
    expect(screen.getByTestId('group-tree-ai-hint')).toBeInTheDocument()
  })

  it('creates a folder through the tree dialog on the resolved view', async () => {
    renderColumn()
    fireEvent.click(screen.getByText('sources.grouping.newGroup'))
    const input = await screen.findByPlaceholderText('sources.grouping.groupNamePlaceholder')
    fireEvent.change(input, { target: { value: 'Fresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(createGroupMock).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'Fresh',
        parentId: null,
      })
    )
  })

  it('renames a folder through the tree hover menu', async () => {
    renderColumn()
    fireEvent.contextMenu(screen.getByText('G1'))
    fireEvent.click(await screen.findByText('common.edit'))
    const input = await screen.findByDisplayValue('G1')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateGroupMock).toHaveBeenCalledWith({ id: 'source_group:g1', name: 'Renamed' })
    )
  })

  it('deletes a folder through the tree menu (sources kept by default)', async () => {
    renderColumn()
    fireEvent.contextMenu(screen.getByText('G1'))
    fireEvent.click((await screen.findAllByText('common.delete'))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))

    await waitFor(() =>
      expect(deleteGroupMock).toHaveBeenCalledWith({ id: 'source_group:g1', deleteSources: false })
    )
  })

  it('resets active group to all when the deleted folder was the active one', async () => {
    renderColumn({ grouping: { viewId: 'source_view:v1', group: 'source_group:g1' } })
    fireEvent.contextMenu(screen.getByText('G1'))
    fireEvent.click((await screen.findAllByText('common.delete'))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))

    await waitFor(() =>
      expect(deleteGroupMock).toHaveBeenCalledWith({ id: 'source_group:g1', deleteSources: false })
    )
    expect(onGroupingChange).toHaveBeenCalledWith({
      viewId: 'source_view:v1',
      group: 'all',
    })
  })

  it('collapses to the vertical rail and back', () => {
    const { rerender } = renderColumn()
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse sources.grouping.folderRailTitle' })
    )
    expect(toggleFoldersMock).toHaveBeenCalledTimes(1)

    collapsedMock.mockReturnValue(true)
    rerender(<FoldersColumn onGroupingChange={onGroupingChange} />)
    expect(
      screen.getByLabelText('Expand sources.grouping.folderRailTitle')
    ).toBeInTheDocument()
    expect(screen.queryByText('sources.grouping.ungrouped')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 笔记本详情页右键组织的接线测试：卡片右键 → 菜单 → 弹窗 → mutation hook。
// hooks 全部 mock，只验证 SourcesColumn 把对的参数送进对的 hook。

const { openModalMock, toastSuccessMock, updateSourceMock, moveMock, createGroupMock, createViewMock, updateGroupMock, deleteGroupMock, ungroupMock, viewGroupsMock, viewsMock, deleteMock, addSourceDialogPropsMock } =
  vi.hoisted(() => ({
    openModalMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    updateSourceMock: vi.fn().mockResolvedValue(undefined),
    moveMock: vi.fn().mockResolvedValue({ moved: 1 }),
    createGroupMock: vi.fn().mockResolvedValue({ id: 'source_group:new' }),
    createViewMock: vi.fn().mockResolvedValue({ id: 'source_view:fresh' }),
    updateGroupMock: vi.fn().mockResolvedValue(undefined),
    deleteGroupMock: vi.fn().mockResolvedValue(undefined),
    ungroupMock: vi.fn().mockResolvedValue({ removed: 1 }),
    viewGroupsMock: vi.fn(),
    viewsMock: vi.fn(),
    deleteMock: vi.fn().mockResolvedValue(undefined),
    addSourceDialogPropsMock: vi.fn(),
  }))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...(args as [])),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useDeleteSource: () => ({ mutateAsync: deleteMock, isPending: false }),
  useRetrySource: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useRemoveSourceFromNotebook: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useUpdateSource: () => ({ mutateAsync: updateSourceMock, isPending: false }),
  useSourceStatus: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/lib/hooks/use-source-views', () => ({
  useSourceViews: () => ({ data: viewsMock() }),
  useViewGroups: (viewId?: string | null) => ({ data: viewGroupsMock(viewId) }),
  useMoveToGroup: () => ({ mutateAsync: moveMock, isPending: false }),
  useCreateGroup: () => ({ mutateAsync: createGroupMock, mutate: createGroupMock, isPending: false }),
  useCreateView: () => ({ mutateAsync: createViewMock, isPending: false }),
  useUpdateGroup: () => ({ mutate: updateGroupMock, mutateAsync: updateGroupMock, isPending: false }),
  useDeleteGroup: () => ({ mutate: deleteGroupMock, isPending: false }),
  useUngroupMembers: () => ({ mutateAsync: ungroupMock, isPending: false }),
}))

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: () => ({ openModal: openModalMock, closeModal: vi.fn() }),
}))

vi.mock('@/lib/stores/notebook-columns-store', () => ({
  useNotebookColumnsStore: () => ({ sourcesCollapsed: false, toggleSources: vi.fn() }),
}))

vi.mock('@/components/sources/AddSourceDialog', () => ({
  AddSourceDialog: (props: Record<string, unknown>) => {
    addSourceDialogPropsMock(props)
    return null
  },
}))
vi.mock('@/components/sources/AddExistingSourceDialog', () => ({ AddExistingSourceDialog: () => null }))

import { SourcesColumn } from './SourcesColumn'
import { SourceListResponse } from '@/lib/types/api'

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
// 默认视图排在前面：验证未选视图时新建落 custom 而非 AI 默认视图
const DEFAULT_VIEWS = [VIEW_AI, VIEW_CUSTOM]

const G1 = {
  id: 'source_group:g1',
  view_id: 'source_view:v1',
  name: 'G1',
  parent_id: null,
  source_count: 0,
  created: null,
  updated: null,
}

function source(id: string): SourceListResponse {
  return {
    id: `source:${id}`,
    title: id.toUpperCase(),
    topics: [],
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  }
}

function renderColumn(props: Partial<Parameters<typeof SourcesColumn>[0]> = {}) {
  return render(
    <SourcesColumn
      sources={[source('s1'), source('s2')]}
      isLoading={false}
      notebookId="notebook:n1"
      {...props}
    />
  )
}

// jsdom has no PointerEvent class and fireEvent's synthesized pointer events
// degrade to bare Events (no button), failing Radix guards like the dropdown
// trigger's button===0 check. Menu items activate on click and only track the
// press, so a MouseEvent-based pointerdown/pointerup pair followed by click
// mirrors the real browser activation order while keeping button/ctrlKey.
function pointerClick(el: Element) {
  const init = { bubbles: true, cancelable: true, button: 0 }
  fireEvent(el, new MouseEvent('pointerdown', init))
  fireEvent(el, new MouseEvent('pointerup', init))
  fireEvent.click(el)
}

function openContextMenuOn(title: string) {
  fireEvent.contextMenu(screen.getByText(title))
  // Radix context menus open on the contextmenu event itself, no pointer emulation needed
  expect(document.querySelector('[data-slot="context-menu-content"]')).not.toBeNull()
}

describe('SourcesColumn right-click organization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    viewGroupsMock.mockReturnValue([G1])
    viewsMock.mockReturnValue(DEFAULT_VIEWS)
  })

  it('opens the context menu on a source card with the core item set', () => {
    renderColumn()
    openContextMenuOn('S2')

    expect(screen.getByText('sources.grouping.openSource')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveToFolder')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.newFolder')).toBeInTheDocument()
    expect(screen.getByText('sources.removeFromNotebook')).toBeInTheDocument()
    expect(screen.getByText('sources.deleteSource')).toBeInTheDocument()
    // Browsing "all" gives no per-row membership info, so ungroup stays hidden
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
  })

  it('resolves the default view for group operations', () => {
    renderColumn()
    expect(viewGroupsMock).toHaveBeenCalledWith('source_view:v1')
  })

  it('opens the source modal from the menu', () => {
    renderColumn()
    openContextMenuOn('S2')
    pointerClick(screen.getByText('sources.grouping.openSource'))
    expect(openModalMock).toHaveBeenCalledWith('source', 'source:s2')
  })

  it('moves the right-clicked card: pick folder → confirm → useMoveToGroup', async () => {
    renderColumn()
    openContextMenuOn('S2')
    pointerClick(screen.getByText('sources.grouping.moveToFolder'))

    // hideRootOption + nothing selected → confirm locked
    const confirm = await screen.findByRole('button', { name: 'sources.grouping.moveHere' })
    expect(confirm).toBeDisabled()
    expect(screen.getByText('sources.grouping.moveToGroupTitle')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /G1/ }))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(moveMock).toHaveBeenCalledWith({
        groupId: 'source_group:g1',
        sourceIds: ['source:s2'],
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.moveSuccessWithTarget')
    // dialog closed after confirm
    await waitFor(() =>
      expect(screen.queryByText('sources.grouping.moveToGroupTitle')).toBeNull()
    )
  })

  it('creates a folder inline in the move picker, auto-selects it and moves into it', async () => {
    renderColumn()
    openContextMenuOn('S2')
    pointerClick(screen.getByText('sources.grouping.moveToFolder'))

    fireEvent.change(await screen.findByTestId('group-picker-create-input'), {
      target: { value: 'Fresh' },
    })
    fireEvent.click(screen.getByTestId('group-picker-create-button'))

    await waitFor(() =>
      expect(createGroupMock).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'Fresh',
        parentId: null,
      })
    )
    // new folder auto-selected → confirm unlocks without a manual pick
    const confirm = screen.getByRole('button', { name: 'sources.grouping.moveHere' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(moveMock).toHaveBeenCalledWith({
        groupId: 'source_group:new',
        sourceIds: ['source:s2'],
      })
    )
  })

  it('renames the right-clicked card through the dialog → useUpdateSource', async () => {
    renderColumn()
    openContextMenuOn('S2')
    pointerClick(screen.getByText('sources.grouping.renameSource'))

    const input = await screen.findByTestId('rename-source-input')
    expect(input).toHaveValue('S2')
    fireEvent.change(input, { target: { value: 'S2 renamed' } })
    fireEvent.click(screen.getByTestId('rename-source-save'))

    await waitFor(() =>
      expect(updateSourceMock).toHaveBeenCalledWith({
        id: 'source:s2',
        data: { title: 'S2 renamed' },
      })
    )
  })

  it('creates a new folder from the menu → useCreateGroup on the resolved view', async () => {
    renderColumn()
    openContextMenuOn('S1')
    pointerClick(screen.getByText('sources.grouping.newFolder'))

    fireEvent.change(await screen.findByTestId('group-name-input'), {
      target: { value: 'E2E_F3' },
    })
    fireEvent.click(screen.getByTestId('group-name-save'))

    await waitFor(() =>
      expect(createGroupMock).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'E2E_F3',
        parentId: null,
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.groupCreatedInView')
  })

  it('ungroups from the menu only while browsing a concrete folder', async () => {
    renderColumn({ grouping: { viewId: 'source_view:v1', group: 'source_group:g1' } })
    openContextMenuOn('S1')
    pointerClick(screen.getByText('sources.grouping.ungroupAction'))

    await waitFor(() =>
      expect(ungroupMock).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        sourceIds: ['source:s1'],
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.ungroupSuccess')
  })

  it('hides ungroup while browsing ungrouped (membership only clear inside a folder)', () => {
    renderColumn({ grouping: { viewId: 'source_view:v1', group: 'ungrouped' } })
    openContextMenuOn('S1')
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
  })
})

describe('SourcesColumn batch selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    viewGroupsMock.mockReturnValue([G1])
    viewsMock.mockReturnValue(DEFAULT_VIEWS)
  })

  function selectCard(id: string) {
    fireEvent.click(screen.getByTestId(`source-select-source:${id}`))
  }

  it('shows the bulk bar on selection with move/delete only (no copy/rename/ungroup while browsing all)', () => {
    renderColumn()
    selectCard('s1')

    const bar = screen.getByTestId('bulk-action-bar')
    expect(bar).toHaveTextContent('sources.grouping.selectedCount')
    expect(screen.getByText('sources.grouping.moveToGroup')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.batchDelete')).toBeInTheDocument()
    expect(screen.queryByText('sources.grouping.copyToGroup')).toBeNull()
    expect(screen.queryByText('sources.grouping.batchRename')).toBeNull()
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
  })

  it('select-all toggles every loaded card, then clears', () => {
    renderColumn()
    fireEvent.click(screen.getByTestId('select-all-sources'))

    expect(screen.getByTestId('source-select-source:s1')).toBeChecked()
    expect(screen.getByTestId('source-select-source:s2')).toBeChecked()
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('select-all-sources'))
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull()
  })

  it('bulk move from the bar: pick folder → confirm → single chunked useMoveToGroup call', async () => {
    renderColumn()
    selectCard('s1')
    selectCard('s2')
    fireEvent.click(screen.getByText('sources.grouping.moveToGroup'))

    const confirm = await screen.findByRole('button', { name: 'sources.grouping.moveHere' })
    expect(confirm).toBeDisabled()
    // dialog advertises the selection size alongside the target view
    expect(
      screen.getByText(/sources\.grouping\.selectedCount.*sources\.grouping\.moveTargetViewHint/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /G1/ }))
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(moveMock).toHaveBeenCalledWith({
        groupId: 'source_group:g1',
        sourceIds: ['source:s1', 'source:s2'],
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.moveSuccess')
    // selection cleared after the operation
    await waitFor(() => expect(screen.queryByTestId('bulk-action-bar')).toBeNull())
  })

  it('right-click a selected card routes move/delete to the whole selection', async () => {
    renderColumn()
    selectCard('s1')
    selectCard('s2')

    openContextMenuOn('S2')
    pointerClick(screen.getByText('sources.grouping.moveToFolder'))
    const confirm = await screen.findByRole('button', { name: 'sources.grouping.moveHere' })
    fireEvent.click(screen.getByRole('radio', { name: /G1/ }))
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(moveMock).toHaveBeenCalledWith({
        groupId: 'source_group:g1',
        sourceIds: ['source:s1', 'source:s2'],
      })
    )
  })

  it('batch delete asks once, then deletes every selected source', async () => {
    renderColumn()
    selectCard('s1')
    selectCard('s2')
    fireEvent.click(screen.getByText('sources.grouping.batchDelete'))

    fireEvent.click(screen.getByText('common.delete'))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(2))
    expect(deleteMock).toHaveBeenCalledWith('source:s1')
    expect(deleteMock).toHaveBeenCalledWith('source:s2')
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.batchDeleteSuccess')
    await waitFor(() => expect(screen.queryByTestId('bulk-action-bar')).toBeNull())
  })

  it('Escape clears the selection', () => {
    renderColumn()
    selectCard('s1')
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull()
  })

  it('prunes selections that fall out of the loaded list', () => {
    const { rerender } = renderColumn()
    selectCard('s1')
    selectCard('s2')
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()

    rerender(
      <SourcesColumn
        sources={[source('s1')]}
        isLoading={false}
        notebookId="notebook:n1"
      />
    )
    // s2 no longer loaded → only s1 stays selected → bar still shows count 1
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('source-select-source:s2')).toBeNull()
  })
})

describe('SourcesColumn folder navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    viewGroupsMock.mockReturnValue([G1])
    viewsMock.mockReturnValue(DEFAULT_VIEWS)
  })

  const onGroupingChange = vi.fn()

  it('keeps the default state free of folder chrome (no breadcrumb, no folder grid)', () => {
    renderColumn({ onGroupingChange })
    expect(screen.queryByTestId('notebook-folder-nav')).toBeNull()
    expect(screen.queryByTestId('folder-grid')).toBeNull()
  })

  it('shows source cards at the view root (the rail owns folder navigation)', () => {
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'all' },
    })
    expect(screen.getByText('S1')).toBeInTheDocument()
    expect(screen.getByText('S2')).toBeInTheDocument()
    expect(screen.getByTestId('select-all-sources')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-grid')).toBeNull()
    expect(screen.queryByTestId('notebook-folder-nav')).toBeNull()
  })

  it('shows the breadcrumb chain and returns to the view root', () => {
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'source_group:g1' },
    })
    const breadcrumb = screen.getByTestId('source-breadcrumb')
    expect(breadcrumb).toHaveTextContent('Research')
    expect(breadcrumb).toHaveTextContent('G1')

    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    expect(onGroupingChange).toHaveBeenCalledWith({
      viewId: 'source_view:v1',
      group: 'all',
    })
  })

  it('navigates back to a middle ancestor via the breadcrumb', () => {
    const child = { ...G1, id: 'source_group:c1', name: 'C1', parent_id: 'source_group:g1' }
    const grandchild = { ...G1, id: 'source_group:g2', name: 'G2', parent_id: 'source_group:c1' }
    viewGroupsMock.mockReturnValue([G1, child, grandchild])
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'source_group:c1' },
    })

    // 浏览 C1：面包屑 Research › G1 › C1
    const breadcrumb = screen.getByTestId('source-breadcrumb')
    expect(breadcrumb).toHaveTextContent('Research')
    expect(breadcrumb).toHaveTextContent('G1')
    expect(breadcrumb).toHaveTextContent('C1')

    // 点中间祖先 G1 返回该层
    fireEvent.click(screen.getByTestId('breadcrumb-source_group:g1'))
    expect(onGroupingChange).toHaveBeenCalledWith({
      viewId: 'source_view:v1',
      group: 'source_group:g1',
    })
  })

  it('creates from a card right-click into the custom view (not the AI default) and auto-enters it', async () => {
    renderColumn({ onGroupingChange })
    openContextMenuOn('S1')
    pointerClick(screen.getByText('sources.grouping.newFolder'))

    fireEvent.change(await screen.findByTestId('group-name-input'), {
      target: { value: 'E2E_D' },
    })
    fireEvent.click(screen.getByTestId('group-name-save'))

    // custom 视图排在 is_default 的 AI 视图之后也必须胜出
    await waitFor(() =>
      expect(createGroupMock).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'E2E_D',
        parentId: null,
      })
    )
    await waitFor(() =>
      expect(onGroupingChange).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        group: 'all',
      })
    )
  })

  it('blocks a duplicate sibling name before submit', async () => {
    renderColumn({ onGroupingChange })
    openContextMenuOn('S1')
    pointerClick(screen.getByText('sources.grouping.newFolder'))

    fireEvent.change(await screen.findByTestId('group-name-input'), {
      target: { value: 'G1' },
    })
    expect(screen.getByTestId('group-name-save')).toBeDisabled()
    expect(screen.getByTestId('group-name-duplicate')).toBeInTheDocument()
  })

  it('falls back to the root level when the browsed folder no longer exists', async () => {
    // grouping.group 指向的文件夹被他页删除：自动退回根层而不是留在幽灵位置
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'source_group:gone' },
    })
    await waitFor(() =>
      expect(onGroupingChange).toHaveBeenCalledWith({ viewId: 'source_view:v1', group: 'all' })
    )
  })

  it('falls back to no view when the selected view no longer exists', async () => {
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:deleted', group: 'all' },
    })
    await waitFor(() =>
      expect(onGroupingChange).toHaveBeenCalledWith({ viewId: undefined, group: 'all' })
    )
  })

  it('creates a custom view first when none exists so folders never land in the AI view', async () => {
    viewsMock.mockReturnValue([VIEW_AI])
    renderColumn({ onGroupingChange })
    openContextMenuOn('S1')
    pointerClick(screen.getByText('sources.grouping.newFolder'))

    fireEvent.change(await screen.findByTestId('group-name-input'), {
      target: { value: 'E2E_X' },
    })
    fireEvent.click(screen.getByTestId('group-name-save'))

    await waitFor(() => expect(createViewMock).toHaveBeenCalled())
    await waitFor(() =>
      expect(createGroupMock).toHaveBeenCalledWith({
        viewId: 'source_view:fresh',
        name: 'E2E_X',
        parentId: null,
      })
    )
  })

  it('shows a success toast naming the parent when a subfolder is created from a card', async () => {
    const child = { ...G1, id: 'source_group:c1', name: 'C1', parent_id: 'source_group:g1' }
    viewGroupsMock.mockReturnValue([G1, child])
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'source_group:g1' },
    })
    // 浏览 G1 时右键卡片新建：落点 = 当前浏览的文件夹
    openContextMenuOn('S1')
    pointerClick(screen.getByText('sources.grouping.newFolder'))
    fireEvent.change(await screen.findByTestId('group-name-input'), {
      target: { value: 'Sub' },
    })
    fireEvent.click(screen.getByTestId('group-name-save'))
    await waitFor(() =>
      expect(createGroupMock).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'Sub',
        parentId: 'source_group:g1',
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.groupCreatedInFolder')
  })

  it('uses the folder empty state inside a browsed folder (no create-first CTA)', () => {
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'source_group:g1' },
      sources: [],
    })
    expect(screen.getByText('sources.grouping.emptyFolderTitle')).toBeInTheDocument()
    expect(screen.queryByText('sources.createFirstSource')).toBeNull()
  })

  it('empty folder offers a quick add scoped to the browsed folder', async () => {
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'source_group:g1' },
      sources: [],
    })
    fireEvent.click(screen.getByRole('button', { name: 'sources.addNew' }))

    await waitFor(() =>
      expect(addSourceDialogPropsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: true,
          defaultNotebookId: 'notebook:n1',
          defaultViewId: 'source_view:v1',
          defaultGroupId: 'source_group:g1',
        })
      )
    )
  })

  it('no quick add while browsing ungrouped (no folder to file into)', () => {
    renderColumn({
      onGroupingChange,
      grouping: { viewId: 'source_view:v1', group: 'ungrouped' },
      sources: [],
    })
    expect(screen.getByText('sources.grouping.emptyFolderTitle')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sources.addNew' })).toBeNull()
  })
})

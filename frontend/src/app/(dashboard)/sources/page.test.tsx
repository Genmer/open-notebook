import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { pushMock, viewGroupsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  viewGroupsMock: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: vi.fn(() => ''),
  useSearchParams: () => new URLSearchParams(),
}))

// useTranslation is mocked globally in setup.ts (t returns the key string).

const listMock = vi.fn()
const deleteMock = vi.fn()
const updateMock = vi.fn()
vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    list: (...args: unknown[]) => listMock(...(args as [])),
    delete: (...args: unknown[]) => deleteMock(...(args as [])),
    update: (...args: unknown[]) => updateMock(...(args as [])),
  },
}))

const { mutateAsync, updateSourceMock, toastWarningMock, toastSuccessMock } = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ moved: 1, removed: 1, created: [], failed: [] }),
  updateSourceMock: vi.fn().mockResolvedValue(undefined),
  toastWarningMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...(args as [])),
    warning: (...args: unknown[]) => toastWarningMock(...(args as [])),
    error: vi.fn(),
  },
}))
vi.mock('@/lib/hooks/use-sources', () => ({
  useUpdateSource: () => ({ mutateAsync: updateSourceMock, isPending: false }),
}))
vi.mock('@/lib/hooks/use-source-views', () => {
  const mutationMock = () => ({ mutate: vi.fn(), mutateAsync, isPending: false })
  return {
    useSourceViews: () => ({ data: [
      { id: 'source_view:v1', name: 'Research', view_type: 'custom', is_default: false, last_classified_at: null, classify_progress: null, created: null, updated: null },
      { id: 'source_view:ai', name: 'AI Content', view_type: 'ai_content', is_default: true, last_classified_at: null, classify_progress: null, created: null, updated: null },
    ] }),
    useViewGroups: () => ({ data: viewGroupsMock() }),
    useSourceTypeGroups: () => ({ data: [{ key: 'pdf', count: 2 }], isLoading: false }),
    useCreateView: mutationMock,
    useUpdateView: mutationMock,
    useDeleteView: mutationMock,
    useCreateGroup: mutationMock,
    useUpdateGroup: mutationMock,
    useDeleteGroup: mutationMock,
    useMoveToGroup: mutationMock,
    useUngroupMembers: mutationMock,
    useCopyToGroup: mutationMock,
    useClassifyView: mutationMock,
    useClassifyProgressWatcher: () => {},
  }
})

vi.mock('@/components/sources/AddSourceDialog', () => ({
  AddSourceDialog: () => null,
}))
vi.mock('@/components/sources/EmbedMissingPanel', () => ({
  EmbedMissingPanel: () => null,
}))
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import SourcesPage from './page'
import { useSourceViewStore, FILE_TYPE_VIEW_ID } from '@/lib/stores/source-view-store'
import { SourceListResponse } from '@/lib/types/api'

function source(id: string): SourceListResponse {
  return {
    id: `source:${id}`,
    title: id,
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-01-01T00:00:00',
    updated: '2026-01-01T00:00:00',
  }
}

// 默认树数据与原内联 mock 相同；个别用例按需覆盖（clearAllMocks 不清实现）
const G1 = { id: 'source_group:g1', view_id: 'source_view:v1', name: 'G1', parent_id: null, source_count: 2, created: null, updated: null }
const G0 = { id: 'source_group:g0', view_id: 'source_view:v1', name: 'G0', parent_id: null, source_count: 0, created: null, updated: null }
const C1 = { id: 'source_group:c1', view_id: 'source_view:v1', name: 'C1', parent_id: 'source_group:g1', source_count: 1, created: null, updated: null }
viewGroupsMock.mockImplementation(() => [G1, G0])

function key(keyName: string) {
  fireEvent.keyDown(window, { key: keyName })
}

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SourcesPage />
    </QueryClientProvider>
  )
  return { ...utils, invalidateSpy }
}

describe('SourcesPage keyboard navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([source('a'), source('b'), source('c')])
    useSourceViewStore.setState({
      activeViewId: FILE_TYPE_VIEW_ID,
      selectedGroupByView: {},
      hasHydrated: true,
    })
  })

  it('moves the selection with arrow keys and opens with Enter', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    key('ArrowDown')
    key('ArrowDown')
    key('Enter')

    expect(pushMock).toHaveBeenCalledWith('/sources/source:c')
  })

  it('jumps to first/last with Home/End', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    key('End')
    key('Enter')
    expect(pushMock).toHaveBeenCalledWith('/sources/source:c')

    key('Home')
    key('Enter')
    expect(pushMock).toHaveBeenCalledWith('/sources/source:a')
  })

  it('space toggles row selection under a real view', async () => {
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'ungrouped' },
      hasHydrated: true,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    key(' ')
    await waitFor(() => expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument())

    key(' ') // toggling the same (current) row again
    await waitFor(() => expect(screen.queryByTestId('bulk-action-bar')).toBeNull())
  })

  it('space does not select under the file_type view', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    key(' ')
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull()
  })

  it('space does not hijack typing inside an input', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))

    expect(screen.queryByTestId('bulk-action-bar')).toBeNull()
    input.remove()
  })

  it('ignores arrow keys while focus is inside an open menu or dialog', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    // Focus starts on row a; with the guard, ArrowDown inside a menuitem must
    // not move the table selection, so Enter still opens row a.
    const menuItem = document.createElement('div')
    menuItem.setAttribute('role', 'menuitem')
    document.body.appendChild(menuItem)
    menuItem.focus()
    menuItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    fireEvent.keyDown(menuItem, { key: 'Enter' })
    expect(pushMock).not.toHaveBeenCalled()
    menuItem.remove()
  })
})

describe('SourcesPage file_type grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([source('a')])
    useSourceViewStore.setState({
      activeViewId: FILE_TYPE_VIEW_ID,
      selectedGroupByView: {},
      hasHydrated: true,
    })
  })

  it('queries with file_ext after selecting an extension group', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('PDF')).toBeInTheDocument())

    fireEvent.click(screen.getByText('PDF'))

    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ file_ext: 'pdf' })
      )
    )
    const lastParams = listMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(lastParams).toBeDefined()
    expect(lastParams?.source_type).toBeUndefined()
  })

  it('queries with source_type for the fixed link group', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('sources.type.link')).toBeInTheDocument())

    fireEvent.click(screen.getByText('sources.type.link'))

    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ source_type: 'link' })
      )
    )
    const lastParams = listMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(lastParams).toBeDefined()
    expect(lastParams?.file_ext).toBeUndefined()
  })

  it('falls back to all when the persisted selection is the removed file group', async () => {
    useSourceViewStore.setState({
      activeViewId: FILE_TYPE_VIEW_ID,
      selectedGroupByView: { [FILE_TYPE_VIEW_ID]: 'file' },
      hasHydrated: true,
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    for (const params of listMock.mock.calls.map((call) => call[0])) {
      expect(params.source_type).toBeUndefined()
      expect(params.file_ext).toBeUndefined()
    }
    expect(useSourceViewStore.getState().selectedGroupByView[FILE_TYPE_VIEW_ID]).toBe('file')
  })
})

describe('SourcesPage bulk actions over 100 sources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => source(`s${i}`))
    )
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'ungrouped' },
      hasHydrated: true,
    })
  })

  async function selectAllAndUngroup() {
    renderPage()
    await waitFor(() => expect(screen.getByText('s0')).toBeInTheDocument())

    fireEvent.click(
      screen.getByLabelText('sources.grouping.selectAllLoaded')
    )
    await waitFor(() =>
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'sources.grouping.ungroupAction' })
    )
  }

  it('loops the ungroup API in 100-id chunks', async () => {
    await selectAllAndUngroup()

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    const first = mutateAsync.mock.calls[0][0] as { viewId: string; sourceIds: string[] }
    const second = mutateAsync.mock.calls[1][0] as { viewId: string; sourceIds: string[] }
    expect(first.sourceIds).toHaveLength(100)
    expect(second.sourceIds).toHaveLength(50)
    expect(first.viewId).toBe('source_view:v1')
    // No source is sent twice across the chunk boundary
    const allIds = [...first.sourceIds, ...second.sourceIds]
    expect(new Set(allIds).size).toBe(150)
  })

  it('keeps going after a failed chunk and reports the partial result', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('chunk 1 exploded'))

    await selectAllAndUngroup()

    // The failed chunk does not stop the second one
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    expect(toastWarningMock).toHaveBeenCalledWith(
      'sources.grouping.bulkPartial'
    )
  })
})

describe('SourcesPage row menu and selection extras', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([source('a'), source('b'), source('c')])
    // 行级交互需要可见的表格：落在具体文件夹层（视图根层是文件夹网格）
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'source_group:g1' },
      hasHydrated: true,
    })
  })

  async function openRowMenu(rowTitle: string) {
    renderPage()
    await waitFor(() => expect(screen.getByText(rowTitle)).toBeInTheDocument())
    const trigger = screen.getAllByTestId('source-row-actions-trigger')[0]
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument())
  }

  it('ungroups a single source scoped to the active view from the row menu', async () => {
    await openRowMenu('a')
    fireEvent.click(screen.getByText('sources.grouping.ungroupAction'))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      viewId: 'source_view:v1',
      sourceIds: ['source:a'],
    })
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2)) // refetch
  })

  it('renames a single source through the dialog and patches the row inline', async () => {
    updateSourceMock.mockResolvedValueOnce(undefined)
    await openRowMenu('a')
    fireEvent.click(screen.getByText('sources.grouping.renameSource'))

    const input = await screen.findByTestId('rename-source-input')
    expect(input).toHaveValue('a')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByTestId('rename-source-save'))

    await waitFor(() =>
      expect(updateSourceMock).toHaveBeenCalledWith({ id: 'source:a', data: { title: 'Renamed' } })
    )
    // Inline patch without a refetch
    expect(await screen.findByText('Renamed')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('shift-click selects the range between the anchor and the clicked row', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    const checkboxes = screen.getAllByRole('checkbox')
    // [header, a, b, c]; anchor on a
    fireEvent.click(checkboxes[1])
    await waitFor(() => expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument())

    fireEvent.click(checkboxes[3], { shiftKey: true })

    // Verify the full range was selected by ungrouping it
    fireEvent.click(screen.getByRole('button', { name: 'sources.grouping.ungroupAction' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const payload = mutateAsync.mock.calls[0][0] as { sourceIds: string[] }
    expect(payload.sourceIds.sort()).toEqual(['source:a', 'source:b', 'source:c'])
  })

  it('batch-deletes serially, clears the selection and refreshes the list', async () => {
    deleteMock.mockResolvedValue(undefined)
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('sources.grouping.selectAllLoaded'))
    await waitFor(() => expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'sources.grouping.batchDelete' }))

    // ConfirmDialog action button
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(3))
    expect(deleteMock).toHaveBeenCalledWith('source:a')
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.batchDeleteSuccess')
    // Selection cleared and list refetched
    await waitFor(() => expect(screen.queryByTestId('bulk-action-bar')).toBeNull())
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(1))
  })

  it('applies batch rename rules via serial PUTs and patches rows inline', async () => {
    updateMock.mockResolvedValue(undefined)
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('sources.grouping.selectAllLoaded'))
    await waitFor(() => expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'sources.grouping.batchRename' }))

    fireEvent.change(screen.getByTestId('batch-rename-prefix'), { target: { value: 'X-' } })
    fireEvent.click(screen.getByTestId('batch-rename-apply'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(3))
    expect(updateMock).toHaveBeenCalledWith('source:a', { title: 'X-a' })
    expect(updateMock).toHaveBeenCalledWith('source:b', { title: 'X-b' })
    expect(updateMock).toHaveBeenCalledWith('source:c', { title: 'X-c' })
    expect(await screen.findByText('X-a')).toBeInTheDocument()
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.renameSuccess')
  })

  it('keeps the old title on rows whose batch rename PUT failed', async () => {
    updateMock.mockImplementation(async (id: string) => {
      if (id === 'source:b') throw new Error('rename boom')
      return undefined
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('sources.grouping.selectAllLoaded'))
    await waitFor(() => expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'sources.grouping.batchRename' }))

    fireEvent.change(screen.getByTestId('batch-rename-prefix'), { target: { value: 'X-' } })
    fireEvent.click(screen.getByTestId('batch-rename-apply'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(3))
    expect(toastWarningMock).toHaveBeenCalledWith('sources.grouping.bulkPartial')
    // Succeeded rows are patched inline; the failed one keeps its persisted title
    expect(await screen.findByText('X-a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.queryByText('X-b')).toBeNull()
  })
})

describe('SourcesPage breadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([source('a')])
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: {},
      hasHydrated: true,
    })
  })

  it('shows the folder chain and navigates back to all', async () => {
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'source_group:g1' },
      hasHydrated: true,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    const breadcrumb = screen.getByTestId('source-breadcrumb')
    expect(breadcrumb).toHaveTextContent('Research')
    expect(breadcrumb).toHaveTextContent('G1')

    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'Research' }))
    // 回到视图根层：不再拉文件列表，直接呈现文件夹网格
    await waitFor(() =>
      expect(screen.getByTestId('sources-folder-grid-area')).toBeInTheDocument()
    )
    expect(useSourceViewStore.getState().selectedGroupByView['source_view:v1']).toBe('all')
  })
})

describe('SourcesPage row context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([source('a'), source('b')])
    // 行级右键需要可见表格：落在具体文件夹层（含 ungroup 菜单项）
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'source_group:g1' },
      hasHydrated: true,
    })
  })

  async function openRowContextMenu() {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())
    // contextmenu bubbles from the title cell up to the row trigger
    fireEvent.contextMenu(screen.getByText('a'))
  }

  it('shows the folder item set on row right-click', async () => {
    await openRowContextMenu()

    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveToFolder')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.copyTo')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.newFolder')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungroupAction')).toBeInTheDocument()
    expect(screen.getByText('sources.deleteSource')).toBeInTheDocument()
  })

  it('trims the folder items in the file_type view', async () => {
    useSourceViewStore.setState({ activeViewId: FILE_TYPE_VIEW_ID, hasHydrated: true })
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByText('a'))

    expect(screen.queryByText('sources.grouping.moveToFolder')).toBeNull()
    expect(screen.queryByText('sources.grouping.copyTo')).toBeNull()
    expect(screen.queryByText('sources.grouping.newFolder')).toBeNull()
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('sources.deleteSource')).toBeInTheDocument()
  })

  it('moves a single row through the right-click menu with a target-name toast', async () => {
    await openRowContextMenu()
    fireEvent.click(screen.getByText('sources.grouping.moveToFolder'))

    // hideRootOption: confirm stays locked until a folder is picked
    const confirm = await screen.findByRole('button', { name: 'sources.grouping.moveHere' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /G1/ }))

    fireEvent.click(confirm)
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        groupId: 'source_group:g1',
        sourceIds: ['source:a'],
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.moveSuccessWithTarget')
  })

  it('creates a folder inline in the move picker opened from right-click', async () => {
    mutateAsync.mockResolvedValueOnce({ id: 'source_group:new' })
    await openRowContextMenu()
    fireEvent.click(screen.getByText('sources.grouping.moveToFolder'))

    fireEvent.change(await screen.findByTestId('group-picker-create-input'), {
      target: { value: 'Fresh' },
    })
    fireEvent.click(screen.getByTestId('group-picker-create-button'))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'Fresh',
        parentId: null,
      })
    )
    // the new folder is auto-selected, so confirm unlocks without a manual pick
    const confirm = screen.getByRole('button', { name: 'sources.grouping.moveHere' })
    await waitFor(() => expect(confirm).toBeEnabled())
  })

  it('targets the whole selection when rows are checked', async () => {
    await openRowContextMenu()
    fireEvent.click(screen.getByLabelText('sources.grouping.selectAllLoaded'))
    await waitFor(() => expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByText('a'))
    fireEvent.click(screen.getByText('sources.grouping.renameSource'))
    // bulk semantics: the batch rename dialog opens instead of the single-row one
    expect(await screen.findByTestId('batch-rename-prefix')).toBeInTheDocument()
  })

  it('creates a new folder from the right-click menu', async () => {
    // 未分组层：新建落根（parentId null）
    useSourceViewStore.setState({
      selectedGroupByView: { 'source_view:v1': 'ungrouped' },
    })
    await openRowContextMenu()
    fireEvent.click(screen.getByText('sources.grouping.newFolder'))

    fireEvent.change(await screen.findByTestId('group-name-input'), { target: { value: 'E2E_F' } })
    fireEvent.click(screen.getByTestId('group-name-save'))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'E2E_F',
        parentId: null,
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.groupCreatedInView')
  })
})

describe('SourcesPage family segments and folder hints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([source('a')])
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'ungrouped' },
      hasHydrated: true,
    })
  })

  it('renders the three family segments with the active family hint', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    expect(screen.getByText('sources.grouping.familyMine')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.familyAi')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.familyFileType')).toBeInTheDocument()
    // custom 视图激活 → 我的文件夹段 hint 常驻
    expect(screen.getByTestId('active-family-hint')).toHaveTextContent(
      'sources.grouping.familyMineHint'
    )
  })

  it('renders a 0 badge for empty folders in the tree', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('G0')).toBeInTheDocument())
    const badges = screen.getAllByTestId('group-badge')
    expect(badges.map((badge) => badge.textContent)).toEqual(['2', '0'])
  })

  it('feeds the new-folder dialog the location hint and root sibling names', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByText('a'))
    fireEvent.click(screen.getByText('sources.grouping.newFolder'))

    expect(await screen.findByTestId('group-location-hint')).toBeInTheDocument()
    const chips = screen.getByTestId('sibling-folder-chips')
    expect(chips.textContent).toContain('G1')
    expect(chips.textContent).toContain('G0')
  })
})

describe('SourcesPage folder navigation and AI view hints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue([source('a')])
    viewGroupsMock.mockReturnValue([G1, G0])
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: {},
      hasHydrated: true,
    })
  })

  it('shows the folder grid at the view root without fetching the file list', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByTestId('sources-folder-grid-area')).toBeInTheDocument()
    )
    // 大图标文件夹瓷砖 + 未分组 + 新建，空文件夹 0 徽章可见
    const g0Tile = screen.getByTestId('folder-tile-source_group:g0')
    expect(g0Tile).toHaveTextContent('G0')
    expect(g0Tile).toHaveTextContent('0')
    expect(screen.getByTestId('folder-tile-ungrouped')).toBeInTheDocument()
    expect(screen.getByTestId('folder-tile-new')).toBeInTheDocument()
    // 根层没有表格行，也不发起文件列表请求
    expect(screen.queryByRole('table')).toBeNull()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('enters a folder from the tree and filters the table to it', async () => {
    viewGroupsMock.mockReturnValue([G1, G0, C1])
    renderPage()
    // 视图根层 = 文件夹网格（macOS/Windows 直觉），没有行
    await waitFor(() =>
      expect(screen.getByTestId('sources-folder-grid-area')).toBeInTheDocument()
    )
    expect(screen.getByTestId('folder-tile-source_group:g1')).toBeInTheDocument()
    expect(screen.queryByText('a')).toBeNull()

    fireEvent.click(screen.getByText('C1'))

    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ group_id: 'source_group:c1' })
      )
    )
    expect(useSourceViewStore.getState().selectedGroupByView['source_view:v1']).toBe(
      'source_group:c1'
    )
  })

  it('returns to a middle ancestor from the breadcrumb', async () => {
    viewGroupsMock.mockReturnValue([G1, G0, C1])
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'source_group:c1' },
      hasHydrated: true,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    const breadcrumb = screen.getByTestId('source-breadcrumb')
    expect(breadcrumb).toHaveTextContent('Research')
    expect(breadcrumb).toHaveTextContent('G1')
    expect(breadcrumb).toHaveTextContent('C1')

    fireEvent.click(within(breadcrumb).getByTestId('breadcrumb-source_group:g1'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ group_id: 'source_group:g1' })
      )
    )
    expect(useSourceViewStore.getState().selectedGroupByView['source_view:v1']).toBe(
      'source_group:g1'
    )
  })

  it('creates a new folder inside the browsed folder (file-browser semantics)', async () => {
    viewGroupsMock.mockReturnValue([G1, G0, C1])
    useSourceViewStore.setState({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'source_group:c1' },
      hasHydrated: true,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByText('a'))
    fireEvent.click(screen.getByText('sources.grouping.newFolder'))
    fireEvent.change(await screen.findByTestId('group-name-input'), {
      target: { value: 'E2E_SUB' },
    })
    fireEvent.click(screen.getByTestId('group-name-save'))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        viewId: 'source_view:v1',
        name: 'E2E_SUB',
        parentId: 'source_group:c1',
      })
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('sources.grouping.groupCreatedInFolder')
  })

  it('shows the persistent AI overwrite hint on the tree for AI views', async () => {
    useSourceViewStore.setState({
      activeViewId: 'source_view:ai',
      selectedGroupByView: {},
      hasHydrated: true,
    })
    renderPage()
    await waitFor(() =>
      expect(screen.getByTestId('folder-grid-ai-hint')).toBeInTheDocument()
    )

    expect(screen.getByTestId('group-tree-ai-hint')).toHaveTextContent(
      'sources.grouping.aiOverwriteHint'
    )
    expect(screen.getByTestId('active-family-hint')).toHaveTextContent(
      'sources.grouping.familyAiHint'
    )
  })
})

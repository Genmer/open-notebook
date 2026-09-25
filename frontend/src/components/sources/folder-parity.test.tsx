import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'

import { SourceGroupResponse } from '@/lib/types/api'
import { GroupTree } from './GroupTree'
import { FolderGrid } from './FolderGrid'

// 两页共享组件的行为一致性（验收④）：同一份数据分别喂给 /sources 的 GroupTree 与
// 笔记页的 FolderGrid，同一交互必须产出同一结果——徽章、右键菜单、弹窗状态机
// （新建 parentId/重命名/移动禁环/级联删除）、AI 覆盖提示、导航选中值。
// Radix 弹窗挂在 document.body，两份组件不能同时渲染，逐侧挂载、cleanup 后比对。

function group(id: string, parentId: string | null = null, count = 0): SourceGroupResponse {
  return {
    id: `source_group:${id}`,
    view_id: 'source_view:v1',
    name: id,
    parent_id: parentId ? `source_group:${parentId}` : null,
    source_count: count,
    created: null,
    updated: null,
  }
}

const GROUPS = [
  group('alpha', null, 2),
  group('beta', null, 0), // 空文件夹：两页都必须可见
  group('child', 'alpha', 1),
]

type SharedCallbacks = {
  onSelect?: unknown
  onCreateGroup?: (name: string, parentId: string | null) => void
  onRenameGroup?: (id: string, name: string) => void
  onMoveGroup?: (id: string, parentId: string | null) => void
  onDeleteGroup?: (id: string, deleteSources: boolean) => void
}

function mountTree(overrides: Partial<Parameters<typeof GroupTree>[0]> = {}) {
  const props: Parameters<typeof GroupTree>[0] = {
    activeViewId: 'source_view:v1',
    groups: GROUPS,
    selected: 'all',
    onSelect: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onMoveGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    viewName: 'Research',
    ...overrides,
  }
  render(<GroupTree {...props} />)
  return props
}

function mountGrid(overrides: Partial<Parameters<typeof FolderGrid>[0]> = {}) {
  const props: Parameters<typeof FolderGrid>[0] = {
    viewName: 'Research',
    groups: GROUPS,
    selected: 'all',
    onSelect: vi.fn(),
    onNewFolder: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onMoveGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    ...overrides,
  }
  render(<FolderGrid {...props} />)
  return props
}

// 在两侧分别跑同一段交互脚本，收集结果后比对相等（并等于期望值）。
async function runOnBothSides<T>(
  interact: (side: 'tree' | 'grid', props: SharedCallbacks) => T | Promise<T>
): Promise<[T, T]> {
  cleanup()
  const treeProps = mountTree()
  const fromTree = await interact('tree', treeProps)
  cleanup()
  const gridProps = mountGrid()
  const fromGrid = await interact('grid', gridProps)
  return [fromTree, fromGrid]
}

// 右键同一文件夹：树侧右键行文字，网格侧右键 tile
function openFolderMenu(side: 'tree' | 'grid', name: string) {
  const target =
    side === 'tree'
      ? screen.getByText(name)
      : screen.getByTestId(`folder-tile-source_group:${name}`)
  fireEvent.contextMenu(target)
}

describe('folder parity: GroupTree (/sources) vs FolderGrid (notebook)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('renders the same badge values, with 0 for the empty folder on both sides', async () => {
    const results = await runOnBothSides(() => {
      const row = screen.getByText('beta').closest('button') as HTMLElement
      const emptyBadge = within(row).getByTestId('group-badge')
      const fullRow = screen.getByText('alpha').closest('button') as HTMLElement
      return {
        empty: emptyBadge.textContent,
        emptyFaded: emptyBadge.className.includes('opacity-50'),
        full: within(fullRow).getByTestId('group-badge').textContent,
      }
    })
    expect(results[0]).toEqual({ empty: '0', emptyFaded: true, full: '2' })
    expect(results[0]).toEqual(results[1])
  })

  it('offers the same context-menu items for the same folder', async () => {
    const results = await runOnBothSides((side) => {
      openFolderMenu(side, 'beta')
      return [
        'sources.grouping.newSubgroup',
        'common.edit',
        'sources.grouping.moveTo',
        'common.delete',
      ].map((item) => screen.queryByText(item) !== null)
    })
    expect(results[0]).toEqual([true, true, true, true])
    expect(results[0]).toEqual(results[1])
  })

  it('creates a subfolder with the same parentId, location hint and sibling list', async () => {
    const results = await runOnBothSides(async (side, props) => {
      openFolderMenu(side, 'alpha')
      fireEvent.click(screen.getByText('sources.grouping.newSubgroup'))
      const input = await screen.findByTestId('group-name-input')
      const hint = screen.getByTestId('group-location-hint')
      const siblings = screen.getByTestId('sibling-folder-chips').textContent
      fireEvent.change(input, { target: { value: 'Gamma' } })
      fireEvent.click(screen.getByTestId('group-name-save'))
      await waitFor(() =>
        expect(props.onCreateGroup).toHaveBeenCalledWith('Gamma', 'source_group:alpha')
      )
      return { hintText: hint.textContent, siblingsContainChild: !!siblings?.includes('child') }
    })
    expect(results[0].siblingsContainChild).toBe(true)
    expect(results[0]).toEqual(results[1])
  })

  it('renames the same folder with identical arguments', async () => {
    const results = await runOnBothSides(async (side, props) => {
      openFolderMenu(side, 'beta')
      fireEvent.click(screen.getByText('common.edit'))
      const input = await screen.findByDisplayValue('beta')
      fireEvent.change(input, { target: { value: 'Renamed' } })
      fireEvent.click(screen.getByTestId('group-name-save'))
      await waitFor(() =>
        expect(props.onRenameGroup).toHaveBeenCalledWith('source_group:beta', 'Renamed')
      )
      return (props.onRenameGroup as Mock | undefined)?.mock.calls[0]
    })
    expect(results[0]).toEqual(['source_group:beta', 'Renamed'])
    expect(results[0]).toEqual(results[1])
  })

  it('moves a folder with the same self/descendant guard and payload', async () => {
    const results = await runOnBothSides(async (side, props) => {
      openFolderMenu(side, 'alpha')
      fireEvent.click(screen.getByText('sources.grouping.moveTo'))
      await screen.findByRole('button', { name: 'sources.grouping.moveHere' })
      const selfDisabled = screen.getByRole('radio', { name: /alpha/ }).hasAttribute('disabled')
      const descendantDisabled = screen
        .getByRole('radio', { name: /child/ })
        .hasAttribute('disabled')
      const otherEnabled = !screen.getByRole('radio', { name: /beta/ }).hasAttribute('disabled')
      fireEvent.click(screen.getByRole('radio', { name: /beta/ }))
      fireEvent.click(screen.getByRole('button', { name: 'sources.grouping.moveHere' }))
      await waitFor(() =>
        expect(props.onMoveGroup).toHaveBeenCalledWith('source_group:alpha', 'source_group:beta')
      )
      return { selfDisabled, descendantDisabled, otherEnabled }
    })
    expect(results[0]).toEqual({ selfDisabled: true, descendantDisabled: true, otherEnabled: true })
    expect(results[0]).toEqual(results[1])
  })

  it('deletes with the same cascade two-step confirmation', async () => {
    const results = await runOnBothSides(async (side, props) => {
      openFolderMenu(side, 'beta')
      const menuDeletes = screen.getAllByText('common.delete')
      fireEvent.click(menuDeletes[menuDeletes.length - 1])
      // 第一步：勾选"连来源一起删"后确认
      fireEvent.click(await screen.findByRole('checkbox'))
      expect(screen.getByText('sources.grouping.deleteGroupWithSourcesWarn')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
      // 第二步：级联二次确认
      fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))
      await waitFor(() => expect(props.onDeleteGroup).toHaveBeenCalledWith('source_group:beta', true))
      return (props.onDeleteGroup as Mock | undefined)?.mock.calls[0]
    })
    expect(results[0]).toEqual(['source_group:beta', true])
    expect(results[0]).toEqual(results[1])
  })

  it('shows the same AI overwrite hint copy on AI views', async () => {
    cleanup()
    mountTree({ isAiView: true })
    const treeHint = screen.getByTestId('group-tree-ai-hint').textContent
    cleanup()
    mountGrid({ isAiView: true })
    const railHint = screen.getByTestId('folder-grid-ai-hint').textContent
    expect(treeHint).toBe('sources.grouping.aiOverwriteHint')
    expect(railHint).toBe(treeHint)
  })

  it('navigates with the same selection values for the same affordances', async () => {
    const results = await runOnBothSides((side, props) => {
      const calls: unknown[][] = []
      const record = (el: Element) => {
        fireEvent.click(el)
        const onSelect = props.onSelect as Mock
        calls.push(onSelect.mock.calls.at(-1) ?? [])
      }
      if (side === 'tree') {
        record(screen.getByText('sources.grouping.ungrouped'))
        record(screen.getByText('alpha'))
      } else {
        record(screen.getByTestId('folder-tile-ungrouped'))
        record(screen.getByTestId('folder-tile-source_group:alpha'))
      }
      return calls
    })
    // 同一交互产出同一选中值：ungrouped 哨兵与文件夹 id
    expect(results[0]).toEqual([['ungrouped'], ['source_group:alpha']])
    expect(results[0]).toEqual(results[1])
  })
})

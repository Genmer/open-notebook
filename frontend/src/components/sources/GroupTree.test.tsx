import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { SourceGroupResponse } from '@/lib/types/api'
import { GroupTree } from './GroupTree'

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

const setup = (overrides: Partial<Parameters<typeof GroupTree>[0]> = {}) => {
  const props: Parameters<typeof GroupTree>[0] = {
    activeViewId: 'source_view:v1',
    groups: [group('parent', null, 3), group('child', 'parent')],
    selected: 'all',
    onSelect: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onMoveGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    ...overrides,
  }
  render(<GroupTree {...props} />)
  return props
}

describe('GroupTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the anchors and nested groups hierarchically', () => {
    setup()
    expect(screen.getByText('sources.grouping.all')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungrouped')).toBeInTheDocument()
    expect(screen.getByText('parent')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()

    // child really lives under parent: collapsing the row hides it
    const parentRow = screen.getByText('parent').closest('button') as HTMLElement
    fireEvent.click(parentRow.querySelector('[aria-expanded]') as HTMLElement)
    expect(screen.queryByText('child')).toBeNull()
  })

  it('shows the source count badge', () => {
    setup()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders a faded 0 badge for empty folders too', () => {
    setup()
    const badges = screen.getAllByTestId('group-badge')
    expect(badges.map((badge) => badge.textContent)).toEqual(['3', '0'])
  })

  it('shows the AI overwrite hint at the tree top on AI views', () => {
    setup({ isAiView: true })
    expect(screen.getByTestId('group-tree-ai-hint')).toHaveTextContent(
      'sources.grouping.aiOverwriteHint'
    )
  })

  it('shows no AI hint on custom views', () => {
    setup()
    expect(screen.queryByTestId('group-tree-ai-hint')).toBeNull()
  })

  it('feeds the create dialog a location hint and sibling names from viewName/groups', async () => {
    setup({ viewName: 'Research' })
    fireEvent.click(screen.getByText('sources.grouping.newGroup'))
    expect(await screen.findByTestId('group-location-hint')).toBeInTheDocument()
    const chips = screen.getByTestId('sibling-folder-chips')
    expect(chips.textContent).toContain('parent')
  })

  it('selects a group on click', () => {
    const props = setup()
    fireEvent.click(screen.getByText('parent'))
    expect(props.onSelect).toHaveBeenCalledWith('source_group:parent')
  })

  it('selects anchors with their sentinel values', () => {
    const props = setup()
    fireEvent.click(screen.getByText('sources.grouping.all'))
    fireEvent.click(screen.getByText('sources.grouping.ungrouped'))
    expect(props.onSelect).toHaveBeenNthCalledWith(1, 'all')
    expect(props.onSelect).toHaveBeenNthCalledWith(2, 'ungrouped')
  })

  it('offers a root-level new group action', () => {
    setup()
    expect(screen.getByText('sources.grouping.newGroup')).toBeInTheDocument()
  })

  it('submits a new root group through the name dialog', async () => {
    const props = setup()
    fireEvent.click(screen.getByText('sources.grouping.newGroup'))
    const input = await screen.findByPlaceholderText('sources.grouping.groupNamePlaceholder')
    fireEvent.change(input, { target: { value: 'Research' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() =>
      expect(props.onCreateGroup).toHaveBeenCalledWith('Research', null)
    )
  })

  it('renames a group from its hover menu', async () => {
    const props = setup()
    // Radix menus open on pointerdown; the first menu belongs to the root row
    const trigger = (await screen.findAllByRole('button', { name: 'sources.grouping.groupOptions' }))[0]
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByText('common.edit'))
    const input = await screen.findByDisplayValue('parent')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(props.onRenameGroup).toHaveBeenCalledWith('source_group:parent', 'Renamed'))
  })

  it('deletes a group without sources by default', async () => {
    const props = setup()
    const trigger = (await screen.findAllByRole('button', { name: 'sources.grouping.groupOptions' }))[0]
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const deletes = await screen.findAllByText('common.delete')
    fireEvent.click(deletes[deletes.length - 1])
    // default: sources move to ungrouped (delete_sources=false)
    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(props.onDeleteGroup).toHaveBeenCalledWith('source_group:parent', false))
  })

  it('opens the node context menu on right-click and renames through it', async () => {
    const props = setup()
    // contextmenu bubbles from the label up to the node row carrying the trigger
    fireEvent.contextMenu(screen.getByText('parent'))

    expect(screen.getByText('sources.grouping.newSubgroup')).toBeInTheDocument()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
    expect(screen.getAllByText('common.delete').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('common.edit'))
    const input = await screen.findByDisplayValue('parent')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(props.onRenameGroup).toHaveBeenCalledWith('source_group:parent', 'Renamed'))
  })

  it('starts a new subfolder from the node context menu', async () => {
    const props = setup()
    fireEvent.contextMenu(screen.getByText('parent'))
    fireEvent.click(screen.getByText('sources.grouping.newSubgroup'))

    const input = await screen.findByPlaceholderText('sources.grouping.groupNamePlaceholder')
    fireEvent.change(input, { target: { value: 'Child2' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(props.onCreateGroup).toHaveBeenCalledWith('Child2', 'source_group:parent'))
  })

  it('moves a group via the context menu with itself and descendants unpickable', async () => {
    const props = setup({
      groups: [group('parent', null, 1), group('child', 'parent'), group('other')],
    })
    fireEvent.contextMenu(screen.getByText('parent'))
    fireEvent.click(screen.getByText('sources.grouping.moveTo'))

    // move-target validation: the moved group and its descendant are disabled rows
    const confirm = await screen.findByRole('button', { name: 'sources.grouping.moveHere' })
    expect(screen.getByRole('radio', { name: /parent/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /child/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /other/ })).toBeEnabled()

    fireEvent.click(screen.getByRole('radio', { name: /other/ }))
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(props.onMoveGroup).toHaveBeenCalledWith('source_group:parent', 'source_group:other')
    )
  })

  it('keeps the name dialog open for retry when onCreateGroup rejects', async () => {
    const props = setup()
    ;(props.onCreateGroup as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('dup'))
    fireEvent.contextMenu(screen.getByText('parent'))
    fireEvent.click(screen.getByText('sources.grouping.newSubgroup'))
    fireEvent.change(await screen.findByPlaceholderText('sources.grouping.groupNamePlaceholder'), {
      target: { value: 'X' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(props.onCreateGroup).toHaveBeenCalled())
    // 弹窗保持打开：输入还在，重试不用重敲
    expect(screen.getByTestId('group-name-input')).toBeInTheDocument()
  })

  it('disables move targets that would push the subtree past the depth limit', async () => {
    setup({
      groups: [
        group('parent', null, 1),
        group('child', 'parent'),
        group('a'),
        group('b', 'a'),
        group('c', 'b'),
        group('d', 'c'),
      ],
    })
    fireEvent.contextMenu(screen.getByText('parent'))
    fireEvent.click(screen.getByText('sources.grouping.moveTo'))
    await screen.findByRole('button', { name: 'sources.grouping.moveHere' })
    // moving parent (height 2) under d (depth 4) → 4+2 > 5; under b (depth 2) fits
    expect(screen.getByRole('radio', { name: /^d/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /^b/ })).toBeEnabled()
  })

  it('creates inside the browsed folder from the tree-bottom button', async () => {
    const props = setup({ selected: 'source_group:parent' })
    fireEvent.click(screen.getByText('sources.grouping.newGroup'))
    fireEvent.change(await screen.findByPlaceholderText('sources.grouping.groupNamePlaceholder'), {
      target: { value: 'Sub' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() =>
      expect(props.onCreateGroup).toHaveBeenCalledWith('Sub', 'source_group:parent')
    )
  })

  it('disables the tree-bottom new-folder button at the max depth', () => {
    setup({
      groups: [
        group('a'),
        group('b', 'a'),
        group('c', 'b'),
        group('d', 'c'),
        group('e', 'd'),
      ],
      selected: 'source_group:e',
    })
    expect(
      (screen.getByText('sources.grouping.newGroup').closest('button') as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('hides new-subfolder in the context menu at the max tree depth', () => {
    setup({
      groups: [
        group('a'),
        group('b', 'a'),
        group('c', 'b'),
        group('d', 'c'),
        group('e', 'd'),
      ],
    })
    // 'e' sits at depth 5 (MAX_TREE_DEPTH), so it can no longer have children
    fireEvent.contextMenu(screen.getByText('e'))
    expect(screen.queryByText('sources.grouping.newSubgroup')).toBeNull()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
  })

  describe('file_type view (read-only)', () => {
    it('renders link/text anchors plus one anchor per file extension', () => {
      setup({
        activeViewId: 'file_type',
        typeGroups: [
          { key: 'pdf', count: 12 },
          { key: 'docx', count: 3 },
          { key: 'other', count: 1 },
        ],
      })
      expect(screen.getByText('sources.type.link')).toBeInTheDocument()
      expect(screen.getByText('sources.type.text')).toBeInTheDocument()
      expect(screen.getByText('PDF')).toBeInTheDocument()
      expect(screen.getByText('DOCX')).toBeInTheDocument()
      expect(screen.getByText('sources.type.other')).toBeInTheDocument()
      // The old whole-file group is gone
      expect(screen.queryByText('sources.type.file')).toBeNull()
      expect(screen.queryByText('sources.grouping.newGroup')).toBeNull()
      expect(screen.queryByText('sources.grouping.ungrouped')).toBeNull()
    })

    it('selects virtual groups by their source type value', () => {
      const props = setup({ activeViewId: 'file_type' })
      fireEvent.click(screen.getByText('sources.type.link'))
      expect(props.onSelect).toHaveBeenCalledWith('link')
    })

    it('selects an extension group by its lowercased key', () => {
      const props = setup({ activeViewId: 'file_type', typeGroups: [{ key: 'pdf', count: 2 }] })
      fireEvent.click(screen.getByText('PDF'))
      expect(props.onSelect).toHaveBeenCalledWith('pdf')
    })

    it('shows a spinner while type groups load', () => {
      setup({ activeViewId: 'file_type', typeGroupsLoading: true })
      expect(screen.getByTestId('type-groups-loading')).toBeInTheDocument()
    })

    it('renders only the fixed anchors with no extension data', () => {
      setup({ activeViewId: 'file_type', typeGroups: [] })
      expect(screen.queryByTestId('type-groups-loading')).toBeNull()
      expect(screen.getByText('sources.type.link')).toBeInTheDocument()
      expect(screen.getByText('sources.type.text')).toBeInTheDocument()
    })
  })
})

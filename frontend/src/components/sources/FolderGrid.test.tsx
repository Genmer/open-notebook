import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { SourceGroupResponse } from '@/lib/types/api'
import { FolderGrid } from './FolderGrid'

// t returns the key string (setup.ts).

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

const setup = (overrides: Partial<Parameters<typeof FolderGrid>[0]> = {}) => {
  const props: Parameters<typeof FolderGrid>[0] = {
    viewName: 'Research',
    groups: [group('a', null, 1), group('b'), group('child', 'a', 2)],
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

describe('FolderGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders root folders as tiles including empty ones with a 0 badge', () => {
    setup()
    expect(screen.getByTestId('folder-tile-source_group:a').textContent).toContain('1')
    // 空文件夹必须可见且徽章显示 0（用户"以为没有文件夹"的根源）
    const emptyTile = screen.getByTestId('folder-tile-source_group:b')
    expect(emptyTile.textContent).toContain('0')
    expect(screen.getByTestId('folder-tile-ungrouped')).toBeInTheDocument()
    expect(screen.getByTestId('folder-tile-new')).toBeInTheDocument()
  })

  it('shows only the children of the browsed folder (no root siblings, no ungrouped tile)', () => {
    setup({ selected: 'source_group:a' })
    expect(screen.getByTestId('folder-tile-source_group:child')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-tile-source_group:a')).toBeNull()
    expect(screen.queryByTestId('folder-tile-source_group:b')).toBeNull()
    expect(screen.queryByTestId('folder-tile-ungrouped')).toBeNull()
  })

  it('keeps the subfolder hint when a browsed folder has no children', () => {
    setup({ selected: 'source_group:b', variant: 'subfolder' })
    expect(screen.getByTestId('folder-grid-empty')).toHaveTextContent('sources.grouping.noSubfolders')
    expect(screen.getByTestId('folder-tile-new')).toBeInTheDocument()
  })

  it('navigates on tile and ungrouped clicks', () => {
    const props = setup()
    fireEvent.click(screen.getByTestId('folder-tile-source_group:a'))
    expect(props.onSelect).toHaveBeenCalledWith('source_group:a')
    fireEvent.click(screen.getByTestId('folder-tile-ungrouped'))
    expect(props.onSelect).toHaveBeenLastCalledWith('ungrouped')
  })

  it('highlights only the tile matching highlightId', () => {
    setup({ highlightId: 'source_group:b' })
    expect(screen.getByTestId('folder-tile-source_group:b')).toHaveAttribute('data-highlight', 'true')
    expect(screen.getByTestId('folder-tile-source_group:a')).not.toHaveAttribute('data-highlight')
  })

  it('shows the persistent AI overwrite hint on AI views', () => {
    setup({ isAiView: true })
    expect(screen.getByTestId('folder-grid-ai-hint')).toHaveTextContent('sources.grouping.aiOverwriteHint')
  })

  it('shows no AI hint on custom views', () => {
    setup()
    expect(screen.queryByTestId('folder-grid-ai-hint')).toBeNull()
  })

  it('replaces tiles with a spinner while loading', () => {
    setup({ isLoading: true })
    expect(screen.getByTestId('folder-grid-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-tile-source_group:a')).toBeNull()
  })

  it('delegates the new-folder tile to the page-level dialog', () => {
    const props = setup()
    fireEvent.click(screen.getByTestId('folder-tile-new'))
    expect(props.onNewFolder).toHaveBeenCalledTimes(1)
  })

  it('opens the shared context menu on tile right-click and creates a subfolder with the parentId', async () => {
    const props = setup()
    fireEvent.contextMenu(screen.getByTestId('folder-tile-source_group:a'))

    expect(screen.getByText('sources.grouping.newSubgroup')).toBeInTheDocument()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
    expect(screen.getAllByText('common.delete').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('sources.grouping.newSubgroup'))
    const input = await screen.findByTestId('group-name-input')
    // 子夹落点提示与同级列表（a 的子夹 child）
    expect(screen.getByTestId('group-location-hint')).toBeInTheDocument()
    expect(screen.getByTestId('sibling-folder-chips').textContent).toContain('child')

    fireEvent.change(input, { target: { value: 'GrandChild' } })
    fireEvent.click(screen.getByTestId('group-name-save'))
    await waitFor(() =>
      expect(props.onCreateGroup).toHaveBeenCalledWith('GrandChild', 'source_group:a')
    )
  })

  it('renames a folder through the tile context menu', async () => {
    const props = setup()
    fireEvent.contextMenu(screen.getByTestId('folder-tile-source_group:a'))
    fireEvent.click(screen.getByText('common.edit'))

    const input = await screen.findByDisplayValue('a')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByTestId('group-name-save'))
    await waitFor(() =>
      expect(props.onRenameGroup).toHaveBeenCalledWith('source_group:a', 'Renamed')
    )
  })
})

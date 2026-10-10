import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  SourceContextMenuContent,
  GroupContextMenuContent,
} from './SourceContextMenu'

// t returns the key string (setup.ts). Radix context menus open on the
// contextmenu event, so fireEvent.contextMenu needs no pointer emulation.

function renderSourceMenu(props: React.ComponentProps<typeof SourceContextMenuContent>) {
  return render(
    <ContextMenu>
      <ContextMenuTrigger data-testid="ctx-trigger">target</ContextMenuTrigger>
      <SourceContextMenuContent {...props} />
    </ContextMenu>
  )
}

function renderGroupMenu(props: React.ComponentProps<typeof GroupContextMenuContent>) {
  return render(
    <ContextMenu>
      <ContextMenuTrigger data-testid="ctx-trigger">folder</ContextMenuTrigger>
      <GroupContextMenuContent {...props} />
    </ContextMenu>
  )
}

const handlers = () => ({
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onMove: vi.fn(),
  onCopy: vi.fn(),
  onNewFolder: vi.fn(),
  onUngroup: vi.fn(),
  onRemoveFromNotebook: vi.fn(),
  onDelete: vi.fn(),
})

describe('SourceContextMenuContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens on contextmenu and shows the full item set', () => {
    renderSourceMenu(handlers())
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    expect(screen.getByText('sources.grouping.openSource')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveToFolder')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.copyTo')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.newFolder')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungroupAction')).toBeInTheDocument()
    expect(screen.getByText('sources.removeFromNotebook')).toBeInTheDocument()
    expect(screen.getByText('sources.deleteSource')).toBeInTheDocument()
  })

  it.each([
    ['sources.grouping.openSource', 'onOpen'],
    ['sources.grouping.renameSource', 'onRename'],
    ['sources.grouping.moveToFolder', 'onMove'],
    ['sources.grouping.copyTo', 'onCopy'],
    ['sources.grouping.newFolder', 'onNewFolder'],
    ['sources.grouping.ungroupAction', 'onUngroup'],
    ['sources.removeFromNotebook', 'onRemoveFromNotebook'],
    ['sources.deleteSource', 'onDelete'],
  ] as const)('clicking %s fires its handler', (label, handler) => {
    const props = handlers()
    renderSourceMenu(props)
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))
    fireEvent.click(screen.getByText(label))
    expect(props[handler]).toHaveBeenCalledTimes(1)
  })

  it('renders only items whose handlers are provided', () => {
    renderSourceMenu({ onRename: vi.fn() })
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.queryByText('sources.grouping.openSource')).toBeNull()
    expect(screen.queryByText('sources.grouping.moveToFolder')).toBeNull()
    expect(screen.queryByText('sources.grouping.copyTo')).toBeNull()
    expect(screen.queryByText('sources.grouping.newFolder')).toBeNull()
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
    expect(screen.queryByText('sources.removeFromNotebook')).toBeNull()
    expect(screen.queryByText('sources.deleteSource')).toBeNull()
  })

  it('trims every folder item in the file_type view', () => {
    renderSourceMenu({ ...handlers(), isFileTypeView: true })
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    expect(screen.queryByText('sources.grouping.moveToFolder')).toBeNull()
    expect(screen.queryByText('sources.grouping.copyTo')).toBeNull()
    expect(screen.queryByText('sources.grouping.newFolder')).toBeNull()
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
    // Non-folder items survive
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('sources.deleteSource')).toBeInTheDocument()
  })

  it('hides ungroup when hideUngroup is set (browsing the ungrouped list)', () => {
    renderSourceMenu({ ...handlers(), hideUngroup: true })
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
    expect(screen.getByText('sources.grouping.moveToFolder')).toBeInTheDocument()
  })

  it('renders the copy-path trio only when handlers are provided', () => {
    renderSourceMenu({ onRename: vi.fn() })
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    expect(screen.queryByText('sources.copyFileName')).toBeNull()
    expect(screen.queryByText('sources.copyRelativePath')).toBeNull()
    expect(screen.queryByText('sources.copyAbsolutePath')).toBeNull()
  })

  it.each([
    ['sources.copyFileName', 'onCopyFileName'],
    ['sources.copyRelativePath', 'onCopyRelativePath'],
    ['sources.copyAbsolutePath', 'onCopyAbsolutePath'],
  ] as const)('clicking %s fires its handler', (label, handler) => {
    const props = {
      ...handlers(),
      onCopyFileName: vi.fn(),
      onCopyRelativePath: vi.fn(),
      onCopyAbsolutePath: vi.fn(),
    }
    renderSourceMenu(props)
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))
    fireEvent.click(screen.getByText(label))
    expect(props[handler]).toHaveBeenCalledTimes(1)
  })

  it('greys out copy absolute path when disableCopyAbsolutePath is set', () => {
    renderSourceMenu({
      ...handlers(),
      onCopyFileName: vi.fn(),
      onCopyRelativePath: vi.fn(),
      onCopyAbsolutePath: vi.fn(),
      disableCopyAbsolutePath: true,
    })
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    const item = screen.getByText('sources.copyAbsolutePath').closest('[role="menuitem"]')
    expect(item).not.toBeNull()
    expect(item).toHaveAttribute('data-disabled', '')

    // 其余两个复制项不受置灰影响
    expect(screen.getByText('sources.copyFileName')).toBeInTheDocument()
    expect(screen.getByText('sources.copyRelativePath')).toBeInTheDocument()
  })
})

describe('GroupContextMenuContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the folder item set with new-subfolder gated by canHaveChildren', () => {
    const props = {
      canHaveChildren: true,
      onNewSubgroup: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onDelete: vi.fn(),
    }
    renderGroupMenu(props)
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    expect(screen.getByText('sources.grouping.newSubgroup')).toBeInTheDocument()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
    expect(screen.getByText('common.delete')).toBeInTheDocument()

    fireEvent.click(screen.getByText('sources.grouping.newSubgroup'))
    expect(props.onNewSubgroup).toHaveBeenCalledTimes(1)
  })

  it('omits new-subfolder beyond the max tree depth', () => {
    renderGroupMenu({ canHaveChildren: false, onNewSubgroup: vi.fn(), onRename: vi.fn(), onMove: vi.fn(), onDelete: vi.fn() })
    fireEvent.contextMenu(screen.getByTestId('ctx-trigger'))

    expect(screen.queryByText('sources.grouping.newSubgroup')).toBeNull()
    expect(screen.getByText('common.edit')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SourceListResponse } from '@/lib/types/api'
import { SourceRowActionsMenu } from './SourceRowActionsMenu'

function source(): SourceListResponse {
  return {
    id: 'source:a',
    title: 'A',
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-01-01T00:00:00',
    updated: '2026-01-01T00:00:00',
  }
}

const setup = (overrides: Partial<Parameters<typeof SourceRowActionsMenu>[0]> = {}) => {
  const props: Parameters<typeof SourceRowActionsMenu>[0] = {
    source: source(),
    isFileTypeView: false,
    hideUngroup: false,
    onRename: vi.fn(),
    onMove: vi.fn(),
    onCopy: vi.fn(),
    onUngroup: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<SourceRowActionsMenu {...props} />)
  return props
}

// Radix menus open via keydown before click, like the GroupTree tests
const openMenu = async () => {
  const trigger = screen.getByTestId('source-row-actions-trigger')
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
}

describe('SourceRowActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows all five actions in a groupable view', async () => {
    setup()
    await openMenu()
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.copyTo')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungroupAction')).toBeInTheDocument()
    expect(screen.getByText('common.delete')).toBeInTheDocument()
  })

  it('offers only rename and delete in the file_type view', async () => {
    setup({ isFileTypeView: true })
    await openMenu()
    expect(screen.getByText('sources.grouping.renameSource')).toBeInTheDocument()
    expect(screen.getByText('common.delete')).toBeInTheDocument()
    expect(screen.queryByText('sources.grouping.moveTo')).toBeNull()
    expect(screen.queryByText('sources.grouping.copyTo')).toBeNull()
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
  })

  it('hides the ungroup action when requested (ungrouped list)', async () => {
    setup({ hideUngroup: true })
    await openMenu()
    expect(screen.queryByText('sources.grouping.ungroupAction')).toBeNull()
    expect(screen.getByText('sources.grouping.moveTo')).toBeInTheDocument()
  })

  it('invokes each callback with the row source', async () => {
    const props = setup()
    // Radix closes the menu after each click, so reopen per action
    const clickAction = async (label: string) => {
      await openMenu()
      fireEvent.click(screen.getByText(label))
    }

    await clickAction('sources.grouping.renameSource')
    await clickAction('sources.grouping.moveTo')
    await clickAction('sources.grouping.copyTo')
    await clickAction('sources.grouping.ungroupAction')
    await clickAction('common.delete')

    expect(props.onRename).toHaveBeenCalledWith(props.source)
    expect(props.onMove).toHaveBeenCalledWith(props.source)
    expect(props.onCopy).toHaveBeenCalledWith(props.source)
    expect(props.onUngroup).toHaveBeenCalledWith(props.source)
    expect(props.onDelete).toHaveBeenCalledWith(props.source)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { BulkActionBar, chunkIds, MEMBER_BATCH_SIZE } from './BulkActionBar'

describe('chunkIds', () => {
  it('returns a single chunk when under the batch size', () => {
    const ids = Array.from({ length: 99 }, (_, i) => `s${i}`)
    expect(chunkIds(ids)).toEqual([ids])
  })

  it('splits exactly at the batch size boundary', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `s${i}`)
    expect(chunkIds(ids)).toHaveLength(1)
    expect(chunkIds([...ids, 'extra'])).toHaveLength(2)
  })

  it('splits large batches preserving order and chunk size', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `s${i}`)
    const chunks = chunkIds(ids, 100)
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50])
    expect(chunks.flat()).toEqual(ids)
  })

  it('returns no chunks for an empty batch', () => {
    expect(chunkIds([])).toEqual([])
  })

  it('uses MEMBER_BATCH_SIZE of 100', () => {
    expect(MEMBER_BATCH_SIZE).toBe(100)
  })

  it('rejects a non-positive size', () => {
    expect(() => chunkIds(['a'], 0)).toThrow()
  })
})

describe('BulkActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderBar = (overrides: Partial<Parameters<typeof BulkActionBar>[0]> = {}) => {
    const props: Parameters<typeof BulkActionBar>[0] = {
      selectedCount: 2,
      loadedCount: 2,
      onMove: vi.fn(),
      onCopy: vi.fn(),
      onUngroup: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onClear: vi.fn(),
      ...overrides,
    }
    render(<BulkActionBar {...props} />)
    return props
  }

  it('shows the selected count and page hint when more are loaded', () => {
    renderBar({ selectedCount: 5, loadedCount: 30 })
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.selectedCount', { exact: false })).toBeInTheDocument()
    expect(
      screen.getByText('sources.grouping.selectedPageHint', { exact: false })
    ).toBeInTheDocument()
  })

  it('hides the page hint when everything loaded is selected', () => {
    renderBar({ selectedCount: 30, loadedCount: 30 })
    expect(
      screen.queryByText('sources.grouping.selectedPageHint', { exact: false })
    ).toBeNull()
  })

  it('fires the matching callback for each action', () => {
    const props = renderBar()

    fireEvent.click(screen.getByText('sources.grouping.moveToGroup'))
    fireEvent.click(screen.getByText('sources.grouping.copyToGroup'))
    fireEvent.click(screen.getByText('sources.grouping.ungroupAction'))
    fireEvent.click(screen.getByText('sources.grouping.batchRename'))
    fireEvent.click(screen.getByText('sources.grouping.batchDelete'))
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(props.onMove).toHaveBeenCalledTimes(1)
    expect(props.onCopy).toHaveBeenCalledTimes(1)
    expect(props.onUngroup).toHaveBeenCalledTimes(1)
    expect(props.onRename).toHaveBeenCalledTimes(1)
    expect(props.onDelete).toHaveBeenCalledTimes(1)
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })
})

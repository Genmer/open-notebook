import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { SourceListResponse } from '@/lib/types/api'
import { BatchRenameDialog } from './BatchRenameDialog'

function source(id: string, title: string): SourceListResponse {
  return {
    id: `source:${id}`,
    title,
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-01-01T00:00:00',
    updated: '2026-01-01T00:00:00',
  }
}

const setup = (sources: SourceListResponse[]) => {
  const onApply = vi.fn().mockResolvedValue(undefined)
  const props: Parameters<typeof BatchRenameDialog>[0] = {
    open: true,
    sources,
    onApply,
    onOpenChange: vi.fn(),
  }
  render(<BatchRenameDialog {...props} />)
  return { ...props, onApply }
}

describe('BatchRenameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows every source unchanged until a rule is entered', () => {
    setup([source('a', 'Report'), source('b', 'Notes')])
    expect(screen.getAllByTestId('batch-rename-preview-row')).toHaveLength(2)
    expect(screen.getByText('sources.grouping.noChanges')).toBeInTheDocument()
    expect(screen.getByTestId('batch-rename-apply')).toBeDisabled()
  })

  it('previews prefix, suffix and find/replace live as rules change', () => {
    setup([source('a', 'Report'), source('b', 'Notes')])

    fireEvent.change(screen.getByTestId('batch-rename-prefix'), { target: { value: 'P-' } })
    expect(screen.getByText('P-Report')).toBeInTheDocument()
    expect(screen.getByText('P-Notes')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('batch-rename-find'), { target: { value: 'Report' } })
    fireEvent.change(screen.getByTestId('batch-rename-replace'), { target: { value: 'Paper' } })
    expect(screen.getByText('P-Paper')).toBeInTheDocument()
    // find targets only matching rows
    expect(screen.getByText('P-Notes')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('batch-rename-suffix'), { target: { value: '.md' } })
    expect(screen.getByText('P-Paper.md')).toBeInTheDocument()
  })

  it('applies only the changed items', async () => {
    const props = setup([source('a', 'Report'), source('b', 'Notes')])
    fireEvent.change(screen.getByTestId('batch-rename-find'), { target: { value: 'Report' } })
    fireEvent.change(screen.getByTestId('batch-rename-replace'), { target: { value: 'Paper' } })

    fireEvent.click(screen.getByTestId('batch-rename-apply'))
    await waitFor(() =>
      expect(props.onApply).toHaveBeenCalledWith([{ id: 'source:a', title: 'Paper' }])
    )
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('marks unchanged rows as unchanged and disables apply', () => {
    setup([source('a', 'Report'), source('b', 'Notes')])
    fireEvent.change(screen.getByTestId('batch-rename-find'), { target: { value: 'zzz' } })
    fireEvent.change(screen.getByTestId('batch-rename-replace'), { target: { value: 'x' } })

    expect(screen.getAllByText('sources.grouping.previewUnchanged')).toHaveLength(2)
    expect(screen.getByText('sources.grouping.noChanges')).toBeInTheDocument()
    expect(screen.getByTestId('batch-rename-apply')).toBeDisabled()
  })

  it('warns about the serial write only above 50 items', () => {
    const many = Array.from({ length: 51 }, (_, i) => source(`s${i}`, `Title ${i}`))
    setup(many)
    expect(screen.getByTestId('batch-rename-slow-hint')).toBeInTheDocument()
  })

  it('hides the slow hint at or below 50 items', () => {
    const few = Array.from({ length: 50 }, (_, i) => source(`s${i}`, `Title ${i}`))
    setup(few)
    expect(screen.queryByTestId('batch-rename-slow-hint')).toBeNull()
  })

  it('keeps the dialog open when apply rejects', async () => {
    const { onApply, onOpenChange } = setup([source('a', 'Report')])
    onApply.mockRejectedValue(new Error('boom'))
    fireEvent.change(screen.getByTestId('batch-rename-prefix'), { target: { value: 'P-' } })
    fireEvent.click(screen.getByTestId('batch-rename-apply'))

    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

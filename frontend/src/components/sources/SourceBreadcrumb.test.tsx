import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SourceGroupResponse } from '@/lib/types/api'
import { SourceBreadcrumb } from './SourceBreadcrumb'

function group(id: string, name: string): SourceGroupResponse {
  return {
    id: `source_group:${id}`,
    view_id: 'source_view:v1',
    name,
    parent_id: null,
    source_count: 0,
    created: null,
    updated: null,
  }
}

const setup = (overrides: Partial<Parameters<typeof SourceBreadcrumb>[0]> = {}) => {
  const props: Parameters<typeof SourceBreadcrumb>[0] = {
    viewName: 'Research',
    chain: [group('root', 'Root'), group('mid', 'Mid')],
    currentLabel: 'Leaf',
    onNavigate: vi.fn(),
    isFileTypeView: false,
    ...overrides,
  }
  render(<SourceBreadcrumb {...props} />)
  return props
}

describe('SourceBreadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders view name, ancestor chain and the plain leaf', () => {
    setup()
    expect(screen.getByTestId('source-breadcrumb')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Research' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Root' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mid' })).toBeInTheDocument()
    expect(screen.getByTestId('breadcrumb-current')).toHaveTextContent('Leaf')
  })

  it('navigates to a clicked ancestor by its id', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Root' }))
    expect(props.onNavigate).toHaveBeenCalledWith('source_group:root')
  })

  it('navigates to all when the view segment is clicked', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    expect(props.onNavigate).toHaveBeenCalledWith('all')
  })

  it('renders a plain view name only when browsing the root', () => {
    setup({ chain: [], currentLabel: '' })
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('breadcrumb-current')).toBeNull()
  })

  it('renders the ungrouped leaf without ancestors', () => {
    setup({ chain: [], currentLabel: 'sources.grouping.ungrouped' })
    expect(screen.getByRole('button', { name: 'Research' })).toBeInTheDocument()
    expect(screen.getByTestId('breadcrumb-current')).toHaveTextContent('sources.grouping.ungrouped')
  })

  it('file_type view shows the tab plus a clickable bucket that returns to all', () => {
    const props = setup({
      isFileTypeView: true,
      viewName: 'sources.grouping.fileTypeTab',
      chain: [],
      currentLabel: 'PDF',
      bucketLabel: 'PDF',
    })
    expect(screen.getByText('sources.grouping.fileTypeTab')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
    expect(props.onNavigate).toHaveBeenCalledWith('all')
  })

  it('file_type view without a bucket has no clickable segments', () => {
    setup({
      isFileTypeView: true,
      viewName: 'sources.grouping.fileTypeTab',
      chain: [],
      currentLabel: '',
      bucketLabel: undefined,
    })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'

// Native-select stand-in for the Radix Select (jsdom-friendly)
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select
      data-testid="folder-target-view-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

const viewsMock = [
  {
    id: 'source_view:ai_content', name: 'AI Content', view_type: 'ai_content' as const,
    is_default: true, last_classified_at: null, classify_progress: null, created: null, updated: null,
  },
  {
    id: 'source_view:v1', name: 'Research', view_type: 'custom' as const,
    is_default: false, last_classified_at: null, classify_progress: null, created: null, updated: null,
  },
]
const groupsV1 = [
  {
    id: 'source_group:g1', view_id: 'source_view:v1', name: 'G1',
    parent_id: null, source_count: 0, created: null, updated: null,
  },
]

const { viewGroupsData } = vi.hoisted(() => ({ viewGroupsData: vi.fn() }))

vi.mock('@/lib/hooks/use-source-views', () => ({
  useSourceViews: () => ({ data: viewsMock }),
  useViewGroups: (viewId?: string | null) => viewGroupsData(viewId),
}))

import { FolderTargetSection, type FolderTargetValue } from './FolderTargetSection'

const defaultGroupsQuery = (viewId?: string | null) => ({
  data: viewId === 'source_view:v1' ? groupsV1 : [],
})

const setup = (overrides: Partial<Parameters<typeof FolderTargetSection>[0]> = {}) => {
  const props: Parameters<typeof FolderTargetSection>[0] = {
    value: null,
    onChange: vi.fn(),
    ...overrides,
  }
  render(<FolderTargetSection {...props} />)
  return props
}

describe('FolderTargetSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    viewGroupsData.mockImplementation(defaultGroupsQuery)
  })

  it('lists only folder-capable views (no file_type tab)', () => {
    setup()
    const select = screen.getByTestId('folder-target-view-select') as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['source_view:ai_content', 'source_view:v1'])
  })

  it('defaults to no folder', () => {
    setup()
    const none = screen.getByLabelText('sources.grouping.noFolderOption') as HTMLInputElement
    expect(none.checked).toBe(true)
  })

  it('selecting a folder reports view + group and checks the row', () => {
    // Stateful harness: the section is controlled by the parent's value
    const Harness = () => {
      const [value, setValue] = useState<FolderTargetValue | null>(null)
      return <FolderTargetSection value={value} onChange={setValue} />
    }
    render(<Harness />)
    fireEvent.change(screen.getByTestId('folder-target-view-select'), {
      target: { value: 'source_view:v1' },
    })
    fireEvent.click(screen.getByLabelText('G1'))

    expect((screen.getByLabelText('G1') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('sources.grouping.noFolderOption') as HTMLInputElement).checked).toBe(false)
  })

  it('switching views clears a previously picked folder from another view', () => {
    const props = setup({
      value: { viewId: 'source_view:v1', groupId: 'source_group:g1' },
    })
    fireEvent.change(screen.getByTestId('folder-target-view-select'), {
      target: { value: 'source_view:ai_content' },
    })
    expect(props.onChange).toHaveBeenCalledWith(null)
  })

  it('shows the AI overwrite hint on AI views only', () => {
    setup()
    // default resolved view is the first groupable view (ai_content)
    expect(screen.getByTestId('folder-target-ai-hint')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('folder-target-view-select'), {
      target: { value: 'source_view:v1' },
    })
    expect(screen.queryByTestId('folder-target-ai-hint')).toBeNull()
  })

  it('shows the empty-folder hint for a view without folders', () => {
    setup()
    fireEvent.change(screen.getByTestId('folder-target-view-select'), {
      target: { value: 'source_view:ai_content' },
    })
    expect(screen.getByText('sources.grouping.noGroups')).toBeInTheDocument()
  })
})

describe('FolderTargetSection collapsible bar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    viewGroupsData.mockImplementation(defaultGroupsQuery)
  })

  it('renders the compact bar instead of the full picker when collapsible', () => {
    setup({ collapsible: true })
    expect(screen.getByTestId('folder-target-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-target-section')).toBeNull()
  })

  it('bar shows "no folder" while nothing is picked', () => {
    setup({ collapsible: true })
    expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent(
      'sources.grouping.noFolderOption'
    )
  })

  it('bar shows the picked folder with its view name', () => {
    setup({ collapsible: true, value: { viewId: 'source_view:v1', groupId: 'source_group:g1' } })
    expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent('G1')
    expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent('Research')
  })

  it('change button expands the picker; Done collapses back to the bar', () => {
    setup({ collapsible: true })
    fireEvent.click(screen.getByTestId('folder-target-change-button'))
    expect(screen.getByTestId('folder-target-section')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-target-bar')).toBeNull()

    fireEvent.click(screen.getByTestId('folder-target-done-button'))
    expect(screen.queryByTestId('folder-target-section')).toBeNull()
    expect(screen.getByTestId('folder-target-bar')).toBeInTheDocument()
  })
})

describe('FolderTargetSection stale-folder fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears the pick once groups load without its folder', () => {
    viewGroupsData.mockReturnValue({ data: [] })
    const props = setup({ value: { viewId: 'source_view:v1', groupId: 'source_group:gone' } })
    expect(props.onChange).toHaveBeenCalledWith(null)
  })

  it('keeps a nested-folder pick that is present in the flattened tree', () => {
    viewGroupsData.mockImplementation(() => ({
      data: [
        groupsV1[0],
        { ...groupsV1[0], id: 'source_group:g1-child', name: 'Child', parent_id: 'source_group:g1' },
      ],
    }))
    const props = setup({
      value: { viewId: 'source_view:v1', groupId: 'source_group:g1-child' },
    })
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('keeps the pick while groups are still loading', () => {
    viewGroupsData.mockReturnValue({ data: undefined })
    const props = setup({ value: { viewId: 'source_view:v1', groupId: 'source_group:g1' } })
    expect(props.onChange).not.toHaveBeenCalled()
  })
})

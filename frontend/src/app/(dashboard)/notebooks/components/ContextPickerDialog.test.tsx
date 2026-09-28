import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextPickerDialog } from './ContextPickerDialog'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import type { ContextSelections } from '@/lib/types/notebook-context'

vi.mock('@/lib/hooks/use-context-tree')

const treeData = {
  sources: [
    { id: 's1', title: '范文一', insights_count: 2 },
    { id: 's2', title: '范文二', insights_count: 0 },
    { id: 's3', title: '零散来源', insights_count: 0 },
  ],
  groups: [{ id: 'g1', name: '论文夹', parent_id: null }],
  memberships: [
    { source_id: 's1', group_id: 'g1' },
    { source_id: 's2', group_id: 'g1' },
  ],
}

function mockTree(overrides: Partial<Record<string, unknown>> = {}) {
  vi.mocked(useContextTree).mockReturnValue({
    data: treeData,
    isLoading: false,
    isSuccess: true,
    isError: false,
    ...overrides,
  } as unknown as ReturnType<typeof useContextTree>)
}

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  notebookId: 'nb1',
  viewId: 'view1' as string | null,
  sources: [] as never[],
  notes: [{ id: 'n1', title: '我的笔记' }],
  selections: {
    sources: { s1: 'insights' },
    notes: { n1: 'full' },
  } as ContextSelections,
  onSourceModeChange: vi.fn(),
  onFolderApply: vi.fn(),
  onNoteModeChange: vi.fn(),
  onClearAll: vi.fn(),
}

describe('ContextPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTree()
  })

  it('renders folder tree, ungrouped bucket and notes section', () => {
    render(<ContextPickerDialog {...baseProps} />)

    expect(screen.getByText('论文夹')).toBeInTheDocument()
    expect(screen.getByText('范文一')).toBeInTheDocument()
    expect(screen.getByText('范文二')).toBeInTheDocument()
    expect(screen.getByText('零散来源')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungrouped')).toBeInTheDocument()
    expect(screen.getByText('chat.contextNotesSection')).toBeInTheDocument()
    expect(screen.getByText('我的笔记')).toBeInTheDocument()
  })

  it('cycles a source mode via its toggle', () => {
    render(<ContextPickerDialog {...baseProps} />)

    const row = screen.getByText('范文一').closest('[class*="justify-between"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button'))

    // insights -> full (has insights, three-state cycle)
    expect(baseProps.onSourceModeChange).toHaveBeenCalledWith('s1', 'full')
  })

  it('source checkbox includes the source with full content', () => {
    render(<ContextPickerDialog {...baseProps} />)

    // 零散来源 is off; checking the box pulls the full text into context.
    fireEvent.click(screen.getByLabelText('零散来源'))
    expect(baseProps.onSourceModeChange).toHaveBeenCalledWith('s3', 'full')

    // 范文一 is included (insights); unchecking removes it entirely.
    fireEvent.click(screen.getByLabelText('范文一'))
    expect(baseProps.onSourceModeChange).toHaveBeenCalledWith('s1', 'off')
  })

  it('folder checkbox applies full content to the whole folder', () => {
    const { rerender } = render(<ContextPickerDialog {...baseProps} />)

    // Partially included (s1 only) -> checking includes everything.
    fireEvent.click(screen.getByRole('checkbox', { name: '论文夹' }))
    expect(baseProps.onFolderApply).toHaveBeenCalledWith(
      [
        { id: 's1', insights_count: 2 },
        { id: 's2', insights_count: 0 },
      ],
      'full'
    )

    // Fully included -> unchecking excludes the whole folder.
    rerender(
      <ContextPickerDialog
        {...baseProps}
        selections={{
          sources: { s1: 'insights', s2: 'full' },
          notes: { n1: 'full' },
        } as ContextSelections}
      />
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '论文夹' }))
    expect(baseProps.onFolderApply).toHaveBeenCalledWith(
      [
        { id: 's1', insights_count: 2 },
        { id: 's2', insights_count: 0 },
      ],
      'exclude'
    )
  })

  it('toggles a note off through its checkbox', () => {
    render(<ContextPickerDialog {...baseProps} />)

    fireEvent.click(screen.getByLabelText('我的笔记'))

    expect(baseProps.onNoteModeChange).toHaveBeenCalledWith('n1', 'off')
  })

  it('search filters matching sources only', () => {
    render(<ContextPickerDialog {...baseProps} />)

    fireEvent.change(screen.getByPlaceholderText('chat.contextSearchPlaceholder'), {
      target: { value: '范文一' },
    })

    expect(screen.getByText('范文一')).toBeInTheDocument()
    expect(screen.queryByText('范文二')).not.toBeInTheDocument()
    expect(screen.queryByText('零散来源')).not.toBeInTheDocument()
  })

  it('falls back to the loaded source list when the tree endpoint fails', () => {
    mockTree({ data: undefined, isSuccess: false, isError: true })
    render(
      <ContextPickerDialog
        {...baseProps}
        sources={[
          { id: 's1', title: '范文一', insights_count: 2 } as never,
        ]}
      />
    )

    expect(screen.getByText('范文一')).toBeInTheDocument()
    // No tree data: no folder rows, sources sit in the ungrouped bucket.
    expect(screen.queryByText('论文夹')).not.toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungrouped')).toBeInTheDocument()
  })
})

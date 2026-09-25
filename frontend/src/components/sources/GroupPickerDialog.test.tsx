import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { SourceGroupResponse } from '@/lib/types/api'
import { GroupPickerDialog } from './GroupPickerDialog'

// t returns the key string (setup.ts), so titles/buttons are matched by key.

const groups: SourceGroupResponse[] = [
  { id: 'source_group:g1', view_id: 'source_view:v1', name: 'G1', parent_id: null, source_count: 2, created: null, updated: null },
]

function renderDialog(props: Partial<Parameters<typeof GroupPickerDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  render(
    <GroupPickerDialog
      open
      onOpenChange={() => {}}
      title="pick"
      groups={groups}
      onConfirm={onConfirm}
      {...props}
    />
  )
  return { onConfirm }
}

describe('GroupPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the plain empty hint without onCreateGroup', () => {
    renderDialog({ groups: [] })
    expect(screen.getByText('sources.grouping.noGroups')).toBeInTheDocument()
    expect(screen.queryByTestId('group-picker-create-input')).toBeNull()
  })

  it('swaps the dead end for a create hint and inline row when onCreateGroup is set', () => {
    renderDialog({ groups: [], onCreateGroup: vi.fn() })
    expect(screen.getByText('sources.grouping.noGroupsCreateHint')).toBeInTheDocument()
    expect(screen.getByTestId('group-picker-create-input')).toBeInTheDocument()
    expect(screen.queryByText('sources.grouping.noGroups')).toBeNull()
  })

  it('creates inline, auto-selects the new group, unlocks confirm and keeps the dialog open', async () => {
    const onCreateGroup = vi.fn().mockResolvedValue('source_group:new')
    renderDialog({ hideRootOption: true, onCreateGroup })

    // hideRootOption + nothing selected → confirm locked
    const confirm = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByTestId('group-picker-create-input'), { target: { value: 'New' } })
    fireEvent.click(screen.getByTestId('group-picker-create-button'))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('New'))
    await waitFor(() => expect(confirm).toBeEnabled())
    // dialog stays open and the input is cleared for a possible second folder
    expect(screen.getByTestId('group-picker-create-input')).toHaveValue('')
    expect(screen.getByText('pick')).toBeInTheDocument()
  })

  it('keeps the typed name for retry when onCreateGroup resolves null', async () => {
    const onCreateGroup = vi.fn().mockResolvedValue(null)
    renderDialog({ onCreateGroup })

    fireEvent.change(screen.getByTestId('group-picker-create-input'), { target: { value: 'Boom' } })
    fireEvent.click(screen.getByTestId('group-picker-create-button'))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('group-picker-create-input')).toHaveValue('Boom')
  })

  it('submits the inline create on Enter', async () => {
    const onCreateGroup = vi.fn().mockResolvedValue('source_group:new')
    renderDialog({ onCreateGroup })

    fireEvent.change(screen.getByTestId('group-picker-create-input'), { target: { value: 'ViaEnter' } })
    fireEvent.keyDown(screen.getByTestId('group-picker-create-input'), { key: 'Enter' })

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('ViaEnter'))
  })

  it('disables the create button for blank/whitespace names', () => {
    renderDialog({ onCreateGroup: vi.fn() })
    expect(screen.getByTestId('group-picker-create-button')).toBeDisabled()
    fireEvent.change(screen.getByTestId('group-picker-create-input'), { target: { value: '   ' } })
    expect(screen.getByTestId('group-picker-create-button')).toBeDisabled()
  })

  it('unlocks confirm after picking a group and passes the id through', async () => {
    const { onConfirm } = renderDialog({ hideRootOption: true })

    const confirm = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirm).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: /G1/ }))
    expect(confirm).toBeEnabled()

    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('source_group:g1')
  })

  it('disables rows listed in disabledIds and keeps them unselectable', async () => {
    // moving a folder: itself and its descendant are the only invalid targets
    const tree: SourceGroupResponse[] = [
      { id: 'source_group:parent', view_id: 'source_view:v1', name: 'parent', parent_id: null, source_count: 0, created: null, updated: null },
      { id: 'source_group:child', view_id: 'source_view:v1', name: 'child', parent_id: 'source_group:parent', source_count: 0, created: null, updated: null },
      { id: 'source_group:other', view_id: 'source_view:v1', name: 'other', parent_id: null, source_count: 0, created: null, updated: null },
    ]
    const { onConfirm } = renderDialog({
      groups: tree,
      hideRootOption: true,
      disabledIds: ['source_group:parent', 'source_group:child'],
    })

    const confirm = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirm).toBeDisabled()

    const selfRadio = screen.getByRole('radio', { name: /parent/ })
    const descendantRadio = screen.getByRole('radio', { name: /child/ })
    expect(selfRadio).toBeDisabled()
    expect(descendantRadio).toBeDisabled()
    // the disabled row is also visually muted (native disabled blocks selection)
    expect(descendantRadio.closest('div')).toHaveClass('opacity-50')

    fireEvent.click(screen.getByRole('radio', { name: /other/ }))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('source_group:other')
  })

  it('keeps the create button disabled while an inline create is in flight', async () => {
    let settle: (id: string | null) => void = () => {}
    const onCreateGroup = vi
      .fn()
      .mockImplementation(() => new Promise<string | null>((resolve) => { settle = resolve }))
    renderDialog({ onCreateGroup })

    fireEvent.change(screen.getByTestId('group-picker-create-input'), { target: { value: 'Slow' } })
    fireEvent.click(screen.getByTestId('group-picker-create-button'))
    await waitFor(() => expect(screen.getByTestId('group-picker-create-button')).toBeDisabled())
    expect(screen.getByTestId('group-picker-create-input')).toHaveValue('Slow')

    settle('source_group:slow')
    // settled: input cleared, so the button is blank-disabled again rather than busy
    await waitFor(() => expect(screen.getByTestId('group-picker-create-input')).toHaveValue(''))
    expect(screen.getByTestId('group-picker-create-button')).toBeDisabled()
  })
})

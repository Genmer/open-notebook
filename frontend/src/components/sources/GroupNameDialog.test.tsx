import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { GroupNameDialog } from './GroupNameDialog'

// t returns the key string (setup.ts).

function renderDialog(props: Partial<Parameters<typeof GroupNameDialog>[0]> = {}) {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const onOpenChange = vi.fn()
  render(
    <GroupNameDialog
      open
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      {...props}
    />
  )
  return { onConfirm, onOpenChange }
}

describe('GroupNameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to create mode with the create title', () => {
    renderDialog()
    expect(screen.getByText('sources.grouping.newGroupTitle')).toBeInTheDocument()
    expect(screen.queryByText('sources.grouping.renameGroupTitle')).toBeNull()
  })

  it('shows the rename title and prefills the current name', () => {
    renderDialog({ mode: 'rename', initialName: 'Research' })
    expect(screen.getByText('sources.grouping.renameGroupTitle')).toBeInTheDocument()
    expect(screen.getByTestId('group-name-input')).toHaveValue('Research')
  })

  it('disables save until the trimmed name is non-empty', () => {
    renderDialog()
    const save = screen.getByTestId('group-name-save')
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: '   ' } })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: ' x ' } })
    expect(save).toBeEnabled()
  })

  it('confirms the trimmed name and closes on success', async () => {
    const { onConfirm, onOpenChange } = renderDialog()
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: ' New ' } })
    fireEvent.click(screen.getByTestId('group-name-save'))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('New'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('submits on Enter', async () => {
    const { onConfirm } = renderDialog()
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'ViaEnter' } })
    fireEvent.keyDown(screen.getByTestId('group-name-input'), { key: 'Enter' })
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('ViaEnter'))
  })

  it('stays open when onConfirm rejects so the error can be retried', async () => {
    const { onConfirm, onOpenChange } = renderDialog()
    onConfirm.mockRejectedValueOnce(new Error('boom'))
    const input = screen.getByTestId('group-name-input')
    fireEvent.change(input, { target: { value: 'Once' } })
    fireEvent.click(screen.getByTestId('group-name-save'))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByTestId('group-name-input')).toHaveValue('Once')
  })

  it('disables save and cancel while the parent mutation is pending', () => {
    const { onConfirm } = renderDialog({ isPending: true })

    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'Valid' } })
    expect(screen.getByTestId('group-name-save')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled()

    fireEvent.keyDown(screen.getByTestId('group-name-input'), { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('GroupNameDialog create-mode safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the location hint and sibling folder chips', () => {
    renderDialog({ locationPath: 'Research / G1', siblingNames: ['G1', 'G2'] })
    expect(screen.getByTestId('group-location-hint')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.siblingFoldersLabel')).toBeInTheDocument()
    const chips = screen.getByTestId('sibling-folder-chips')
    expect(chips.textContent).toContain('G1')
    expect(chips.textContent).toContain('G2')
  })

  it('disables save with an inline warning on a duplicate sibling name', () => {
    renderDialog({ siblingNames: ['G1'] })
    const save = screen.getByTestId('group-name-save')
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'G1' } })
    expect(save).toBeDisabled()
    expect(screen.getByTestId('group-name-duplicate')).toHaveTextContent(
      'sources.grouping.duplicateNameInline'
    )
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'Other' } })
    expect(save).toBeEnabled()
    expect(screen.queryByTestId('group-name-duplicate')).toBeNull()
  })

  it('keeps the own current name valid in rename mode', () => {
    renderDialog({ mode: 'rename', initialName: 'G1', siblingNames: ['G1', 'G2'] })
    expect(screen.getByTestId('group-name-save')).toBeEnabled()
    expect(screen.queryByTestId('group-name-duplicate')).toBeNull()
  })

  it('hides the location hint in rename mode', () => {
    renderDialog({ mode: 'rename', initialName: 'G1', locationPath: 'Research' })
    expect(screen.queryByTestId('group-location-hint')).toBeNull()
  })
})

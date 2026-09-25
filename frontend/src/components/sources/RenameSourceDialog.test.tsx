import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { SourceListResponse } from '@/lib/types/api'
import { RenameSourceDialog } from './RenameSourceDialog'

function source(title: string): SourceListResponse {
  return {
    id: 'source:a',
    title,
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-01-01T00:00:00',
    updated: '2026-01-01T00:00:00',
  }
}

const setup = (
  overrides: Partial<Parameters<typeof RenameSourceDialog>[0]> = {}
) => {
  const props: Parameters<typeof RenameSourceDialog>[0] = {
    open: true,
    source: source('Old title'),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    onOpenChange: vi.fn(),
    ...overrides,
  }
  render(<RenameSourceDialog {...props} />)
  return props
}

describe('RenameSourceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefills the input with the current title', async () => {
    setup()
    const input = await screen.findByTestId('rename-source-input')
    expect(input).toHaveValue('Old title')
  })

  it('disables save while the trimmed value is empty', async () => {
    setup()
    const input = await screen.findByTestId('rename-source-input')
    const save = screen.getByTestId('rename-source-save')
    expect(save).toBeEnabled()

    fireEvent.change(input, { target: { value: '   ' } })
    expect(save).toBeDisabled()
  })

  it('submits the trimmed title with Enter and closes', async () => {
    const props = setup()
    const input = await screen.findByTestId('rename-source-input')
    fireEvent.change(input, { target: { value: '  New title  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith('New title'))
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('keeps the dialog open when the confirm promise rejects', async () => {
    const props = setup({ onConfirm: vi.fn().mockRejectedValue(new Error('boom')) })
    const input = await screen.findByTestId('rename-source-input')
    fireEvent.change(input, { target: { value: 'New title' } })
    fireEvent.click(screen.getByTestId('rename-source-save'))

    await waitFor(() => expect(props.onConfirm).toHaveBeenCalled())
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('cancels without confirming', async () => {
    const props = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})

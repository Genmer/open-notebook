import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnvPickerDialog } from './EnvPickerDialog'

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvs: () => ({ data: [], isLoading: false }),
}))

describe('EnvPickerDialog empty state', () => {
  it('opens the ruankao environments tab directly, without the legacy redirect', () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    render(
      <EnvPickerDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />
    )

    fireEvent.click(screen.getByText('projectEnvs.pickerEmptyAction'))

    expect(openSpy).toHaveBeenCalledWith('/ruankao?tab=environments', '_blank')
    vi.unstubAllGlobals()
  })
})

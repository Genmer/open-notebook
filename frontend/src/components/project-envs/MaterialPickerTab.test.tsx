import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { MaterialPickerTab } from './MaterialPickerTab'
import type { ProjectEnvMaterialItem } from '@/lib/types/api'

// Setup mocks t() as key-in/key-out; this file also needs to observe the
// {{count}} interpolation argument of materialSelectedCount.
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'count' in params ? `${key}|${String(params.count)}` : key,
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
}))

function material(overrides: Partial<ProjectEnvMaterialItem> = {}): ProjectEnvMaterialItem {
  return {
    id: 'm1',
    category: 'background',
    title: '素材标题',
    text: '素材正文片段',
    tags: [],
    ...overrides,
  }
}

function Harness({ items }: { items: ProjectEnvMaterialItem[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  return (
    <MaterialPickerTab
      items={items}
      selectedIds={selectedIds}
      onSelectedIdsChange={setSelectedIds}
      onSubmit={vi.fn()}
    />
  )
}

describe('MaterialPickerTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clicking the card body (not only the checkbox) toggles the selection', () => {
    render(<Harness items={[material()]} />)

    // bg-teal-tint/40 is the selected-only class (resting cards carry
    // hover:border-teal/60, which would false-match a border check).
    const card = screen.getByTestId('material-card-m1')
    expect(card.className).not.toContain('bg-teal-tint/40')

    fireEvent.click(card)
    expect(screen.getByTestId('material-card-m1').className).toContain('bg-teal-tint/40')

    fireEvent.click(screen.getByTestId('material-card-m1'))
    expect(screen.getByTestId('material-card-m1').className).not.toContain('bg-teal-tint/40')
  })

  it('select-all / deselect-all on a group header only affects that group', () => {
    render(
      <Harness
        items={[
          material({ id: 'm1', category: 'background' }),
          material({ id: 'm2', category: 'background' }),
          material({ id: 'm3', category: 'scale' }),
        ]}
      />
    )

    fireEvent.click(screen.getByTestId('material-toggle-all-background'))
    expect(screen.getByTestId('material-card-m1').className).toContain('bg-teal-tint/40')
    expect(screen.getByTestId('material-card-m2').className).toContain('bg-teal-tint/40')
    expect(screen.getByTestId('material-card-m3').className).not.toContain('bg-teal-tint/40')

    fireEvent.click(screen.getByTestId('material-toggle-all-background'))
    expect(screen.getByTestId('material-card-m1').className).not.toContain('bg-teal-tint/40')
    expect(screen.getByTestId('material-card-m2').className).not.toContain('bg-teal-tint/40')
  })

  it('passes the selected count into materialSelectedCount', () => {
    render(
      <Harness
        items={[
          material({ id: 'm1' }),
          material({ id: 'm2', category: 'scale' }),
          material({ id: 'm3', category: 'my_role' }),
        ]}
      />
    )

    expect(screen.getByText('projectEnvs.materialSelectedCount|0')).toBeDefined()

    fireEvent.click(screen.getByTestId('material-card-m1'))
    fireEvent.click(screen.getByTestId('material-card-m2'))
    fireEvent.click(screen.getByTestId('material-card-m3'))

    expect(screen.getByText('projectEnvs.materialSelectedCount|3')).toBeDefined()
  })

  it('disables submit at zero selection and shows the minimum hint', () => {
    render(<Harness items={[material()]} />)

    const submit = screen.getByTestId('env-material-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByText('projectEnvs.materialMinHint')).toBeDefined()
  })
})

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransformationCard } from './TransformationCard'
import { Transformation } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-transformations', () => ({
  useDeleteTransformation: () => ({ mutate: vi.fn(), isPending: false }),
}))

const makeTransformation = (title: string): Transformation => ({
  id: 'trans-1',
  name: 'rule-name',
  title,
  description: '',
  prompt: 'p',
  apply_default: false,
  model_id: null,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
})

function renderCard(transformation: Transformation) {
  return render(<TransformationCard transformation={transformation} onEdit={vi.fn()} />)
}

describe('TransformationCard title display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function expand() {
    fireEvent.click(screen.getByText('rule-name'))
  }

  it('shows the localized label for a preset title', async () => {
    renderCard(makeTransformation('Dense Summary'))

    await expand()

    // t() returns the key, so this text only appears via displayTransformationTitle.
    expect(await screen.findByText('sources.transformationTitleDenseSummary')).toBeVisible()
  })

  it('shows a user-defined title verbatim', async () => {
    renderCard(makeTransformation('我的自定义规则'))

    await expand()

    expect(await screen.findByText('我的自定义规则')).toBeVisible()
  })

  it('falls back to the untitled label when the title is empty', async () => {
    renderCard(makeTransformation(''))

    await expand()

    expect(await screen.findByText('sources.untitledSource')).toBeVisible()
  })
})

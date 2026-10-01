import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransformationCard } from './TransformationCard'
import { Transformation } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-transformations', () => ({
  useDeleteTransformation: () => ({ mutate: vi.fn(), isPending: false }),
}))

const makeTransformation = (
  title: string,
  description = ''
): Transformation => ({
  id: 'trans-1',
  name: 'rule-name',
  title,
  description,
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

  it('shows the localized label for a preset title', async () => {
    renderCard(makeTransformation('Dense Summary'))

    // 折叠头点击目标即本地化标题（此前是原始 name）
    fireEvent.click(screen.getByText('sources.transformationTitleDenseSummary'))

    // t() returns the key, so this text only appears via displayTransformationTitle.
    const nodes = await screen.findAllByText('sources.transformationTitleDenseSummary')
    expect(nodes.length).toBeGreaterThanOrEqual(1)
  })

  it('shows a user-defined title verbatim', async () => {
    renderCard(makeTransformation('我的自定义规则'))

    fireEvent.click(screen.getByText('我的自定义规则'))

    expect(await screen.findAllByText('我的自定义规则')).not.toHaveLength(0)
  })

  it('falls back to the untitled label when the title is empty', async () => {
    renderCard(makeTransformation(''))

    // title 为空：折叠头回退到原始 name；untitled 文案在展开后的详情区
    fireEvent.click(screen.getByText('rule-name'))

    expect(await screen.findByText('sources.untitledSource')).toBeVisible()
  })

  it('shows a localized description for a seeded preset description', () => {
    renderCard(makeTransformation('Dense Summary', 'Creates a rich, deep summary of the content'))

    // 折叠态描述同样走精确映射（原样泄漏英文种子串是本次修复的漏译）
    expect(
      screen.getByText('sources.transformationDescDenseSummary')
    ).toBeInTheDocument()
  })

  it('shows a user-defined description verbatim', () => {
    renderCard(makeTransformation('', '自定义描述文本'))

    expect(screen.getByText('自定义描述文本')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useForm } from 'react-hook-form'
import { ProcessingStep } from './ProcessingStep'
import { Transformation } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Mirrors the private CreateSourceFormData shape of ProcessingStep.
interface CreateSourceFormData {
  type: 'link' | 'upload' | 'text'
  title?: string
  url?: string
  content?: string
  file?: FileList | File
  notebooks?: string[]
  transformations?: string[]
  embed: boolean
  async_processing: boolean
}

const makeTransformation = (id: string, title: string): Transformation => ({
  id,
  name: id,
  title,
  description: '',
  prompt: 'p',
  apply_default: false,
  model_id: null,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
})

function Harness({ transformations }: { transformations: Transformation[] }) {
  const { control } = useForm<CreateSourceFormData>({
    defaultValues: { type: 'text', embed: false, async_processing: false },
  })
  return (
    <ProcessingStep
      control={control}
      transformations={transformations}
      selectedTransformations={[]}
      onToggleTransformation={vi.fn()}
    />
  )
}

describe('ProcessingStep transformation titles', () => {
  it('shows the localized label for preset titles in the checkbox list', () => {
    render(
      <Harness
        transformations={[
          makeTransformation('trans-1', 'Dense Summary'),
          makeTransformation('trans-2', 'Key Insights'),
        ]}
      />
    )

    // t() returns the key, so these only appear via displayTransformationTitle.
    expect(screen.getByText('sources.transformationTitleDenseSummary')).toBeInTheDocument()
    expect(screen.getByText('sources.transformationTitleKeyInsights')).toBeInTheDocument()
  })

  it('shows user-defined titles verbatim', () => {
    render(<Harness transformations={[makeTransformation('trans-3', '我的自定义规则')]} />)

    expect(screen.getByText('我的自定义规则')).toBeInTheDocument()
  })
})

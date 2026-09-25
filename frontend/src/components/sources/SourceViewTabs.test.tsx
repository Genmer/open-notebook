import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { ClassifyProgress, SourceViewResponse } from '@/lib/types/api'
import { SourceViewTabs } from './SourceViewTabs'

function view(id: string, name: string, isDefault = false): SourceViewResponse {
  return {
    id: `source_view:${id}`,
    name,
    view_type: isDefault ? 'ai_content' : 'custom',
    is_default: isDefault,
    last_classified_at: null,
    classify_progress: null,
    created: null,
    updated: null,
  }
}

function progress(stage: ClassifyProgress['stage'], percent = 50): ClassifyProgress {
  return {
    stage,
    percent,
    message: '',
    error: stage === 'failed' ? 'Model exploded' : null,
    groups_created: 3,
    sources_classified: 15,
    unclassified: 2,
  }
}

const setup = (overrides: Partial<Parameters<typeof SourceViewTabs>[0]> = {}) => {
  const props: Parameters<typeof SourceViewTabs>[0] = {
    views: [view('ai_content', 'AI Content', true), view('custom1', 'Research')],
    activeViewId: 'file_type',
    onSelectView: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<SourceViewTabs {...props} />)
  return props
}

describe('SourceViewTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the virtual file-type tab plus every view', () => {
    setup()
    expect(screen.getByText('sources.grouping.fileTypeTab')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.aiContentViewName')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
  })

  it('groups tabs into three labeled families (mine / AI / file type)', () => {
    setup()
    expect(screen.getByTestId('family-segment-mine').textContent).toContain('Research')
    expect(screen.getByTestId('family-segment-ai').textContent).toContain(
      'sources.grouping.aiContentViewName'
    )
    expect(screen.getByTestId('family-segment-filetype').textContent).toContain(
      'sources.grouping.fileTypeTab'
    )
    expect(screen.getByText('sources.grouping.familyMine')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.familyAi')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.familyFileType')).toBeInTheDocument()
  })

  it('shows the file-type family hint while the file-type tab is active', () => {
    setup()
    expect(screen.getByTestId('active-family-hint')).toHaveTextContent(
      'sources.grouping.familyFileTypeHint'
    )
  })

  it('shows the mine family hint while a custom view is active', () => {
    setup({ activeViewId: 'source_view:custom1' })
    expect(screen.getByTestId('active-family-hint')).toHaveTextContent(
      'sources.grouping.familyMineHint'
    )
  })

  it('shows the AI family hint while an AI view is active', () => {
    setup({ activeViewId: 'source_view:ai_content' })
    expect(screen.getByTestId('active-family-hint')).toHaveTextContent(
      'sources.grouping.familyAiHint'
    )
  })

  it('puts the family hint on each tab as a native title tooltip', () => {
    setup()
    expect(screen.getByText('Research')).toHaveAttribute('title', 'sources.grouping.familyMineHint')
    expect(screen.getByText('sources.grouping.aiContentViewName')).toHaveAttribute(
      'title',
      'sources.grouping.familyAiHint'
    )
    expect(screen.getByText('sources.grouping.fileTypeTab')).toHaveAttribute(
      'title',
      'sources.grouping.familyFileTypeHint'
    )
  })

  it('switches tabs on click', () => {
    const props = setup()
    fireEvent.click(screen.getByText('Research'))
    expect(props.onSelectView).toHaveBeenCalledWith('source_view:custom1')
  })

  it('creates a view through the + dialog', async () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'sources.grouping.addView' }))
    const input = await screen.findByPlaceholderText('sources.grouping.viewNamePlaceholder')
    fireEvent.change(input, { target: { value: 'Papers' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith('Papers'))
  })

  it('renames the active view from its options menu', async () => {
    const props = setup({ activeViewId: 'source_view:custom1' })
    // Radix menus open on pointerdown
    const trigger = screen.getByRole('button', { name: 'sources.grouping.viewOptions' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByText('common.edit'))
    const input = await screen.findByDisplayValue('Research')
    fireEvent.change(input, { target: { value: 'Studies' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(props.onRename).toHaveBeenCalledWith('source_view:custom1', 'Studies'))
  })

  it('deletes the active custom view after confirmation', async () => {
    const props = setup({ activeViewId: 'source_view:custom1' })
    const trigger = screen.getByRole('button', { name: 'sources.grouping.viewOptions' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const deletes = await screen.findAllByText('common.delete')
    fireEvent.click(deletes[deletes.length - 1])
    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('source_view:custom1'))
  })

  it('offers no delete for default views', async () => {
    setup({ activeViewId: 'source_view:ai_content' })
    const trigger = screen.getByRole('button', { name: 'sources.grouping.viewOptions' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByText('common.edit')
    const menu = screen.getByRole('menu')
    expect(menu.textContent).not.toContain('common.delete')
  })
})

describe('SourceViewTabs classify', () => {
  const classifyLabel = 'sources.grouping.classify.button: AI Content'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the re-classify button only on AI views', () => {
    setup({ onClassify: vi.fn() })
    expect(screen.getByRole('button', { name: classifyLabel })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'sources.grouping.classify.button: Research' })
    ).not.toBeInTheDocument()
  })

  it('shows no button when onClassify is not wired', () => {
    setup()
    expect(screen.queryByRole('button', { name: classifyLabel })).not.toBeInTheDocument()
  })

  it('asks for confirmation and classifies on confirm', async () => {
    const props = setup({ onClassify: vi.fn(), activeViewId: 'source_view:ai_content' })
    fireEvent.click(screen.getByRole('button', { name: classifyLabel }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'sources.grouping.classify.confirmCta' })
    )
    await waitFor(() =>
      expect(props.onClassify).toHaveBeenCalledWith('source_view:ai_content')
    )
  })

  it('does not classify when the dialog is cancelled', async () => {
    const props = setup({ onClassify: vi.fn(), activeViewId: 'source_view:ai_content' })
    fireEvent.click(screen.getByRole('button', { name: classifyLabel }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }))
    expect(props.onClassify).not.toHaveBeenCalled()
  })

  it('disables the button and shows running stage while classifying', () => {
    const ai = view('ai_content', 'AI Content', true)
    ai.classify_progress = progress('llm', 45)
    setup({
      views: [ai],
      activeViewId: 'source_view:ai_content',
      onClassify: vi.fn(),
    })
    const button = screen.getByRole('button', { name: classifyLabel })
    expect(button).toBeDisabled()
    const line = screen.getByTestId('classify-progress')
    expect(line.textContent).toContain('sources.grouping.classify.stageLlm')
    expect(line.textContent).toContain('45%')
  })

  it('shows the done summary for a finished run', () => {
    const ai = view('ai_content', 'AI Content', true)
    ai.classify_progress = progress('done', 100)
    setup({ views: [ai], activeViewId: 'source_view:ai_content', onClassify: vi.fn() })
    expect(screen.getByTestId('classify-progress').textContent).toContain(
      'sources.grouping.classify.doneSummary'
    )
  })

  it('shows the error for a failed run and hides it on dismiss', async () => {
    const ai = view('ai_content', 'AI Content', true)
    ai.classify_progress = progress('failed')
    setup({ views: [ai], activeViewId: 'source_view:ai_content', onClassify: vi.fn() })
    const line = screen.getByTestId('classify-progress')
    expect(line.textContent).toContain('Model exploded')

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await waitFor(() =>
      expect(screen.queryByTestId('classify-progress')).not.toBeInTheDocument()
    )
  })

  it('shows no progress line for another view', () => {
    const ai = view('ai_content', 'AI Content', true)
    ai.classify_progress = progress('llm')
    setup({ views: [ai, view('custom1', 'Research')], activeViewId: 'source_view:custom1', onClassify: vi.fn() })
    expect(screen.queryByTestId('classify-progress')).not.toBeInTheDocument()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-artifacts', () => ({
  useGenerateArtifact: () => ({ mutateAsync: generateMock, isPending: false }),
}))

import { GenerateArtifactDialog } from './GenerateArtifactDialog'
import type { ContextSelections } from '../[id]/page'
import type { NoteResponse, SourceListResponse } from '@/lib/types/api'

// t() resolves to the bare key in tests (global setup), so assertions pin
// translation keys, not translated strings.
const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  notebookId: 'notebook:n1',
  contextSelections: {
    sources: { 'source:s1': 'full' },
    notes: {},
  } as ContextSelections,
  sources: [{ id: 'source:s1', title: 'Red book ch.1' }] as SourceListResponse[],
  notes: [] as NoteResponse[],
}

describe('GenerateArtifactDialog essay_draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers the essay_draft artifact type', () => {
    render(<GenerateArtifactDialog {...baseProps} />)

    expect(screen.getByTestId('artifact-type-essay_draft')).toBeInTheDocument()
    expect(screen.getByText('artifacts.type.essayDraft')).toBeInTheDocument()
    expect(screen.getByText('artifacts.type.essayDraftDesc')).toBeInTheDocument()
  })

  it('switches the instruction placeholder to the exam-question prompt', () => {
    render(<GenerateArtifactDialog {...baseProps} />)

    const instruction = screen.getByTestId('artifact-instruction')
    expect(instruction.getAttribute('placeholder')).toBe('artifacts.instructionPlaceholder')

    fireEvent.click(screen.getByTestId('artifact-type-essay_draft'))
    expect(instruction.getAttribute('placeholder')).toBe('artifacts.essayDraftPlaceholder')
  })

  it('submits essay_draft with the selected context', async () => {
    generateMock.mockResolvedValue({})
    render(<GenerateArtifactDialog {...baseProps} />)

    fireEvent.click(screen.getByTestId('artifact-type-essay_draft'))
    fireEvent.click(screen.getByTestId('artifact-generate'))

    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1))
    const request = generateMock.mock.calls[0][0]
    expect(request.artifact_type).toBe('essay_draft')
    expect(request.context_config.sources['source:s1']).toBe('full content')
  })
})

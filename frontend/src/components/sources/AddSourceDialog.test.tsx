import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { createMock, moveMembersMock, toastWarningMock, invalidateGroupingMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  moveMembersMock: vi.fn(),
  toastWarningMock: vi.fn(),
  invalidateGroupingMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: (...args: unknown[]) => toastWarningMock(...(args as [])),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/lib/hooks/use-transformations', () => ({
  useTransformations: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: () => ({ data: null }),
}))
vi.mock('@/lib/hooks/use-sources', () => ({
  useCreateSource: () => ({ mutateAsync: createMock, isPending: false }),
}))
vi.mock('@/lib/api/source-views', () => ({
  sourceViewsApi: {
    moveMembers: (...args: unknown[]) => moveMembersMock(...(args as [])),
  },
}))
vi.mock('@/lib/hooks/use-source-views', () => ({
  useInvalidateGrouping: () => invalidateGroupingMock,
  useSourceViews: () => ({
    data: [
      {
        id: 'source_view:ai_content', name: 'AI Content', view_type: 'ai_content',
        is_default: true, last_classified_at: null, classify_progress: null, created: null, updated: null,
      },
      {
        id: 'source_view:v1', name: 'Research', view_type: 'custom',
        is_default: false, last_classified_at: null, classify_progress: null, created: null, updated: null,
      },
    ],
  }),
  useViewGroups: () => ({
    data: [
      {
        id: 'source_group:g1', view_id: 'source_view:v1', name: 'G1',
        parent_id: null, source_count: 0, created: null, updated: null,
      },
    ],
  }),
}))

// The real step components are form-heavy; stub them with direct setValue calls
// so the dialog flow (create -> file into folder) stays the thing under test.
vi.mock('./steps/SourceTypeStep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./steps/SourceTypeStep')>()
  const Stub = ({ setValue }: { setValue: (name: string, value: unknown) => void }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          setValue('type', 'text')
          setValue('title', 'Single')
          setValue('content', 'body')
        }}
      >
        stub-single
      </button>
      <button
        type="button"
        onClick={() => {
          setValue('type', 'link')
          setValue('url', 'https://a.com\nhttps://b.com\nhttps://c.com')
        }}
      >
        stub-batch
      </button>
      <button
        type="button"
        onClick={() => {
          setValue('type', 'link')
          setValue(
            'url',
            Array.from({ length: 50 }, (_, i) => `https://x.com/${i}`).join('\n')
          )
        }}
      >
        stub-batch-50
      </button>
    </div>
  )
  return { ...actual, SourceTypeStep: Stub }
})
vi.mock('./steps/NotebooksStep', () => ({ NotebooksStep: () => null }))
vi.mock('./steps/ProcessingStep', () => ({ ProcessingStep: () => null }))

import { AddSourceDialog } from './AddSourceDialog'

function setup() {
  const onOpenChange = vi.fn()
  render(<AddSourceDialog open onOpenChange={onOpenChange} />)
  return { onOpenChange }
}

async function pickFolder() {
  // Step 2 hosts the folder section; the radio list belongs to the Research view
  fireEvent.click(screen.getByText('stub-single'))
  fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
  fireEvent.click(screen.getByLabelText('G1'))
}

async function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
}

describe('AddSourceDialog folder assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMock.mockImplementation(async () => ({ id: `source:new-${createMock.mock.calls.length + 1}` }))
  })

  it('does not call moveMembers when no folder is picked', async () => {
    setup()
    fireEvent.click(screen.getByText('stub-single'))
    await submit()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(moveMembersMock).not.toHaveBeenCalled()
    expect(invalidateGroupingMock).not.toHaveBeenCalled()
  })

  it('files a single created source into the picked folder', async () => {
    createMock.mockResolvedValueOnce({ id: 'source:new-1' })
    const { onOpenChange } = setup()
    await pickFolder()
    await submit()

    await waitFor(() =>
      expect(moveMembersMock).toHaveBeenCalledWith('source_group:g1', ['source:new-1'])
    )
    await waitFor(() => expect(invalidateGroupingMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('files every created source of a batch', async () => {
    let seq = 0
    createMock.mockImplementation(async () => ({ id: `source:new-${++seq}` }))
    setup()
    fireEvent.click(screen.getByText('stub-batch'))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByLabelText('G1'))
    await submit()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(3))
    await waitFor(() =>
      expect(moveMembersMock).toHaveBeenCalledWith('source_group:g1', [
        'source:new-1',
        'source:new-2',
        'source:new-3',
      ])
    )
  })

  it('passes every created source of a max-size (50) batch in one assignment call', async () => {
    let seq = 0
    createMock.mockImplementation(async () => ({ id: `source:new-${++seq}` }))
    setup()
    fireEvent.click(screen.getByText('stub-batch-50'))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByLabelText('G1'))
    await submit()

    await waitFor(() => expect(moveMembersMock).toHaveBeenCalledTimes(1))
    const assigned = (moveMembersMock.mock.calls[0] as unknown[])[1] as string[]
    expect(assigned).toHaveLength(50)
    expect(assigned[0]).toBe('source:new-1')
    expect(assigned[49]).toBe('source:new-50')
  })

  it('warns but still closes when the assignment fails', async () => {
    moveMembersMock.mockRejectedValue(new Error('assign boom'))
    createMock.mockResolvedValueOnce({ id: 'source:new-1' })
    const { onOpenChange } = setup()
    await pickFolder()
    await submit()

    await waitFor(() => expect(toastWarningMock).toHaveBeenCalled())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    // Nothing moved, so grouping caches must not be invalidated
    expect(invalidateGroupingMock).not.toHaveBeenCalled()
  })
})

describe('AddSourceDialog default folder context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps the failure-suite's mockRejectedValue: restore success
    moveMembersMock.mockResolvedValue({ moved: 1 })
    createMock.mockImplementation(async () => ({ id: `source:new-${createMock.mock.calls.length + 1}` }))
  })

  it('files a source created straight from step 1 into the default folder', async () => {
    createMock.mockResolvedValueOnce({ id: 'source:new-1' })
    const onOpenChange = vi.fn()
    render(
      <AddSourceDialog
        open
        onOpenChange={onOpenChange}
        defaultViewId="source_view:v1"
        defaultGroupId="source_group:g1"
      />
    )

    fireEvent.click(screen.getByText('stub-single'))
    await submit()

    await waitFor(() =>
      expect(moveMembersMock).toHaveBeenCalledWith('source_group:g1', ['source:new-1'])
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows the default folder on the collapsed step-1 bar', () => {
    render(
      <AddSourceDialog
        open
        onOpenChange={vi.fn()}
        defaultViewId="source_view:v1"
        defaultGroupId="source_group:g1"
      />
    )
    expect(screen.getByTestId('folder-target-bar')).toBeInTheDocument()
    expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent('G1')
  })

  it('ignores the default folder when the default view is the virtual file_type tab', () => {
    render(
      <AddSourceDialog
        open
        onOpenChange={vi.fn()}
        defaultViewId="file_type"
        defaultGroupId="source_group:g1"
      />
    )
    expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent(
      'sources.grouping.noFolderOption'
    )
  })

  it('drops the pick on close and re-applies the default on reopen', async () => {
    const props = {
      defaultViewId: 'source_view:v1',
      defaultGroupId: 'source_group:g1',
    }
    const { rerender } = render(<AddSourceDialog open onOpenChange={vi.fn()} {...props} />)
    expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent('G1')

    rerender(<AddSourceDialog open={false} onOpenChange={vi.fn()} {...props} />)
    await waitFor(() => expect(screen.queryByTestId('folder-target-bar')).toBeNull())

    rerender(<AddSourceDialog open onOpenChange={vi.fn()} {...props} />)
    await waitFor(() =>
      expect(screen.getByTestId('folder-target-bar-label')).toHaveTextContent('G1')
    )
  })
})

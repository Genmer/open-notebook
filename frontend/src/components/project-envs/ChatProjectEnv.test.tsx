import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { ChatProjectEnv } from './ChatProjectEnv'
import { useProjectEnv } from '@/lib/hooks/use-project-envs'
import type { ProjectEnv } from '@/lib/types/api'

// Radix Dialog doesn't open reliably in jsdom (project precedent: mock it,
// keeping the open/onOpenChange/trigger contract).
vi.mock('@/components/ui/dialog', async () => {
  const { createContext, useContext } = await import('react')
  type DialogCtx = { open: boolean; setOpen: (v: boolean) => void }
  const DialogContext = createContext<DialogCtx | null>(null)
  const useDialog = () => {
    const ctx = useContext(DialogContext)
    if (!ctx) throw new Error('DialogContent outside Dialog')
    return ctx
  }
  return {
    Dialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode
      open: boolean
      onOpenChange?: (v: boolean) => void
    }) => (
      <DialogContext.Provider value={{ open, setOpen: (v) => onOpenChange?.(v) }}>
        {children}
      </DialogContext.Provider>
    ),
    DialogContent: ({ children }: { children: ReactNode }) => {
      const { open } = useDialog()
      return open ? <div data-testid="dialog-content">{children}</div> : null
    },
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

vi.mock('@/components/project-envs/EnvPickerDialog', () => ({
  EnvPickerDialog: ({
    selectedEnvId,
    onSelect,
  }: {
    selectedEnvId?: string | null
    onSelect: (envId: string | null) => void
  }) => (
    <div
      data-testid="env-picker-probe"
      data-selected={selectedEnvId ?? ''}
    >
      <button type="button" onClick={() => onSelect('env:next')}>
        pick-next
      </button>
    </div>
  ),
}))

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnv: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { toast } from 'sonner'

const mockUseProjectEnv = vi.mocked(useProjectEnv)

function mockEnv(overrides: Partial<ProjectEnv> = {}): ProjectEnv {
  return {
    id: 'env:1',
    name: 'MES 项目',
    background: '',
    period_start: '2023.05',
    period_end: '2024.01',
    source_type: 'mock',
    keywords: [],
    tech_background: '',
    tuning_process: null,
    problems_solutions: null,
    my_role: null,
    scale: null,
    status: 'verified',
    ai_assisted: null,
    time_adjusted: null,
    time_warnings: [],
    pending_claims_count: 0,
    session_ref_count: 0,
    verification_progress: null,
    has_snapshot: false,
    active_job_id: null,
    created: '',
    updated: '',
    ...overrides,
  }
}

describe('ChatProjectEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProjectEnv.mockReturnValue({ data: undefined } as ReturnType<typeof useProjectEnv>)
  })

  it('renders the add button and, once bound, the chip plus injected badge', () => {
    mockUseProjectEnv.mockReturnValue({
      data: mockEnv(),
    } as ReturnType<typeof useProjectEnv>)
    const { rerender } = render(
      <ChatProjectEnv envId={null} onBind={vi.fn()} />
    )
    expect(screen.getByTestId('chat-env-add')).toBeDefined()
    expect(screen.queryByText('projectEnvs.injectBadge')).toBeNull()

    rerender(<ChatProjectEnv envId="env:1" onBind={vi.fn()} />)
    expect(screen.getByText('MES 项目')).toBeDefined()
    expect(screen.getByText('projectEnvs.injectBadge')).toBeDefined()
  })

  it('fires the boundary toast only on the null -> value transition', () => {
    mockUseProjectEnv.mockReturnValue({
      data: mockEnv(),
    } as ReturnType<typeof useProjectEnv>)
    const { rerender } = render(
      <ChatProjectEnv envId="env:1" onBind={vi.fn()} />
    )
    // Mounted with a binding already present: no toast.
    expect(toast.info).not.toHaveBeenCalled()

    rerender(<ChatProjectEnv envId={null} onBind={vi.fn()} />)
    rerender(<ChatProjectEnv envId="env:1" onBind={vi.fn()} />)
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith(
      'projectEnvs.bindToastTitle',
      expect.objectContaining({ description: 'projectEnvs.bindToastDesc' })
    )
  })

  it('flags a pending env with an old snapshot as the stale version', () => {
    mockUseProjectEnv.mockReturnValue({
      data: mockEnv({ status: 'pending', has_snapshot: true }),
    } as ReturnType<typeof useProjectEnv>)
    render(<ChatProjectEnv envId="env:1" onBind={vi.fn()} />)
    expect(screen.getByText('projectEnvs.staleChip')).toBeDefined()
    expect(screen.getByText('projectEnvs.injectBadge')).toBeDefined()
  })

  it('hides the injected badge for statuses the backend does not inject', () => {
    for (const status of ['needs_review', 'failed', 'pending'] as const) {
      mockUseProjectEnv.mockReturnValue({
        data: mockEnv({ status, has_snapshot: false }),
      } as ReturnType<typeof useProjectEnv>)
      const { unmount } = render(
        <ChatProjectEnv envId="env:1" onBind={vi.fn()} />
      )
      expect(screen.getByText('MES 项目')).toBeDefined()
      expect(screen.queryByText('projectEnvs.injectBadge')).toBeNull()
      unmount()
    }
  })

  it('asks before switching to a different env and keeps the switch explicit', () => {
    mockUseProjectEnv.mockReturnValue({
      data: mockEnv(),
    } as ReturnType<typeof useProjectEnv>)
    const onBind = vi.fn()
    render(<ChatProjectEnv envId="env:1" onBind={onBind} />)

    fireEvent.click(screen.getByText('pick-next'))
    expect(onBind).not.toHaveBeenCalled()
    expect(screen.getByText('projectEnvs.switchTitle')).toBeDefined()

    fireEvent.click(screen.getByText('projectEnvs.switchKeep'))
    expect(onBind).toHaveBeenCalledWith('env:next')
  })

  it('routes the switch dialog new-session option through the handler', () => {
    mockUseProjectEnv.mockReturnValue({
      data: mockEnv(),
    } as ReturnType<typeof useProjectEnv>)
    const onNewSessionWithEnv = vi.fn()
    render(
      <ChatProjectEnv
        envId="env:1"
        onBind={vi.fn()}
        onNewSessionWithEnv={onNewSessionWithEnv}
      />
    )
    fireEvent.click(screen.getByText('pick-next'))
    fireEvent.click(screen.getByText('projectEnvs.switchNew'))
    expect(onNewSessionWithEnv).toHaveBeenCalledWith('env:next')
  })

  it('shows the dangling banner on a 404 and clears the binding on demand', async () => {
    const notFound = Object.assign(new Error('not found'), {
      isAxiosError: true,
      response: { status: 404 },
    })
    mockUseProjectEnv.mockReturnValue({
      data: undefined,
      error: notFound,
    } as unknown as ReturnType<typeof useProjectEnv>)
    const onBind = vi.fn()
    render(<ChatProjectEnv envId="env:gone" onBind={onBind} />)

    expect(screen.getByTestId('chat-env-dangling')).toBeDefined()
    expect(screen.getByText('projectEnvs.danglingTitle')).toBeDefined()

    fireEvent.click(screen.getByText('projectEnvs.danglingClear'))
    expect(onBind).toHaveBeenCalledWith(null)

    // Dismissible: the X closes the banner until the next mount.
    mockUseProjectEnv.mockReturnValue({
      data: undefined,
      error: notFound,
    } as unknown as ReturnType<typeof useProjectEnv>)
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() =>
      expect(screen.queryByTestId('chat-env-dangling')).toBeNull()
    )
  })
})

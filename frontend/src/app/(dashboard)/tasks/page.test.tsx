import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/lib/hooks/use-tasks', () => ({ useTasks: vi.fn() }))

const { invalidateQueries, explainMutate, explainData } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  explainMutate: vi.fn(),
  explainData: {
    mode: 'explain' as const,
    classification: 'transient' as const,
    // Backend real shape (api/explain_service.py): anchors inline with an
    // em-dash, trailing bare JSON line.
    explanation_markdown: [
      'AI-powered explanation is unavailable right now.',
      '',
      '**What happened** — The task failed midway.',
      '**Likely root cause** — A transient network error.',
      '**How to fix** — 1. Retry the task.',
      '**Next actions** — Retry, then check the log.',
      '',
      '{"category":"transient"}',
    ].join('\n'),
    suggestions: [{ action: 'retry', label_key: 'tasks.explain.actionRetry' }],
    facts: [{ label_key: 'tasks.explain.factCommand', value: 'export_data' }],
    recovery: null as { recovered: boolean; detail: string } | null,
    degraded: false,
    from_cache: false,
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
  }
})

vi.mock('@/lib/hooks/use-explain', () => ({
  useExplain: () => ({
    data: explainData,
    isError: false,
    isPending: false,
    mutate: explainMutate,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import TasksPage from './page'
import { useTasks } from '@/lib/hooks/use-tasks'
import {
  tasksApi,
  type TaskEntry,
  type TaskListResponse,
  type TaskRetryResponse,
} from '@/lib/api/tasks'
import { toast } from 'sonner'

// use-translation is mocked globally in src/test/setup.ts (t returns the key).

vi.spyOn(tasksApi, 'cancel').mockResolvedValue(undefined)
vi.spyOn(tasksApi, 'retry').mockResolvedValue({
  job_id: 'command:replayed',
  status: 'submitted',
})

const makeTask = (overrides: Partial<TaskEntry> = {}): TaskEntry => ({
  id: `command:${Math.random().toString(36).slice(2)}`,
  name: 'export_data',
  type: 'data_transfer',
  target: null,
  status: 'completed',
  retryable: false,
  progress: null,
  error_message: null,
  created: '2026-09-28T00:00:00Z',
  updated: null,
  ...overrides,
})

const setup = (pages: TaskListResponse[], hasNextPage = true) => {
  const refetch = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  vi.mocked(useTasks).mockReturnValue({
    data: { pages },
    isLoading: false,
    isError: false,
    refetch,
    isRefetching: false,
    fetchNextPage: vi.fn(),
    hasNextPage,
    isFetchingNextPage: false,
  } as unknown as ReturnType<typeof useTasks>)
  render(
    <QueryClientProvider client={queryClient}>
      <TasksPage />
    </QueryClientProvider>
  )
  return { refetch }
}

const COUNTS = { new: 5, queued: 3, running: 2, completed: 100, failed: 7, canceled: 4, active: 10 }

describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: backend could not judge recovery (single plain retry button).
    explainData.recovery = null
  })

  it('shows the All badge as the sum of every status except the active roll-up', () => {
    setup([{ tasks: [], total: 0, counts: COUNTS }])

    // 5+3+2+100+7+4 = 121; counting 'active' again would show 131
    expect(screen.getByText('121')).toBeInTheDocument()
    expect(screen.queryByText('131')).not.toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('filters server-side: all passes no status, active passes the composite status list', () => {
    setup([{ tasks: [], total: 0, counts: {} }])

    expect(useTasks).toHaveBeenLastCalledWith(undefined, 100)

    // Radix tabs triggers activate on mousedown, not click
    fireEvent.mouseDown(screen.getByRole('tab', { name: /tasks\.filter\.active/ }))
    expect(useTasks).toHaveBeenLastCalledWith('new,queued,running', 100)
  })

  it('shows the shown-of-total footer only while pages remain', () => {
    setup([{ tasks: [makeTask(), makeTask()], total: 5, counts: COUNTS }])

    expect(screen.getByText('tasks.shownOfTotal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'tasks.loadMore' })).toBeInTheDocument()
  })

  it('hides the footer once every matching task is shown', () => {
    setup([{ tasks: [makeTask(), makeTask()], total: 2, counts: COUNTS }], false)

    expect(screen.queryByText('tasks.shownOfTotal')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.loadMore' })).not.toBeInTheDocument()
  })

  it('renders the failed task error message as its own block', () => {
    setup([
      {
        tasks: [makeTask({ status: 'failed', error_message: 'boom at step 2\nretry exhausted' })],
        total: 1,
        counts: COUNTS,
      },
    ])

    expect(screen.getByText(/boom at step 2/)).toBeInTheDocument()
    expect(screen.getByText(/retry exhausted/)).toBeInTheDocument()
  })

  it('cancels a running task from its row and hides the button for finished tasks', async () => {
    setup([
      {
        tasks: [
          makeTask({ id: 'command:running1', status: 'running' }),
          makeTask({ id: 'command:done1', status: 'completed' }),
        ],
        total: 2,
        counts: COUNTS,
      },
    ])

    const buttons = screen.getAllByRole('button', { name: 'tasks.cancel' })
    expect(buttons).toHaveLength(1)

    fireEvent.click(buttons[0])
    expect(tasksApi.cancel).toHaveBeenCalledWith('command:running1')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('tasks.cancelSuccess'))
  })

  it('shows cancelFailed without the success toast and still refetches when cancel rejects', async () => {
    vi.mocked(tasksApi.cancel).mockRejectedValueOnce(new Error('409'))
    const { refetch } = setup([
      {
        tasks: [makeTask({ id: 'command:running1', status: 'running' })],
        total: 1,
        counts: COUNTS,
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'tasks.cancel' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('tasks.cancelFailed'))
    expect(toast.success).not.toHaveBeenCalled()
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('disables the cancel button and swaps in the spinner while the request is in flight', async () => {
    let resolveCancel!: () => void
    vi.mocked(tasksApi.cancel).mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveCancel = resolve))
    )
    setup([
      {
        tasks: [makeTask({ id: 'command:running1', status: 'running' })],
        total: 1,
        counts: COUNTS,
      },
    ])

    const button = screen.getByRole('button', { name: 'tasks.cancel' }) as HTMLButtonElement
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    expect(button.querySelector('svg.animate-spin')).toBeInTheDocument()

    resolveCancel()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('tasks.cancelSuccess'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'tasks.cancel' })).toBeEnabled()
    )
  })

  it('shows the why-failed button only for failed tasks', () => {
    setup([
      {
        tasks: [
          makeTask({ id: 'command:failed1', status: 'failed', error_message: 'boom' }),
          makeTask({ id: 'command:done1', status: 'completed' }),
        ],
        total: 2,
        counts: COUNTS,
      },
    ])

    const buttons = screen.getAllByRole('button', { name: 'tasks.explain.whyFailed' })
    expect(buttons).toHaveLength(1)
  })

  it('retries a failed retryable task straight from its row, with and without precheck', async () => {
    setup([
      {
        tasks: [
          makeTask({ id: 'command:failed1', status: 'failed', error_message: 'boom', retryable: true }),
        ],
        total: 1,
        counts: COUNTS,
      },
    ])

    // Plain retry: no recovery pre-check.
    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.manualRetry' }))
    await waitFor(() => expect(tasksApi.retry).toHaveBeenCalledWith('command:failed1', undefined))

    // AI retry: forces the check_recovery pre-check regardless of card state.
    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.aiRetry' }))
    await waitFor(() =>
      expect(tasksApi.retry).toHaveBeenCalledWith('command:failed1', { checkRecovery: true }),
    )
  })

  it('hides the row retry buttons for non-retryable failed tasks like generate_podcast', () => {
    setup([
      {
        tasks: [
          makeTask({
            id: 'command:pod1',
            name: 'generate_podcast',
            type: 'podcast',
            status: 'failed',
            error_message: 'boom',
            retryable: false,
          }),
        ],
        total: 1,
        counts: COUNTS,
      },
    ])

    expect(screen.queryByRole('button', { name: 'tasks.explain.manualRetry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.explain.aiRetry' })).not.toBeInTheDocument()
    // The explain card stays reachable via why-failed.
    expect(screen.getByRole('button', { name: 'tasks.explain.whyFailed' })).toBeInTheDocument()
  })

  it('hides the row retry buttons for non-failed tasks even when the command is retryable', () => {
    // The backend sends retryable=true regardless of status; the status gate
    // must live in the row, or finished tasks would grow retry buttons.
    setup([
      {
        tasks: [
          makeTask({ id: 'command:done1', status: 'completed', retryable: true }),
          makeTask({ id: 'command:run1', status: 'running', retryable: true }),
        ],
        total: 2,
        counts: COUNTS,
      },
    ])

    expect(screen.queryByRole('button', { name: 'tasks.explain.manualRetry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.explain.aiRetry' })).not.toBeInTheDocument()
  })

  it('disables both row retry buttons while a retry is pending, then re-enables them', async () => {
    let resolveRetry!: (value: TaskRetryResponse) => void
    vi.mocked(tasksApi.retry).mockImplementationOnce(
      () =>
        new Promise<TaskRetryResponse>((resolve) => {
          resolveRetry = resolve
        })
    )
    setup([
      {
        tasks: [
          makeTask({ id: 'command:failed1', status: 'failed', error_message: 'boom', retryable: true }),
        ],
        total: 1,
        counts: COUNTS,
      },
    ])

    const manual = screen.getByRole('button', {
      name: 'tasks.explain.manualRetry',
    }) as HTMLButtonElement
    const ai = screen.getByRole('button', { name: 'tasks.explain.aiRetry' }) as HTMLButtonElement

    fireEvent.click(manual)

    // One in-flight retry locks both buttons of the row; the manual icon spins.
    await waitFor(() => expect(manual).toBeDisabled())
    expect(ai).toBeDisabled()
    expect(manual.querySelector('svg.animate-spin')).toBeInTheDocument()

    resolveRetry({ job_id: 'command:replayed', status: 'submitted' })
    await waitFor(() => expect(manual).toBeEnabled())
    expect(ai).toBeEnabled()
  })

  it('expands the explain card on click: badge, i18n section titles, no anchors or JSON', async () => {
    setup([
      {
        tasks: [makeTask({ id: 'command:failed1', status: 'failed', error_message: 'boom' })],
        total: 1,
        counts: COUNTS,
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.whyFailed' }))

    // t() returns the key in tests, so the badge and headings show as keys.
    expect(screen.getByText('tasks.explain.classRetryable')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.sectionWhat')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.sectionCause')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.sectionFix')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.sectionNext')).toBeInTheDocument()

    // Markdown body survives, but anchor lines and the trailing JSON do not.
    expect(screen.getByText(/The task failed midway/)).toBeInTheDocument()
    expect(screen.queryByText(/\*\*What happened\*\*/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"category"/)).not.toBeInTheDocument()
  })

  it('retries a failed task from the explain card and invalidates the tasks cache', async () => {
    setup([
      {
        tasks: [makeTask({ id: 'command:failed1', status: 'failed', error_message: 'boom' })],
        total: 1,
        counts: COUNTS,
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.whyFailed' }))
    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.actionRetry' }))

    await waitFor(() => expect(tasksApi.retry).toHaveBeenCalledWith('command:failed1', undefined))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('tasks.retrySuccess'))
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks'] }),
    )
    // A real replay submits a new job; the explanation is not re-asked.
    expect(explainMutate).not.toHaveBeenCalledWith({ refresh: true })
  })

  it('toasts info instead of success when the AI retry pre-check reports recovery', async () => {
    explainData.recovery = { recovered: false, detail: 'source still failing' }
    vi.mocked(tasksApi.retry).mockResolvedValueOnce({
      job_id: null,
      status: 'skipped_recovered',
      message: 'Already recovered: source ok',
    })
    setup([
      {
        tasks: [makeTask({ id: 'command:failed1', status: 'failed', error_message: 'boom' })],
        total: 1,
        counts: COUNTS,
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.whyFailed' }))
    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.aiRetry' }))

    await waitFor(() =>
      expect(tasksApi.retry).toHaveBeenCalledWith('command:failed1', { checkRecovery: true }),
    )
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('tasks.explain.retrySkippedRecovered'),
    )
    expect(toast.success).not.toHaveBeenCalledWith('tasks.retrySuccess')
    // The card receives the retry outcome and re-asks for a fresh explanation.
    await waitFor(() => expect(explainMutate).toHaveBeenCalledWith({ refresh: true }))
    // The skip path still refreshes the list (recovery may have changed rows).
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks'] }),
    )
  })

  it('shows retryFailed without the success toast when the retry request rejects', async () => {
    vi.mocked(tasksApi.retry).mockRejectedValueOnce(new Error('400'))
    setup([
      {
        tasks: [makeTask({ id: 'command:failed1', status: 'failed', error_message: 'boom' })],
        total: 1,
        counts: COUNTS,
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.whyFailed' }))
    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.actionRetry' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('tasks.retryFailed'))
    expect(toast.success).not.toHaveBeenCalledWith('tasks.retrySuccess')
  })

  it('renders pulsing progress bar, current stage badge, and view live progress button for running tasks', () => {
    setup([
      {
        tasks: [
          makeTask({
            id: 'command:running1',
            status: 'running',
            progress: { kind: 'data_transfer', stage: '导出关系表', percent: 45 },
          }),
        ],
        total: 1,
        counts: COUNTS,
      },
    ])

    // 阶段徽标
    expect(screen.getByText('导出关系表')).toBeInTheDocument()

    // 脉冲进度条
    const progressbar = screen.getByRole('progressbar', { name: 'tasks.statusRunning' })
    expect(progressbar).toBeInTheDocument()
    expect(progressbar).toHaveClass('animate-pulse')

    // 查看实时进展按钮
    const liveBtn = screen.getByRole('button', { name: 'tasks.viewLiveProgress' })
    expect(liveBtn).toBeInTheDocument()
  })

  it('opens TaskLiveInspector drawer when clicking view live progress button', async () => {
    setup([
      {
        tasks: [
          makeTask({
            id: 'command:running-inspector',
            name: 'generate_artifact',
            target: 'AI Architecture Notes',
            status: 'running',
            progress: { kind: 'artifact', stage: '模型推理', percent: 60 },
          }),
        ],
        total: 1,
        counts: COUNTS,
      },
    ])

    // 点击查看实时进展按钮
    const liveBtn = screen.getByRole('button', { name: 'tasks.viewLiveProgress' })
    fireEvent.click(liveBtn)

    // 验证抽屉滑出展示实时检视器和终端
    expect(screen.getByText('实时任务执行检视器 (Live Inspector)')).toBeInTheDocument()
    expect(screen.getAllByText(/AI Architecture Notes/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/open-notebook:live-terminal/)).toBeInTheDocument()
    expect(screen.getByText('阶段执行流')).toBeInTheDocument()
    expect(screen.getByText('Prompt Tokens')).toBeInTheDocument()
    expect(screen.getByText('已用时')).toBeInTheDocument()

    // 验证抽屉可收起
    const closeBtn = screen.getByRole('button', { name: '关闭抽屉' })
    fireEvent.click(closeBtn)
    await waitFor(() => {
      expect(screen.queryByText('实时任务执行检视器 (Live Inspector)')).not.toBeInTheDocument()
    })
  })
})

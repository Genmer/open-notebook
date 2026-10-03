import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskLiveInspector } from './TaskLiveInspector'
import type { TaskEntry } from '@/lib/api/tasks'

// useTranslation is mocked globally in setup.ts: t(key) returns the key
// string itself, so assertions below match i18n keys, not copy.

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  TestWrapper.displayName = 'TestWrapper'
  return TestWrapper
}

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

// Live-progress polling must never hit the network in jsdom. Rejections keep
// every assertion on the local fallback path (liveData stays undefined) and
// the component's error back-off stops the interval from spinning.
vi.mock('@/lib/api/tasks', () => ({
  tasksApi: {
    getLiveProgress: vi.fn().mockRejectedValue(new Error('no network in tests')),
  },
}))

const mockTask: TaskEntry = {
  id: 'command:job-test-123',
  name: 'generate_artifact',
  type: 'artifact',
  target: 'My Research Notebook',
  status: 'running',
  retryable: false,
  progress: {
    kind: 'artifact',
    stage: 'model-infer',
    percent: 65,
    message: '正在生成核心概念',
  },
  error_message: null,
  created: new Date(Date.now() - 30000).toISOString(),
  updated: null,
}

describe('TaskLiveInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders drawer mode with header, terminal, stage flow and telemetry', () => {
    const onOpenChange = vi.fn()
    const onCancel = vi.fn()

    render(
      <TaskLiveInspector
        open={true}
        onOpenChange={onOpenChange}
        task={mockTask}
        onCancel={onCancel}
      />,
      { wrapper: createWrapper() }
    )

    // 抽屉头部与标题
    expect(screen.getByText('tasks.inspector.title')).toBeInTheDocument()
    expect(screen.getByText(/generate_artifact · My Research Notebook/)).toBeInTheDocument()

    // 阶段流指示器（后端 stages 未到达时渲染通用兜底阶段）
    expect(screen.getByText('tasks.inspector.stageFlow')).toBeInTheDocument()
    expect(screen.getAllByText('tasks.inspector.stages.execute').length).toBeGreaterThanOrEqual(1)

    // Token 遥测指标
    expect(screen.getByText('tasks.inspector.promptTokens')).toBeInTheDocument()
    expect(screen.getByText('tasks.inspector.outputTokens')).toBeInTheDocument()
    expect(screen.getByText('tasks.inspector.tokenRate')).toBeInTheDocument()

    // 终端窗口
    expect(screen.getByText('tasks.inspector.terminalTitle')).toBeInTheDocument()
    expect(screen.getByText(/Task runner initialized for job/)).toBeInTheDocument()

    // 秒表耗时
    expect(screen.getByText('tasks.inspector.elapsed')).toBeInTheDocument()

    // 取消任务与关闭按钮
    const cancelBtn = screen.getByRole('button', { name: /tasks.inspector.cancelTask/ })
    expect(cancelBtn).toBeInTheDocument()
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledWith('command:job-test-123')

    const closeBtn = screen.getByRole('button', { name: 'tasks.inspector.closeDrawer' })
    expect(closeBtn).toBeInTheDocument()
    fireEvent.click(closeBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders in embedded mode for Studio dialog reuse', () => {
    render(
      <TaskLiveInspector
        embedded={true}
        job={{
          jobId: 'command:studio-job-456',
          toolName: 'Study Guide',
          status: 'running',
          startedAt: Date.now() - 15000,
          progress: { kind: 'artifact', percent: 40 },
        }}
      />,
      { wrapper: createWrapper() }
    )

    // 不包含抽屉外壳头部
    expect(screen.queryByText('tasks.inspector.title')).not.toBeInTheDocument()

    // 包含嵌入式内容与任务 ID（id 也出现在终端日志行里，断言至少一处）
    expect(screen.getAllByText(/tasks.inspector.taskId/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/command:studio-job-456/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('tasks.inspector.elapsed')).toBeInTheDocument()
    expect(screen.getByText('tasks.inspector.stageFlow')).toBeInTheDocument()
    expect(screen.getByText('tasks.inspector.terminalTitle')).toBeInTheDocument()
  })

  it('accepts a bare job id without status or tool name', () => {
    render(
      <TaskLiveInspector
        embedded={true}
        variant="compact"
        job={{ jobId: 'command:sec-789', commandName: 'analyze_source_section', type: 'section_analysis' }}
      />,
      { wrapper: createWrapper() }
    )

    // No snapshot status provided: defaults to queued (non-terminal) so the
    // live-progress polling takes over as the authoritative status source.
    expect(screen.getByText('tasks.inspector.running')).toBeInTheDocument()
    // Terminal header renders the i18n key (the global t mock does not
    // interpolate the name param).
    expect(screen.getByText('tasks.inspector.terminalTitle')).toBeInTheDocument()
  })

  it('compact variant trims stage flow, telemetry and task id', () => {
    render(
      <TaskLiveInspector
        embedded={true}
        variant="compact"
        task={mockTask}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.queryByText('tasks.inspector.stageFlow')).not.toBeInTheDocument()
    expect(screen.queryByText('tasks.inspector.promptTokens')).not.toBeInTheDocument()
    expect(screen.queryByText(/tasks.inspector.taskId/)).not.toBeInTheDocument()

    // Status line, progress copy and the stream window remain.
    expect(screen.getByText('tasks.inspector.running')).toBeInTheDocument()
    expect(screen.getByText('tasks.inspector.terminalTitle')).toBeInTheDocument()
  })

  it('renders error block and log when task fails', () => {
    const failedTask: TaskEntry = {
      ...mockTask,
      status: 'failed',
      error_message: 'API quota exceeded on model backend',
    }

    render(<TaskLiveInspector open={true} task={failedTask} />, { wrapper: createWrapper() })

    expect(screen.getByText('tasks.inspector.failed')).toBeInTheDocument()
    expect(screen.getByText('tasks.inspector.errorDetails')).toBeInTheDocument()
    expect(
      screen.getAllByText(/API quota exceeded on model backend/).length
    ).toBeGreaterThanOrEqual(1)
  })

  it('copies terminal logs when copy button is clicked', () => {
    render(<TaskLiveInspector open={true} task={mockTask} />, { wrapper: createWrapper() })

    const copyBtn = screen.getByTitle('tasks.inspector.copyLogs')
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalled()
  })

  it('clears logs when clear button is clicked', () => {
    render(<TaskLiveInspector open={true} task={mockTask} />, { wrapper: createWrapper() })

    const clearBtn = screen.getByTitle('tasks.inspector.clearOutput')
    fireEvent.click(clearBtn)

    expect(screen.queryByText(/Task runner initialized for job/)).not.toBeInTheDocument()
  })

  it('cleans up timers (clearInterval) on unmount to prevent memory leaks', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = render(<TaskLiveInspector open={true} task={mockTask} />, { wrapper: createWrapper() })

    // Unmounting must invoke clearInterval to clean up active intervals (stopwatch & typewriter)
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })

  it('does not start running interval when task status is terminal', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const completedTask: TaskEntry = {
      ...mockTask,
      status: 'completed',
    }
    render(<TaskLiveInspector open={true} task={completedTask} />, { wrapper: createWrapper() })

    // Completed task is terminal: neither stopwatch interval nor typewriter interval should be scheduled
    expect(setIntervalSpy).not.toHaveBeenCalled()
    setIntervalSpy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskLiveInspector } from './TaskLiveInspector'
import type { TaskEntry } from '@/lib/api/tasks'

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

const mockTask: TaskEntry = {
  id: 'command:job-test-123',
  name: 'generate_artifact',
  type: 'artifact',
  target: 'My Research Notebook',
  status: 'running',
  retryable: false,
  progress: {
    kind: 'artifact',
    stage: '模型推理',
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
    expect(screen.getByText('实时任务执行检视器 (Live Inspector)')).toBeInTheDocument()
    expect(screen.getByText(/generate_artifact · My Research Notebook/)).toBeInTheDocument()

    // 阶段流指示器
    expect(screen.getByText('阶段执行流')).toBeInTheDocument()
    expect(screen.getByText('提取分析')).toBeInTheDocument()
    expect(screen.getAllByText('模型推理').length).toBeGreaterThanOrEqual(1)

    // Token 遥测指标
    expect(screen.getByText('Prompt Tokens')).toBeInTheDocument()
    expect(screen.getByText('Output Tokens')).toBeInTheDocument()
    expect(screen.getByText('推理速率')).toBeInTheDocument()

    // 终端窗口
    expect(screen.getByText(/open-notebook:live-terminal/)).toBeInTheDocument()
    expect(screen.getByText(/Task runner initialized for job/)).toBeInTheDocument()

    // 秒表耗时
    expect(screen.getByText('已用时')).toBeInTheDocument()

    // 取消任务与关闭按钮
    const cancelBtn = screen.getByRole('button', { name: /取消任务/ })
    expect(cancelBtn).toBeInTheDocument()
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledWith('command:job-test-123')

    const closeBtn = screen.getByRole('button', { name: '关闭抽屉' })
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
    expect(screen.queryByText('实时任务执行检视器 (Live Inspector)')).not.toBeInTheDocument()

    // 包含嵌入式内容与任务 ID
    expect(screen.getByText(/任务 ID：command:studio-job-456/)).toBeInTheDocument()
    expect(screen.getByText('已用时')).toBeInTheDocument()
    expect(screen.getByText('阶段执行流')).toBeInTheDocument()
    expect(screen.getByText(/open-notebook:live-terminal/)).toBeInTheDocument()
  })

  it('renders error block and log when task fails', () => {
    const failedTask: TaskEntry = {
      ...mockTask,
      status: 'failed',
      error_message: 'API quota exceeded on model backend',
    }

    render(<TaskLiveInspector open={true} task={failedTask} />, { wrapper: createWrapper() })

    expect(screen.getByText('执行失败')).toBeInTheDocument()
    expect(screen.getByText('执行异常详情')).toBeInTheDocument()
    expect(
      screen.getAllByText(/API quota exceeded on model backend/).length
    ).toBeGreaterThanOrEqual(1)
  })

  it('copies terminal logs when copy button is clicked', () => {
    render(<TaskLiveInspector open={true} task={mockTask} />, { wrapper: createWrapper() })

    const copyBtn = screen.getByTitle('复制日志')
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalled()
  })

  it('clears logs when clear button is clicked', () => {
    render(<TaskLiveInspector open={true} task={mockTask} />, { wrapper: createWrapper() })

    const clearBtn = screen.getByTitle('清空输出')
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

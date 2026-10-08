import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GenericParagraphSection } from './GenericParagraphSection'
import { useGenerateGenericParagraph } from '@/lib/hooks/use-project-envs'
import { projectEnvsApi } from '@/lib/api/project-envs'
import type { ProjectEnv } from '@/lib/types/api'

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useGenerateGenericParagraph: vi.fn(),
}))

vi.mock('@/lib/api/project-envs', () => ({
  projectEnvsApi: {
    generateGenericParagraph: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { toast } from 'sonner'

const mockUseGenerate = vi.mocked(useGenerateGenericParagraph)
const mockGenerate = vi.mocked(projectEnvsApi.generateGenericParagraph)
const mockUpdate = vi.mocked(projectEnvsApi.update)

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
    has_snapshot: true,
    active_job_id: null,
    created: '',
    updated: '',
    ...overrides,
  }
}

function renderWithClient(ui: ReactNode, client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  // rerender must re-wrap: it replaces the whole tree including the provider
  const renderResult = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
  return {
    ...renderResult,
    rerenderWithClient: (next: ReactNode) =>
      renderResult.rerender(
        <QueryClientProvider client={queryClient}>{next}</QueryClientProvider>
      ),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('GenericParagraphSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGenerate.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateGenericParagraph>)
  })

  it('空段落挂载 → 静默自动 generate + update 持久化 + invalidate，无 toast', async () => {
    mockGenerate.mockResolvedValue({ paragraph: '通用段落 ____ <u>要点</u>' })
    mockUpdate.mockResolvedValue(
      mockEnv({ generic_paragraph: '通用段落 ____ <u>要点</u>' })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    renderWithClient(<GenericParagraphSection env={mockEnv()} />, client)

    await waitFor(() =>
      expect(mockGenerate).toHaveBeenCalledWith('env:1')
    )
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('env:1', {
        generic_paragraph: '通用段落 ____ <u>要点</u>',
      })
    )
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['project-envs'],
      })
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('自动生成期间显示加载态并禁用手动生成按钮；同 env 只尝试一次', async () => {
    const d = deferred<{ paragraph: string }>()
    mockGenerate.mockReturnValue(d.promise)
    mockUpdate.mockResolvedValue(mockEnv({ generic_paragraph: 'x' }))

    const { rerenderWithClient } = renderWithClient(
      <GenericParagraphSection env={mockEnv()} />
    )

    expect(
      screen.getByTestId('generic-paragraph-auto-pending')
    ).toBeDefined()
    expect(screen.getByTestId('generic-paragraph-generate')).toBeDisabled()
    expect(screen.getByTestId('generic-paragraph-edit')).toBeDisabled()

    // 同一 env 的重渲染不得重复触发（invalidate 刷新场景）
    rerenderWithClient(<GenericParagraphSection env={mockEnv()} />)
    expect(mockGenerate).toHaveBeenCalledTimes(1)

    d.resolve({ paragraph: '完成段落' })
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('env:1', {
        generic_paragraph: '完成段落',
      })
    )
  })

  it('自动生成失败 → 不 toast，恢复 hint 展示，手动按钮可用', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'))

    renderWithClient(<GenericParagraphSection env={mockEnv()} />)

    await waitFor(() =>
      expect(screen.getByTestId('generic-paragraph-generate')).not.toBeDisabled()
    )
    expect(
      screen.getByText('projectEnvs.genericParagraphHint')
    ).toBeDefined()
    expect(
      screen.queryByTestId('generic-paragraph-auto-pending')
    ).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    // 失败后不再重试
    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })

  it('已有段落 → 不自动生成，直接展示段落文本', async () => {
    const env = mockEnv({ generic_paragraph: '用户已有段落' })

    renderWithClient(<GenericParagraphSection env={env} />)

    expect(
      screen.getByTestId('generic-paragraph-text').textContent
    ).toBe('用户已有段落')
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('env.id 变化且新环境段落为空 → 对新 id 触发一次自动生成', async () => {
    const d1 = deferred<{ paragraph: string }>()
    mockGenerate.mockImplementationOnce(() => d1.promise)
    mockUpdate.mockResolvedValue(mockEnv({ generic_paragraph: 'x' }))

    const { rerenderWithClient } = renderWithClient(
      <GenericParagraphSection env={mockEnv()} />
    )
    d1.resolve({ paragraph: '第一个环境的段落' })
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('env:1', {
        generic_paragraph: '第一个环境的段落',
      })
    )

    // 切到另一个空段落环境（同组件实例、env.id 变化）
    mockGenerate.mockResolvedValueOnce({ paragraph: '第二个环境的段落' })
    rerenderWithClient(<GenericParagraphSection env={mockEnv({ id: 'env:2' })} />)

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith('env:2'))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('env:2', {
        generic_paragraph: '第二个环境的段落',
      })
    )
    // 每个环境各触发一次，无重复
    expect(mockGenerate).toHaveBeenCalledTimes(2)
  })

  it('组件卸载后请求才返回 → 链路静默走完，不崩溃不报错', async () => {
    const d = deferred<{ paragraph: string }>()
    mockGenerate.mockReturnValue(d.promise)
    mockUpdate.mockResolvedValue(mockEnv({ generic_paragraph: 'x' }))

    const { unmount } = renderWithClient(<GenericParagraphSection env={mockEnv()} />)
    unmount()

    // 卸载后请求完成：setState 已是 no-op，链路靠 .catch 兜底，
    // 若组件在此路径抛错会以未处理拒绝形式让测试失败
    d.resolve({ paragraph: '迟到返回的段落' })
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('env:1', {
        generic_paragraph: '迟到返回的段落',
      })
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('竞态回归：自动生成在飞时用户已保存段落（缓存非空）→ 自动链路放弃 update', async () => {
    const d = deferred<{ paragraph: string }>()
    mockGenerate.mockReturnValue(d.promise)
    mockUpdate.mockResolvedValue(mockEnv())

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    renderWithClient(<GenericParagraphSection env={mockEnv()} />, client)

    // 用户在自动 generate 还在飞时保存了自己的段落：列表缓存已刷新
    client.setQueryData(['project-envs', 'manage'], [
      mockEnv({ generic_paragraph: '用户刚保存的段落' }),
    ])

    d.resolve({ paragraph: 'AI 迟到的段落' })

    await waitFor(() =>
      expect(screen.getByTestId('generic-paragraph-generate')).not.toBeDisabled()
    )
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('竞态回归：detail 形态缓存非空同样放弃 update', async () => {
    const d = deferred<{ paragraph: string }>()
    mockGenerate.mockReturnValue(d.promise)
    mockUpdate.mockResolvedValue(mockEnv())

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    renderWithClient(<GenericParagraphSection env={mockEnv()} />, client)
    client.setQueryData(['project-envs', 'detail', 'env:1'], {
      ...mockEnv(),
      generic_paragraph: '用户在详情缓存里的段落',
    })

    d.resolve({ paragraph: 'AI 迟到的段落' })

    await waitFor(() =>
      expect(screen.getByTestId('generic-paragraph-generate')).not.toBeDisabled()
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('pending 状态 → 不触发自动生成（避免与运行中的验证竞争）', async () => {
    renderWithClient(
      <GenericParagraphSection env={mockEnv({ status: 'pending' })} />
    )

    await waitFor(() =>
      expect(screen.getByText('projectEnvs.genericParagraphHint')).toBeDefined()
    )
    expect(
      screen.queryByTestId('generic-paragraph-auto-pending')
    ).toBeNull()
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

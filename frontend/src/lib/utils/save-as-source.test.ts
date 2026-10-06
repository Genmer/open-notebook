import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTextSourceWithFiling } from './save-as-source'

// 只 mock sonner 的 warning（helper 的唯一 toast 出口）；sourceViewsApi 走模块级 mock
const { toastWarningMock, moveMembersMock } = vi.hoisted(() => ({
  toastWarningMock: vi.fn(),
  moveMembersMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarningMock(...args),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/api/source-views', () => ({
  sourceViewsApi: {
    moveMembers: (...args: unknown[]) => moveMembersMock(...args),
  },
}))

// queryClient / t / invalidateGrouping 用纯 vi.fn 替身，不经 hook（契约独立于组件）
const makeDeps = () => ({
  createSource: { mutateAsync: vi.fn().mockResolvedValue({ id: 'source:new' }) },
  queryClient: { invalidateQueries: vi.fn() },
  invalidateGrouping: vi.fn(),
  // setup.ts 全局惯例：t 返回键名（toast 断言才能对齐组件内真实 t 的替身行为）
  t: vi.fn((key: string) => key),
  notebookId: 'notebook:1',
  title: 'My title',
  content: 'My content',
  folderTarget: null as { viewId: string; groupId: string } | null,
})

// t 替身按 i18next TFunction 结构伪造（view-display.test.ts 先例），整对象一次断言
const asArgs = (deps: ReturnType<typeof makeDeps>) =>
  deps as unknown as Parameters<typeof createTextSourceWithFiling>[0]

describe('createTextSourceWithFiling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    moveMembersMock.mockResolvedValue({ added: 1 })
  })

  it('creates a text source with embed:false + async_processing:true bound to the notebook', async () => {
    const deps = makeDeps()

    const created = await createTextSourceWithFiling(asArgs(deps))

    expect(created).toEqual({ id: 'source:new' })
    expect(deps.createSource.mutateAsync).toHaveBeenCalledWith({
      type: 'text',
      title: 'My title',
      content: 'My content',
      notebooks: ['notebook:1'],
      embed: false,
      async_processing: true,
    })
  })

  it('files the created source into the folder target and invalidates grouping', async () => {
    const deps = makeDeps()
    deps.folderTarget = { viewId: 'view:1', groupId: 'group:1' }

    await createTextSourceWithFiling(asArgs(deps))

    expect(moveMembersMock).toHaveBeenCalledWith('group:1', ['source:new'])
    expect(deps.invalidateGrouping).toHaveBeenCalledTimes(1)
    expect(deps.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contextTree'] })
  })

  it('keeps the created source and only warns when filing fails; contextTree still invalidated', async () => {
    const deps = makeDeps()
    deps.folderTarget = { viewId: 'view:1', groupId: 'group:1' }
    moveMembersMock.mockRejectedValueOnce(new Error('boom'))

    await expect(createTextSourceWithFiling(asArgs(deps))).resolves.toEqual({ id: 'source:new' })

    expect(deps.t).toHaveBeenCalledWith('sources.grouping.folderAssignFailed', { count: 1 })
    expect(toastWarningMock).toHaveBeenCalledWith('sources.grouping.folderAssignFailed')
    // 归档失败：不失效分组缓存，但 contextTree 失效无条件执行
    expect(deps.invalidateGrouping).not.toHaveBeenCalled()
    expect(deps.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contextTree'] })
  })

  it('skips filing entirely when no folder target is given', async () => {
    const deps = makeDeps()

    await createTextSourceWithFiling(asArgs(deps))

    expect(moveMembersMock).not.toHaveBeenCalled()
    expect(deps.invalidateGrouping).not.toHaveBeenCalled()
    expect(deps.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contextTree'] })
  })

  it('propagates createSource failures to the caller', async () => {
    const deps = makeDeps()
    deps.createSource.mutateAsync.mockRejectedValueOnce(new Error('create failed'))

    await expect(createTextSourceWithFiling(asArgs(deps))).rejects.toThrow('create failed')

    expect(moveMembersMock).not.toHaveBeenCalled()
    expect(deps.queryClient.invalidateQueries).not.toHaveBeenCalled()
  })
})

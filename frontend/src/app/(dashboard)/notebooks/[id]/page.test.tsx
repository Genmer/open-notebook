import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotebookPage from './page'
import {
  CONTEXT_COMBOS_STORAGE_KEY,
  getActiveCombo,
  getActiveComboId,
} from '@/lib/notebooks/context-combos'
import type { ContextMode, ContextSelections, NoteContextMode } from '@/lib/types/notebook-context'
import type { NoteResponse, NotebookResponse, SourceListResponse } from '@/lib/types/api'

// 从 mock 出来的 ClassicNotebookView 上捕获页面下发的 props（当前勾选与回调）
const captured = vi.hoisted(() => ({
  current: null as null | {
    contextSelections: ContextSelections
    handleSourceContextModeChange: (sourceId: string, mode: ContextMode) => void
    handleNoteContextModeChange: (noteId: string, mode: NoteContextMode) => void
    handleBulkSourceContext: (action: 'exclude', items?: Array<{ id: string; insights_count: number }>) => void
    handleBulkNoteContext: (action: 'exclude') => void
    setSourceGrouping: (filters: { viewId?: string; group?: string }) => void
    onApplyCombo?: (replacement: ContextSelections, comboId?: string | null) => void
  },
}))

// ContextPickerDialog 的回调单独捕获（批量/清空也要对激活组合记 dirty）
const pickerCaptured = vi.hoisted(() => ({
  current: null as null | {
    onFolderApply: (items: Array<{ id: string; insights_count: number }>, action: 'exclude') => void
    onClearAll: () => void
  },
}))

// 页面按 hook 返回值决定是否恢复；用可变 state 让单测控制加载时序
const hooks = vi.hoisted(() => ({
  sources: [] as unknown[],
  sourcesLoading: false,
  notes: [] as unknown[],
  notesLoading: false,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/notebooks/nb1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'nb1' }),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../components/NotebookHeader', () => ({ NotebookHeader: () => null }))

vi.mock('../components/ClassicNotebookView', () => ({
  ClassicNotebookView: (props: unknown) => {
    captured.current = props as NonNullable<typeof captured.current>
    return (
      <div>
        <button
          data-testid="probe-source-s3-full"
          onClick={() => captured.current!.handleSourceContextModeChange('s3', 'full')}
        />
        <button
          data-testid="probe-source-s3-off"
          onClick={() => captured.current!.handleSourceContextModeChange('s3', 'off')}
        />
        <button
          data-testid="probe-source-s2-full"
          onClick={() => captured.current!.handleSourceContextModeChange('s2', 'full')}
        />
        <button
          data-testid="probe-enter-folder-scope"
          onClick={() => captured.current!.setSourceGrouping({ viewId: 'v1', group: 'g1' })}
        />
        <button
          data-testid="probe-note-n2-full"
          onClick={() => captured.current!.handleNoteContextModeChange('n2', 'full')}
        />
        <button
          data-testid="probe-apply-combo"
          onClick={() =>
            captured.current!.onApplyCombo?.({ sources: { s3: 'full' }, notes: {} }, 'c2')
          }
        />
        <button
          data-testid="probe-bulk-source-exclude"
          onClick={() => captured.current!.handleBulkSourceContext('exclude')}
        />
        <button
          data-testid="probe-bulk-note-exclude"
          onClick={() => captured.current!.handleBulkNoteContext('exclude')}
        />
      </div>
    )
  },
}))

vi.mock('../components/GeminiNotebookView', () => ({ GeminiNotebookView: () => null }))

vi.mock('../components/ContextPickerDialog', () => ({
  ContextPickerDialog: (props: {
    onFolderApply: (items: Array<{ id: string; insights_count: number }>, action: 'exclude') => void
    onClearAll: () => void
  }) => {
    pickerCaptured.current = props
    return (
      <div>
        <button
          data-testid="probe-folder-apply-exclude"
          onClick={() => props.onFolderApply([{ id: 's1', insights_count: 0 }], 'exclude')}
        />
        <button data-testid="probe-clear-all" onClick={() => props.onClearAll()} />
      </div>
    )
  },
}))
vi.mock('../components/GenerateArtifactDialog', () => ({
  GenerateArtifactDialog: () => null,
}))

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebook: () => ({
    data: {
      id: 'nb1',
      name: '测试笔记本',
      description: '',
      archived: false,
      created: '',
      updated: '',
      source_count: 3,
      note_count: 2,
    } satisfies NotebookResponse,
    isLoading: false,
  }),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useNotebookSources: () => ({
    sources: hooks.sources,
    isLoading: hooks.sourcesLoading,
    isPlaceholderData: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/use-notes', () => ({
  useNotes: () => ({ data: hooks.notes, isLoading: hooks.notesLoading }),
}))

// 稳定引用的偏好数据与 t：真实 hook 返回缓存对象/稳定 t；每渲染新建字面量
// 会让文件夹范围重建 effect 的依赖恒变 → 无限重渲染（worker OOM）
const stableMocks = vi.hoisted(() => ({
  prefs: { data: {} as Record<string, string>, isSuccess: true, isError: false },
  t: (key: string) => key,
}))

vi.mock('@/lib/hooks/use-context-preferences', () => ({
  useContextPreferences: () => stableMocks.prefs,
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({ t: stableMocks.t, language: 'en-US', setLanguage: vi.fn() }),
}))

vi.mock('@/lib/api/notebooks', () => ({
  contextPrefsApi: {
    get: vi.fn().mockResolvedValue({}),
    save: vi.fn().mockResolvedValue({}),
  },
}))

const NOTEBOOK_SOURCES: SourceListResponse[] = [
  { id: 's1', title: '来源1', asset: null, embedded: false, embedded_chunks: 0, insights_count: 0, created: '', updated: '' },
  { id: 's2', title: '来源2', asset: null, embedded: false, embedded_chunks: 0, insights_count: 3, created: '', updated: '' },
  { id: 's3', title: '来源3', asset: null, embedded: false, embedded_chunks: 0, insights_count: 0, created: '', updated: '' },
]

const NOTEBOOK_NOTES: NoteResponse[] = [
  { id: 'n1', title: '笔记1', content: null, note_type: null, created: '', updated: '' },
  { id: 'n2', title: '笔记2', content: null, note_type: null, created: '', updated: '' },
]

// 组合 c1：s1 insights、s2 off、n1 full。与隐式默认（include：s1 full、
// s2 insights、s3 full、n1/n2 full）处处不同，任何一处被默认值冲掉都会断言失败。
// 另落一个 c2（s3 full）供「切换到另一组合」用例命中已存在的 id
function seedActiveCombo(): void {
  window.localStorage.setItem(
    CONTEXT_COMBOS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      byNotebook: {
        nb1: [
          {
            id: 'c1',
            name: '论文精读',
            createdAt: '2026-10-13T00:00:00.000Z',
            updatedAt: '2026-10-13T00:00:00.000Z',
            sources: { s1: 'insights', s2: 'off' },
            notes: { n1: 'full' },
          },
          {
            id: 'c2',
            name: '全量模式',
            createdAt: '2026-10-13T00:00:00.000Z',
            updatedAt: '2026-10-13T00:00:00.000Z',
            sources: { s3: 'full' },
            notes: {},
          },
        ],
      },
      activeByNotebook: { nb1: 'c1' },
    }),
  )
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NotebookPage />
    </QueryClientProvider>,
  )
}

describe('NotebookPage active combo memory', () => {
  beforeEach(() => {
    window.localStorage.clear()
    captured.current = null
    pickerCaptured.current = null
    hooks.sources = NOTEBOOK_SOURCES
    hooks.sourcesLoading = false
    hooks.notes = NOTEBOOK_NOTES
    hooks.notesLoading = false
  })

  it('restores the active combo selections on mount instead of the implicit defaults', () => {
    seedActiveCombo()
    renderPage()

    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'insights',
      s2: 'off',
      s3: 'off',
    })
    expect(captured.current!.contextSelections.notes).toEqual({
      n1: 'full',
      n2: 'off',
    })
    // 恢复不动激活记忆
    expect(getActiveComboId('nb1')).toBe('c1')
  })

  it('keeps implicit default selections when no active combo exists', () => {
    renderPage()

    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'full',
      s2: 'insights',
      s3: 'full',
    })
    expect(captured.current!.contextSelections.notes).toEqual({ n1: 'full', n2: 'full' })
  })

  it('waits for sources/notes to finish loading before restoring, and is not clobbered by the default fill', () => {
    seedActiveCombo()
    // 真实 hook 在加载中时 sources/notes 是空列表
    hooks.sources = []
    hooks.notes = []
    hooks.sourcesLoading = true
    hooks.notesLoading = true

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // 两次内联 JSX：复用同一元素引用会让 React 在 root 层 bail-out，不重渲染
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <NotebookPage />
      </QueryClientProvider>,
    )

    // 列表未就绪：不提前恢复
    expect(captured.current!.contextSelections).toEqual({ sources: {}, notes: {} })

    hooks.sources = NOTEBOOK_SOURCES
    hooks.notes = NOTEBOOK_NOTES
    hooks.sourcesLoading = false
    hooks.notesLoading = false
    rerender(
      <QueryClientProvider client={queryClient}>
        <NotebookPage />
      </QueryClientProvider>,
    )

    // 列表到达后按组合整表恢复，默认填充没有覆盖它
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'insights',
      s2: 'off',
      s3: 'off',
    })
    expect(captured.current!.contextSelections.notes).toEqual({
      n1: 'full',
      n2: 'off',
    })
  })

  it('marks the active combo dirty when a single source mode is changed manually', () => {
    seedActiveCombo()
    renderPage()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    fireEvent.click(screen.getByTestId('probe-source-s3-full'))

    // 不再脱离组合：保留激活 id，dirty 置位
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
    // 本次手动调整生效，组合恢复出的其余选择原样保留
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'insights',
      s2: 'off',
      s3: 'full',
    })
  })

  it('marks the active combo dirty when a single note mode is changed manually', () => {
    seedActiveCombo()
    renderPage()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    fireEvent.click(screen.getByTestId('probe-note-n2-full'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
    expect(captured.current!.contextSelections.notes).toEqual({ n1: 'full', n2: 'full' })
    // 来源侧的选择不受影响
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'insights',
      s2: 'off',
      s3: 'off',
    })
  })

  it('clears dirty again when the manual change matches the active combo snapshot', () => {
    seedActiveCombo()
    renderPage()
    fireEvent.click(screen.getByTestId('probe-source-s3-full'))
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })

    // 改回与快照一致（s3 off）→ dirty 清零
    fireEvent.click(screen.getByTestId('probe-source-s3-off'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'insights',
      s2: 'off',
      s3: 'off',
    })
  })

  it('does not mark the active combo dirty while a folder scope is active', () => {
    seedActiveCombo()
    renderPage()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    // 进入文件夹范围：组合区块关闭（combosEnabled=false），范围重建按范围语义重置
    fireEvent.click(screen.getByTestId('probe-enter-folder-scope'))
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'full',
      s2: 'full',
      s3: 'full',
    })

    // 范围内手动改勾选：不对激活组合记 dirty
    fireEvent.click(screen.getByTestId('probe-source-s3-full'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })
  })

  it('marks dirty when a picker-made selection targets a source outside the paginated pool', () => {
    // 分页首页只有 s1：弹窗（全量树）勾选的 s2 不在分页池里。
    // 并集口径把它并入判定池，dirty 必须落盘 true，否则挂载恢复会按组合
    // 快照整表替换、静默丢弃用户在弹窗里的改动
    hooks.sources = [NOTEBOOK_SOURCES[0]]
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文精读',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: 'c1' },
      }),
    )
    renderPage()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    fireEvent.click(screen.getByTestId('probe-source-s2-full'))

    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'full',
      s2: 'full',
    })
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
  })

  it('records the applied combo as active when the apply carries a combo id', () => {
    seedActiveCombo()
    renderPage()
    expect(getActiveComboId('nb1')).toBe('c1')

    fireEvent.click(screen.getByTestId('probe-apply-combo'))

    expect(getActiveComboId('nb1')).toBe('c2')
    expect(getActiveCombo('nb1')).toEqual({ id: 'c2', dirty: false })
    expect(captured.current!.contextSelections.sources).toEqual({ s3: 'full' })
  })

  it('marks the active combo dirty when a bulk source action runs', () => {
    seedActiveCombo()
    renderPage()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    fireEvent.click(screen.getByTestId('probe-bulk-source-exclude'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
    // 批量排除本身生效：全部来源 off
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'off',
      s2: 'off',
      s3: 'off',
    })
  })

  it('marks the active combo dirty when a bulk note action runs', () => {
    seedActiveCombo()
    renderPage()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    fireEvent.click(screen.getByTestId('probe-bulk-note-exclude'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
    expect(captured.current!.contextSelections.notes).toEqual({ n1: 'off', n2: 'off' })
    // 来源侧的选择不受批量笔记操作影响
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'insights',
      s2: 'off',
      s3: 'off',
    })
  })

  it('marks the active combo dirty when the picker folder batch apply runs', () => {
    seedActiveCombo()
    renderPage()
    expect(pickerCaptured.current).not.toBeNull()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    fireEvent.click(screen.getByTestId('probe-folder-apply-exclude'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
    // 批量只作用于传入的子集（s1），组合恢复出的其余选择原样保留
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'off',
      s2: 'off',
      s3: 'off',
    })
  })

  it('marks the active combo dirty when clear-all runs', () => {
    seedActiveCombo()
    renderPage()
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: false })

    fireEvent.click(screen.getByTestId('probe-clear-all'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'off',
      s2: 'off',
      s3: 'off',
    })
    expect(captured.current!.contextSelections.notes).toEqual({ n1: 'off', n2: 'off' })
  })

  it('keeps the default combo active and clean when clear-all runs', () => {
    // 清空全部勾选 = 默认组合的应用结果：对账后 dirty 保持 false
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-def',
              name: '__default__',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: {},
              notes: {},
              isDefault: true,
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c-def', dirty: false } },
      }),
    )
    renderPage()

    // 干净默认组合挂载即整表替换恢复（=清空全部勾选）
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'off',
      s2: 'off',
      s3: 'off',
    })

    fireEvent.click(screen.getByTestId('probe-clear-all'))

    expect(getActiveCombo('nb1')).toEqual({ id: 'c-def', dirty: false })
    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'off',
      s2: 'off',
      s3: 'off',
    })
    expect(captured.current!.contextSelections.notes).toEqual({ n1: 'off', n2: 'off' })
  })

  it('skips the combo restore on mount when the active record is dirty', () => {
    seedActiveCombo()
    // 激活记录带 dirty 位：挂载不整表替换，走偏好/默认路径恢复实际勾选
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as { activeByNotebook: Record<string, unknown> }
    store.activeByNotebook.nb1 = { id: 'c1', dirty: true }
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))

    renderPage()

    expect(captured.current!.contextSelections.sources).toEqual({
      s1: 'full',
      s2: 'insights',
      s3: 'full',
    })
    expect(captured.current!.contextSelections.notes).toEqual({ n1: 'full', n2: 'full' })
    // dirty 位原样保留
    expect(getActiveCombo('nb1')).toEqual({ id: 'c1', dirty: true })
  })
})

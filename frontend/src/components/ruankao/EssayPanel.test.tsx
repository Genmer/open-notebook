import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EssayPanel, fixedPartsErrorKey, resolveReadSourceId } from './EssayPanel'

// 测试基建（设计稿 4.2/4.3.7）：数据 hooks 整模块罐头 + sourcesApi.get 打桩
// （useSource 的 queryFn 真跑，走例外通道链路），恒等 t mock 断言裸键，
// QueryClientProvider 包装（ModelLibraryPanel.test 同款）。写作台用例额外
// mock use-project-envs / coach-handoff / sonner。
const {
  libraryMock,
  statusMock,
  sourcesGetMock,
  routerPushMock,
  envsMock,
  genFixedMock,
  handoffMock,
  toastErrorMock,
  toastSuccessMock,
  toastInfoMock,
} = vi.hoisted(() => ({
  libraryMock: vi.fn(),
  statusMock: vi.fn(),
  sourcesGetMock: vi.fn(),
  routerPushMock: vi.fn(),
  envsMock: vi.fn(),
  genFixedMock: vi.fn(),
  handoffMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
}))

let readParam: string | null = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
  usePathname: () => '/ruankao',
  useSearchParams: () => new URLSearchParams(readParam ? `read=${readParam}` : ''),
}))

vi.mock('@/lib/hooks/use-essay-marks', () => ({
  useEssayMarksLibrary: () => libraryMock(),
  useEssayMarkStatus: (sourceId: string | null) => statusMock(sourceId),
}))

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: { get: (...args: unknown[]) => sourcesGetMock(...args) },
}))

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvs: () => ({ data: envsMock(), isPending: false }),
  useGenerateFixedParts: () => ({ mutate: genFixedMock, isPending: false }),
}))

vi.mock('@/lib/ruankao/coach-handoff', () => ({
  writeCoachHandoff: (...args: unknown[]) => handoffMock(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: toastInfoMock,
  },
}))

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

const emptyStatus = {
  data: { marks: [], stats: {}, effective_source_ids: [], source: null },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}

const libraryFixture = {
  data: {
    stats: { marked_sources: 2, marked_groups: 1, effective_total: 2 },
    groups: [],
    sources: [
      {
        id: 'source:s1',
        title: 'Essay One',
        extension: 'pdf',
        updated: '2026-10-01T00:00:00Z',
        marked_direct: true,
        via_group_ids: [],
      },
      {
        id: 'source:s2',
        title: 'Essay Two',
        extension: null,
        updated: '2026-09-01T00:00:00Z',
        marked_direct: false,
        via_group_ids: ['source_group:g1'],
      },
      {
        id: 'source:s3',
        title: 'Not Marked',
        extension: null,
        updated: '',
        marked_direct: false,
        via_group_ids: [],
      },
    ],
    dangling_marks: [],
  },
  isPending: false,
  isError: false,
}

const sourceDetailFixture = {
  id: 'source:s1',
  title: 'Essay One',
  full_text: '摘要：本文论述……\n正文：第一段。',
}

function renderPanel() {
  return render(<EssayPanel />, { wrapper: createWrapper() })
}

beforeEach(() => {
  readParam = null
  libraryMock.mockReset()
  statusMock.mockReset()
  sourcesGetMock.mockReset()
  routerPushMock.mockReset()
  envsMock.mockReset()
  genFixedMock.mockReset()
  handoffMock.mockReset()
  toastErrorMock.mockReset()
  toastSuccessMock.mockReset()
  toastInfoMock.mockReset()
  window.localStorage.clear()
  libraryMock.mockReturnValue({
    data: libraryFixture.data,
    isPending: false,
    isError: false,
  })
  statusMock.mockReturnValue(emptyStatus)
  envsMock.mockReturnValue([])
})

describe('resolveReadSourceId', () => {
  it('accepts full source ids and bare ids, rejects anything else', () => {
    expect(resolveReadSourceId('source:abc123')).toBe('source:abc123')
    expect(resolveReadSourceId('abc123')).toBe('source:abc123')
    expect(resolveReadSourceId('  source:abc123  ')).toBe('source:abc123')
    expect(resolveReadSourceId(null)).toBeNull()
    expect(resolveReadSourceId('')).toBeNull()
    expect(resolveReadSourceId('   ')).toBeNull()
    // 注入形态（路径穿越 / 查询串 / 多段冒号）一律忽略
    expect(resolveReadSourceId('../etc/passwd')).toBeNull()
    expect(resolveReadSourceId('a&tab=hotTopics')).toBeNull()
    expect(resolveReadSourceId('source:a:b')).toBeNull()
  })
})

describe('EssayPanel home view', () => {
  it('lists marked sources; write and train cards are live entries', () => {
    renderPanel()

    // 已标记来源成行：直标 s1 + 经文件夹 s2；未标记 s3 不进读卡
    expect(screen.getByTestId('ruankao-essay-home-read-item-source:s1')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-essay-home-read-item-source:s2')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-essay-home-read-item-source:s3')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Essay One')).toBeInTheDocument()

    // 写作台（批次4 第二步）与憋字训练（批次5）都是真实入口
    expect(screen.getByTestId('ruankao-essay-home-write-entry')).toBeEnabled()
    expect(screen.getByTestId('ruankao-essay-home-train-entry')).toBeEnabled()
    expect(screen.getByText('ruankao.essay.write.title')).toBeInTheDocument()
    expect(screen.getByText('ruankao.training.title')).toBeInTheDocument()
  })

  it('guides to the model-essay library when nothing is marked yet', () => {
    libraryMock.mockReturnValue({
      data: { ...libraryFixture.data, sources: [] },
      isPending: false,
      isError: false,
    })
    renderPanel()

    fireEvent.click(screen.getByTestId('ruankao-essay-home-open-library'))
    expect(routerPushMock).toHaveBeenCalledWith('/ruankao?tab=modelLibrary')
  })

  it('falls back to home for a malformed ?read= deep link', () => {
    readParam = '../etc/passwd'
    renderPanel()

    expect(screen.getByTestId('ruankao-essay-home')).toBeInTheDocument()
    expect(screen.queryByTestId('ruankao-essay-read')).not.toBeInTheDocument()
  })

  it('opens the read view from a home list row and returns via the back button', async () => {
    sourcesGetMock.mockResolvedValue(sourceDetailFixture)
    renderPanel()

    fireEvent.click(screen.getByTestId('ruankao-essay-home-read-item-source:s1'))

    await waitFor(() => {
      expect(sourcesGetMock).toHaveBeenCalledWith('source:s1')
    })
    await waitFor(() => {
      expect(screen.getByTestId('ruankao-essay-read-text')).toHaveTextContent('摘要：本文论述……')
    })

    fireEvent.click(screen.getByTestId('ruankao-essay-back'))
    expect(screen.getByTestId('ruankao-essay-home')).toBeInTheDocument()
  })
})

describe('EssayPanel read view', () => {
  beforeEach(() => {
    readParam = 'source:s1'
    sourcesGetMock.mockResolvedValue(sourceDetailFixture)
  })

  it('renders the full text from the sanctioned source endpoint', async () => {
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('ruankao-essay-read')).toBeInTheDocument()
    })
    expect(sourcesGetMock).toHaveBeenCalledWith('source:s1')
    expect(screen.getByTestId('ruankao-essay-read-title')).toHaveTextContent('Essay One')
    expect(screen.getByTestId('ruankao-essay-read-text')).toHaveTextContent(
      '摘要：本文论述……'
    )
    expect(screen.getByTestId('ruankao-essay-read-text')).toHaveTextContent('正文：第一段。')
  })

  it('shows the active red-line badge when the source is effectively marked', async () => {
    statusMock.mockReturnValue({
      ...emptyStatus,
      data: {
        ...emptyStatus.data,
        source: {
          id: 'source:s1',
          marked_direct: true,
          via_group_ids: [],
          effective: true,
        },
      },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('ruankao-essay-read-redline-active')).toBeInTheDocument()
    })
    expect(screen.getByText('ruankao.essay.read.redlineActive')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-essay-read-redline-inactive')
    ).not.toBeInTheDocument()
  })

  it('shows the inactive badge when the source is not marked', async () => {
    statusMock.mockReturnValue({
      ...emptyStatus,
      data: {
        ...emptyStatus.data,
        source: {
          id: 'source:s1',
          marked_direct: false,
          via_group_ids: [],
          effective: false,
        },
      },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('ruankao-essay-read-redline-inactive')).toBeInTheDocument()
    })
    expect(screen.getByText('ruankao.essay.read.redlineInactive')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-essay-read-redline-active')
    ).not.toBeInTheDocument()
  })

  it('keeps the text visible with the error badge and a retry when the status query fails', async () => {
    statusMock.mockReturnValue({ ...emptyStatus, data: undefined, isError: true })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('ruankao-essay-read-redline-error')).toBeInTheDocument()
    })
    expect(screen.getByText('ruankao.essay.read.redlineError')).toBeInTheDocument()
    // 状态查询失败不隐藏正文（读的是例外通道全文，状态仅是提示）
    expect(screen.getByTestId('ruankao-essay-read-text')).toHaveTextContent('摘要：本文论述……')

    fireEvent.click(screen.getByTestId('ruankao-essay-read-redline-retry'))
    expect(emptyStatus.refetch).toHaveBeenCalled()
  })

  it('shows the loading line while the full text is being fetched', () => {
    sourcesGetMock.mockReturnValue(new Promise(() => {}))
    renderPanel()

    expect(screen.getByTestId('ruankao-essay-read-loading')).toBeInTheDocument()
    expect(screen.getByText('ruankao.essay.read.loading')).toBeInTheDocument()
  })

  it('shows the not-found state when the source cannot be read', async () => {
    sourcesGetMock.mockRejectedValue(new Error('Request failed with status code 404'))
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('ruankao-essay-read-notfound')).toBeInTheDocument()
    })
    expect(screen.getByText('ruankao.essay.read.notFound')).toBeInTheDocument()
    // 切换条的返回按钮在场
    expect(screen.getByTestId('ruankao-essay-back')).toBeInTheDocument()
  })
})

describe('EssayPanel write view (写作台)', () => {
  function seedDraft(sections: Partial<Record<string, string>> = {}, projectEnvId: string | null = null) {
    const draft = {
      id: 'd1',
      title: '缓存论文',
      projectEnvId,
      sections: {
        abstract: sections.abstract ?? '',
        background: sections.background ?? '',
        question2: sections.question2 ?? '',
        arguments: sections.arguments ?? '',
        closing: sections.closing ?? '',
      },
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    }
    window.localStorage.setItem('ruankao.essayDrafts.v1', JSON.stringify([draft]))
    return draft
  }

  function openWrite() {
    openWriteRendered()
  }

  function openWriteRendered() {
    const result = renderPanel()
    fireEvent.click(screen.getByTestId('ruankao-essay-home-write-entry'))
    expect(screen.getByTestId('ruankao-write-root')).toBeInTheDocument()
    return result
  }

  it('opens the writing desk from the home write card', () => {
    seedDraft()
    openWrite()

    expect(screen.getByTestId('ruankao-write-section-abstract')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-write-section-background')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-write-section-question2')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-write-section-arguments')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-write-section-closing')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-write-saved-local')).toHaveTextContent(
      'ruankao.essay.write.savedLocal'
    )
  })

  it('shows the empty state with a create button when no drafts exist', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('ruankao-essay-home-write-entry'))

    expect(screen.getByText('ruankao.essay.write.desc')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ruankao-write-new-draft'))
    expect(screen.getByTestId('ruankao-write-draft-select')).toBeInTheDocument()
  })

  it('edits a section, updates the live char count and autosaves after 800ms debounce', () => {
    vi.useFakeTimers()
    try {
      seedDraft()
      renderPanel()
      fireEvent.click(screen.getByTestId('ruankao-essay-home-write-entry'))

      const textarea = screen.getByTestId(
        'ruankao-write-input-abstract'
      ) as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: '摘要草稿' } })
      expect(textarea.value).toBe('摘要草稿')

      // 字数实时更新
      expect(screen.getByTestId('ruankao-write-count-abstract')).toHaveTextContent(
        'ruankao.essay.write.countLabel'
      )

      // debounce 未到不落盘（仍是旧值），800ms 后写入
      const beforeAdvance = JSON.parse(
        window.localStorage.getItem('ruankao.essayDrafts.v1') as string
      )
      expect(beforeAdvance[0].sections.abstract).toBe('')
      act(() => {
        vi.advanceTimersByTime(900)
      })
      const stored = JSON.parse(
        window.localStorage.getItem('ruankao.essayDrafts.v1') as string
      )
      expect(stored[0].sections.abstract).toBe('摘要草稿')
    } finally {
      vi.useRealTimers()
    }
  })

  it('paints guardrail colors: abstract over 300 goes destructive, q2 under 400 warns', () => {
    seedDraft({
      abstract: 'a'.repeat(301),
      question2: '短',
    })
    openWrite()

    expect(screen.getByTestId('ruankao-write-count-abstract').className).toContain(
      'text-destructive'
    )
    expect(screen.getByTestId('ruankao-write-count-question2').className).toContain(
      'text-warn'
    )
    // warn 态附 underFloor 提示（q2/arguments/closing 均未达下限，多处出现）
    expect(screen.getAllByText('ruankao.essay.write.underFloor').length).toBeGreaterThanOrEqual(1)
  })

  it('body total shows over warning past 2500', () => {
    seedDraft({ background: 'b'.repeat(2600) })
    openWrite()

    const total = screen.getByTestId('ruankao-write-body-total')
    expect(total.className).toContain('text-destructive')
    expect(screen.getByText('ruankao.essay.write.overLimit')).toBeInTheDocument()
  })

  it('renders five lanes whose flexBasis widths sum to 100% (target/2700)', () => {
    seedDraft()
    openWrite()

    const keys = ['abstract', 'background', 'question2', 'arguments', 'closing']
    const basisSum = keys.reduce((sum, key) => {
      const lane = screen.getByTestId(`ruankao-write-lane-${key}`)
      expect(lane).toHaveAttribute('role', 'progressbar')
      expect(lane).toHaveAttribute('aria-valuemin', '0')
      return sum + parseFloat((lane as HTMLElement).style.flexBasis)
    }, 0)
    expect(basisSum).toBeCloseTo(100, 6)

    // 泳道宽 = 目标/2700：摘要 ≈11.1%、论点区 ≈37.0%
    expect(
      parseFloat((screen.getByTestId('ruankao-write-lane-abstract') as HTMLElement).style.flexBasis)
    ).toBeCloseTo((300 / 2700) * 100, 6)
    expect(
      parseFloat((screen.getByTestId('ruankao-write-lane-arguments') as HTMLElement).style.flexBasis)
    ).toBeCloseTo((1000 / 2700) * 100, 6)

    // aria 三件套：上限 = 段目标
    expect(screen.getByTestId('ruankao-write-lane-abstract')).toHaveAttribute(
      'aria-valuemax',
      '300'
    )
    expect(screen.getByTestId('ruankao-write-lane-closing')).toHaveAttribute(
      'aria-valuemax',
      '400'
    )
  })

  it('fills each lane by chars/target and recolors across under/near/over states', () => {
    seedDraft({
      abstract: 'a'.repeat(150), // 150/300 = 50%，未达 → 段本色
      background: 'b'.repeat(650), // 650/500 封顶 100%，偏多 → warn
      question2: 'c'.repeat(800), // >700 超限 → destructive
    })
    openWrite()

    const abstractFill = screen.getByTestId('ruankao-write-lane-fill-abstract')
    expect((abstractFill as HTMLElement).style.width).toBe('50%')
    expect(abstractFill.className).toContain('bg-teal')
    expect(screen.getByTestId('ruankao-write-lane-abstract')).toHaveAttribute(
      'aria-valuenow',
      '150'
    )

    const backgroundFill = screen.getByTestId('ruankao-write-lane-fill-background')
    expect((backgroundFill as HTMLElement).style.width).toBe('100%')
    expect(backgroundFill.className).toContain('bg-warn')
    expect(screen.getByTestId('ruankao-write-lane-background')).toHaveAttribute(
      'aria-valuenow',
      '650'
    )

    const q2Fill = screen.getByTestId('ruankao-write-lane-fill-question2')
    expect((q2Fill as HTMLElement).style.width).toBe('100%')
    expect(q2Fill.className).toContain('bg-destructive')

    // 图例四态：未达/偏多/超限有独立图标与文字（不只靠颜色）
    expect(
      screen.getByTestId('ruankao-write-legend-abstract').textContent
    ).toContain('ruankao.essay.write.legendUnder')
    expect(
      screen.getByTestId('ruankao-write-legend-background').textContent
    ).toContain('ruankao.essay.write.legendNear')
    expect(
      screen.getByTestId('ruankao-write-legend-question2').textContent
    ).toContain('ruankao.essay.write.legendOver')
  })

  it('shows the exactly-at-target state with section-color fill and no warn/over styling', () => {
    seedDraft({
      abstract: 'a'.repeat(300),
      background: 'b'.repeat(500),
      question2: 'c'.repeat(500),
      arguments: 'd'.repeat(1000),
      closing: 'e'.repeat(400),
    })
    openWrite()

    const fill = screen.getByTestId('ruankao-write-lane-fill-abstract')
    expect((fill as HTMLElement).style.width).toBe('100%')
    expect(fill.className).toContain('bg-teal')
    const count = screen.getByTestId('ruankao-write-count-abstract')
    expect(count.className).not.toContain('text-warn')
    expect(count.className).not.toContain('text-destructive')

    // 全段达标：图例无未达/偏多/超限字样，完整度无 chip
    expect(screen.queryByText('ruankao.essay.write.legendUnder')).not.toBeInTheDocument()
    expect(screen.queryByText('ruankao.essay.write.legendNear')).not.toBeInTheDocument()
    expect(screen.queryByText('ruankao.essay.write.legendOver')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-write-completeness-chip-abstract')
    ).not.toBeInTheDocument()
  })

  it('grades the body total across thin / ok / near / at-cap states', () => {
    // thin：空稿 → 偏薄警示
    seedDraft()
    const thin = openWriteRendered()
    let total = screen.getByTestId('ruankao-write-body-total')
    expect(total.className).toContain('text-warn')
    expect(within(total).getByText('ruankao.essay.write.bodyThin')).toBeInTheDocument()
    thin.unmount()

    // ok：正文 2000 → 无状态行、无警示色
    seedDraft({ background: 'b'.repeat(2000) })
    const ok = openWriteRendered()
    total = screen.getByTestId('ruankao-write-body-total')
    expect(total.className).not.toContain('text-warn')
    expect(total.className).not.toContain('text-destructive')
    expect(within(total).queryByText('ruankao.essay.write.bodyThin')).not.toBeInTheDocument()
    expect(within(total).queryByText('ruankao.essay.write.bodyNear')).not.toBeInTheDocument()
    ok.unmount()

    // near：正文 2400 → 接近硬上限（四段写满目标恰触预警带）
    seedDraft({ background: 'b'.repeat(1200), question2: 'c'.repeat(1200) })
    const near = openWriteRendered()
    total = screen.getByTestId('ruankao-write-body-total')
    expect(total.className).toContain('text-warn')
    expect(within(total).getByText('ruankao.essay.write.bodyNear')).toBeInTheDocument()
    near.unmount()

    // 红锁边界（裁决 #9）：恰好 2500 显示「已达硬上限」而非「超出硬上限」
    seedDraft({ background: 'b'.repeat(2500) })
    const atCap = openWriteRendered()
    total = screen.getByTestId('ruankao-write-body-total')
    expect(total.className).toContain('text-destructive')
    expect(within(total).getByText('ruankao.essay.write.bodyAtCap')).toBeInTheDocument()
    expect(within(total).queryByText('ruankao.essay.write.overLimit')).not.toBeInTheDocument()
    atCap.unmount()
  })

  it('structures section headers with target-range badge, count and percent of total', () => {
    seedDraft({ abstract: 'a'.repeat(300) })
    openWrite()

    const abstractCard = screen.getByTestId('ruankao-write-section-abstract')
    expect(abstractCard.textContent).toContain('ruankao.essay.write.sectionAbstractName')
    expect(abstractCard.textContent).toContain('ruankao.essay.write.targetRange')
    expect(abstractCard.textContent).toContain('ruankao.essay.write.percentOfTotal')
    expect(
      screen.getByTestId('ruankao-write-count-abstract')
    ).toHaveTextContent('ruankao.essay.write.countLabel')
  })

  it('summarizes essay completeness 3/5 with chips and never blocks the coach send', async () => {
    seedDraft({
      abstract: 'a'.repeat(250), // ok
      background: 'b'.repeat(100), // 未达
      question2: 'c'.repeat(450), // ok
      arguments: 'd'.repeat(950), // ok
      closing: '', // 未达
    })
    handoffMock.mockResolvedValue({ ok: true, notebookId: 'notebook:n1' })
    openWrite()

    const block = screen.getByTestId('ruankao-write-completeness')
    expect(within(block).getByText('ruankao.essay.write.completeness')).toBeInTheDocument()
    expect(
      screen.getByTestId('ruankao-write-completeness-chip-background')
    ).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-write-completeness-chip-closing')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-write-completeness-chip-abstract')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ruankao-write-completeness-chip-question2')
    ).not.toBeInTheDocument()

    // 只提示不拦截：发教练按钮行为原样
    fireEvent.click(screen.getByTestId('ruankao-write-send-coach'))
    await waitFor(() => {
      expect(handoffMock).toHaveBeenCalledWith({
        text: 'd'.repeat(950),
        projectEnvId: null,
      })
    })
  })

  it('honestly reports all five sections unmet for an empty draft', () => {
    seedDraft()
    openWrite()

    for (const key of ['abstract', 'background', 'question2', 'arguments', 'closing']) {
      expect(
        screen.getByTestId(`ruankao-write-completeness-chip-${key}`)
      ).toBeInTheDocument()
    }
  })

  it('fills the three fixed-part sections after generation and confirms before overwriting', () => {
    seedDraft({ abstract: '已有摘要' }, 'project_env:e1')
    envsMock.mockReturnValue([{ id: 'project_env:e1', name: '电商平台重构' }])
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    openWrite()
    expect(screen.getByTestId('ruankao-write-generate-fixed')).toBeEnabled()

    genFixedMock.mockImplementation(
      (_envId: string, opts: { onSuccess: (p: { abstract: string; background: string; closing: string }) => void }) =>
        opts.onSuccess({ abstract: '新摘要 ____', background: '新背景 ____', closing: '新结尾 ____' })
    )
    fireEvent.click(screen.getByTestId('ruankao-write-generate-fixed'))

    // 已有内容 → 先 confirm（generateOverwrite）
    expect(confirmSpy).toHaveBeenCalledWith('ruankao.essay.write.generateOverwrite')
    expect(genFixedMock).toHaveBeenCalledWith('project_env:e1', expect.anything())
    expect(
      (screen.getByTestId('ruankao-write-input-abstract') as HTMLTextAreaElement).value
    ).toBe('新摘要 ____')
    expect(
      (screen.getByTestId('ruankao-write-input-background') as HTMLTextAreaElement).value
    ).toBe('新背景 ____')
    expect(
      (screen.getByTestId('ruankao-write-input-closing') as HTMLTextAreaElement).value
    ).toBe('新结尾 ____')

    // confirm 拒绝 → 不触发生成
    confirmSpy.mockReturnValue(false)
    genFixedMock.mockClear()
    fireEvent.click(screen.getByTestId('ruankao-write-generate-fixed'))
    expect(genFixedMock).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('keeps the generate button disabled without a linked environment', () => {
    seedDraft()
    openWrite()

    expect(screen.getByTestId('ruankao-write-generate-fixed')).toBeDisabled()
  })

  it('maps fixed-parts error reasons to the right toast key', () => {
    const mk = (reason?: string) => ({
      response: { data: { detail: reason ? { reason } : {} } },
    })
    expect(fixedPartsErrorKey(mk('no_material'))).toBe(
      'ruankao.essay.write.generateNoMaterial'
    )
    expect(fixedPartsErrorKey(mk('model_timeout'))).toBe(
      'ruankao.essay.write.generateTimeout'
    )
    expect(fixedPartsErrorKey(mk('model_error'))).toBe(
      'ruankao.essay.write.generateFailed'
    )
    expect(fixedPartsErrorKey(mk())).toBe('ruankao.essay.write.generateFailed')
    expect(fixedPartsErrorKey(new Error('network'))).toBe(
      'ruankao.essay.write.generateFailed'
    )
  })

  it('sends the argument section to the coach via the handoff bridge', async () => {
    seedDraft(
      { arguments: '论点区草稿', question2: '问题2草稿' },
      'project_env:e1'
    )
    handoffMock.mockResolvedValue({ ok: true, notebookId: 'notebook:n1' })

    openWrite()
    fireEvent.click(screen.getByTestId('ruankao-write-send-coach'))

    await waitFor(() => {
      expect(handoffMock).toHaveBeenCalledWith({
        text: '论点区草稿',
        projectEnvId: 'project_env:e1',
      })
      expect(toastSuccessMock).toHaveBeenCalledWith('ruankao.essay.write.handoffReady')
    })

    // 勾选附问题2 后文本含问题2段落
    handoffMock.mockClear()
    fireEvent.click(screen.getByTestId('ruankao-write-include-q2'))
    fireEvent.click(screen.getByTestId('ruankao-write-send-coach'))
    await waitFor(() => {
      expect(handoffMock).toHaveBeenCalledWith({
        text: '【问题2】\n问题2草稿\n\n论点区草稿',
        projectEnvId: 'project_env:e1',
      })
    })
  })

  it('toasts the no-notebook guidance when the handoff cannot find a notebook', async () => {
    seedDraft({ arguments: '论点区草稿' })
    handoffMock.mockResolvedValue({ ok: false, reason: 'no_notebook' })

    openWrite()
    fireEvent.click(screen.getByTestId('ruankao-write-send-coach'))

    await waitFor(() => {
      expect(toastInfoMock).toHaveBeenCalledWith('ruankao.essay.write.handoffNoNotebook')
    })
  })

  it('renames and deletes drafts', async () => {
    seedDraft()
    openWrite()

    fireEvent.click(screen.getByTestId('ruankao-write-rename-draft'))
    fireEvent.change(screen.getByTestId('ruankao-write-rename-input'), {
      target: { value: '新标题' },
    })
    fireEvent.click(screen.getByTestId('ruankao-write-rename-confirm'))
    expect(screen.queryByTestId('ruankao-write-rename-input')).not.toBeInTheDocument()

    // 删除草稿（ConfirmDialog 渲染为 alertdialog；确认按钮与草稿条的删除按钮
    // 同文案，在 dialog 内定位）
    fireEvent.click(screen.getByTestId('ruankao-write-delete-draft'))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'ruankao.essay.write.deleteDraft' })
    )

    // 删除后回到无草稿空态；列表立即落盘为空
    await waitFor(() => {
      expect(screen.getByText('ruankao.essay.write.desc')).toBeInTheDocument()
    })
    expect(window.localStorage.getItem('ruankao.essayDrafts.v1')).toBe('[]')
  })
})

describe('EssayPanel train view (憋字训练，批次5)', () => {
  it('opens the trainer from the home train card and returns without confirm in setup', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('ruankao-essay-home-train-entry'))
    expect(screen.getByTestId('ruankao-train-setup-root')).toBeInTheDocument()

    // setup 阶段离开不拦（无正文可丢）
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByTestId('ruankao-essay-back'))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('ruankao-essay-home')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('confirms before leaving a running round; cancel keeps the round, ok discards it', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('ruankao-essay-home-train-entry'))
    fireEvent.change(screen.getByTestId('ruankao-train-topic'), {
      target: { value: '论分布式缓存' },
    })
    fireEvent.change(screen.getByTestId('ruankao-train-outline'), {
      target: { value: '主旨句：多级缓存' },
    })
    fireEvent.click(screen.getByTestId('ruankao-train-start'))
    expect(screen.getByTestId('ruankao-train-run-root')).toBeInTheDocument()

    // 取消离开：留在盲写视图
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByTestId('ruankao-essay-back'))
    expect(confirmSpy).toHaveBeenCalledWith('ruankao.training.leaveConfirm')
    expect(screen.getByTestId('ruankao-train-run-root')).toBeInTheDocument()

    // 确认离开：回 home
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByTestId('ruankao-essay-back'))
    expect(screen.getByTestId('ruankao-essay-home')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

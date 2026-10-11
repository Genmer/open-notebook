import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionBankPanel } from './QuestionBankPanel'
import {
  QUESTIONS_STORAGE_KEY,
  type RuankaoQuestion,
} from '@/lib/ruankao/question-bank'
import { GENERATIONS_STORAGE_KEY } from '@/lib/ruankao/question-generations'
import { SEED_QUESTIONS } from '@/lib/ruankao/question-bank-seeds.gen'
import { QuestionStreamError } from '@/lib/api/ruankao-questions'

const { pushMock, writeCoachHandoffMock, generateMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  writeCoachHandoffMock: vi.fn(),
  generateMock: vi.fn(),
}))

// 稳定 push spy（全局 setup 的 useRouter 每次调用新建对象，无法断言）
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
}))

// 教练桥 mock（设计稿：详情生成动作经 mock 桥断言载荷；桥内不真开窗口）
vi.mock('@/lib/ruankao/coach-handoff', () => ({
  writeCoachHandoff: writeCoachHandoffMock,
}))

// 生成端点 mock（工作台 C 系全程 mock ruankaoQuestionsApi.generateStream，
// 零真调；importOriginal 保留 QuestionStreamError 真类供错误映射测试用）
vi.mock('@/lib/api/ruankao-questions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/api/ruankao-questions')>()
  return { ...actual, ruankaoQuestionsApi: { generateStream: generateMock } }
})

// 角标文本断言需要插值：在恒等 t 之上给两枚新键钉上与 en-US 语言包一致的
// 模板（其余键仍恒等返回，既有断言不受影响）
const { T_TEMPLATES } = vi.hoisted(() => ({
  T_TEMPLATES: {
    'ruankao.questionBank.list.generatedBadge': '{{done}}/{{total}}',
    'ruankao.questionBank.list.generatedAria':
      '{{done}} of {{total}} details generated',
  } as Record<string, string>,
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const template = T_TEMPLATES[key]
      if (template == null) return key
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(params?.[name] ?? ''),
      )
    },
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
}))

// 本文件渲染 104 条种子库 + Radix 组件，jsdom 下单例本就要 0.3-1.7s；全量
// 套件 171 文件并发（maxWorkers 8）+ coverage 插桩的 CPU 争抢下会越过 vitest
// 默认 5s testTimeout（实测无覆盖 3 例、带覆盖 12 例超时，solo 全绿）。只对
// 本文件放宽到 20s：仍然有界（真挂起照常失败），不掩盖其他文件的超时。
vi.setConfig({ testTimeout: 20_000 })

// jsdom 缺少 Pointer Capture API，Radix Select 点选 option 时会抛
// hasPointerCapture is not a function（测试环境补齐，不影响断言）
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  window.HTMLElement.prototype.setPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
})

// 测试基建：真 store + 真 localStorage（beforeEach 清空），断言裸 i18n 键
// 文本（全局 setup 恒等 t mock）。剪贴板与教练桥逐用例配置。
const writeTextMock = vi.fn()

function mockClipboard(impl: () => Promise<void>) {
  writeTextMock.mockReset()
  writeTextMock.mockImplementation(impl)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
    writable: true,
  })
}

// v2 存储形状读取
function readStored(): { version: number; questions: RuankaoQuestion[]; practicedOverrides: Record<string, boolean> } {
  const raw = localStorage.getItem(QUESTIONS_STORAGE_KEY)
  return raw
    ? (JSON.parse(raw) as {
        version: number
        questions: RuankaoQuestion[]
        practicedOverrides: Record<string, boolean>
      })
    : { version: 2, questions: [], practicedOverrides: {} }
}

// 生成端点的 axios 形错误（reason 分流断言用）
function apiError(reason: string): { response: { status: number; data: { detail: { reason: string } } } } {
  return { response: { status: 502, data: { detail: { reason } } } }
}

// 当前提取输出里的钉扎样本：real 真题（仅真题md 来源）与 2025 回忆简记
const LAMBDA = SEED_QUESTIONS.find((q) => q.title === '论大数据Lambda架构')!
const NOTE = SEED_QUESTIONS.find((q) => q.title === '软件测试')!

// 工作台产物 mock（与端点响应同形；展示层不校验数量，两条足够）
const BREAKDOWN_RESULT = {
  kind: 'breakdown',
  angles: [
    {
      name: '云原生弹性负载均衡',
      thesis_hint: '主旨候选句方向',
      material_match: '高：有扩容量化指标的项目容易支撑',
      difficulty: 'easy',
      similarity_risk: 'high',
    },
    {
      name: '一致性哈希落地取舍',
      thesis_hint: '主旨候选句方向二',
      material_match: '中：需要缓存场景支撑',
      difficulty: 'medium',
      similarity_risk: 'low',
    },
  ],
  combo_advice: '建议选角度一与角度二，与摘要呼应',
} as const

interface FormInput {
  year?: string
  title: string
  domain?: string
  q1?: string
  q2?: string
  q3?: string
}

// 走真实 UI 建一条题目（打开对话框 → 填三问 → 提交）
function createViaForm({ year, title, domain, q1, q2, q3 }: FormInput) {
  fireEvent.click(screen.getByTestId('ruankao-qbank-create-button'))
  fireEvent.change(screen.getByTestId('ruankao-qbank-form-year'), {
    target: { value: year ?? '' },
  })
  fireEvent.change(screen.getByTestId('ruankao-qbank-form-title'), {
    target: { value: title },
  })
  fireEvent.change(screen.getByTestId('ruankao-qbank-form-domain'), {
    target: { value: domain ?? '' },
  })
  fireEvent.change(screen.getByTestId('ruankao-qbank-form-q1'), {
    target: { value: q1 ?? `${title} 的第一问原文` },
  })
  fireEvent.change(screen.getByTestId('ruankao-qbank-form-q2'), {
    target: { value: q2 ?? `${title} 的第二问原文` },
  })
  fireEvent.change(screen.getByTestId('ruankao-qbank-form-q3'), {
    target: { value: q3 ?? `${title} 的第三问原文` },
  })
  fireEvent.click(screen.getByTestId('ruankao-qbank-form-submit'))
}

// Radix Select 的 jsdom 打开配方（SourceDetailContent.test:400 先例）
function selectOption(triggerTestId: string, optionName: string | RegExp) {
  const trigger = screen.getByTestId(triggerTestId)
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

// 生成缓存读取（工作台 B1 断言用）
function readGenerations(): {
  entries: Record<
    string,
    Record<string, { content: unknown; generatedAt: string; note?: string }>
  >
} | null {
  const raw = localStorage.getItem(GENERATIONS_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

// 生成进度角标/列表排序（B/C 线）测试的种料：直接写 localStorage 生成缓存
// （时间戳可控，不走工作台 UI）；内容与端点响应同形，读取净化器按 kind 校验
const GENERATION_FIXTURES: Record<
  'breakdown' | 'q2_points' | 'outline',
  unknown
> = {
  breakdown: BREAKDOWN_RESULT,
  q2_points: {
    kind: 'q2_points',
    framework: '论述框架：背景-方案-效果',
    points: [{ heading: '要点一', detail: '技术方法细节' }],
    outline_hint: '组织建议',
  },
  outline: {
    kind: 'outline',
    paragraphs: [{ role: 'q2', outline: 'Q2 提纲', data_anchors: ['QPS 对比'] }],
  },
}

// 给题目 id 种 N 个 kind 的生成产物（逐次调用按 kind 合并覆盖）
function seedGenerations(
  questionId: string,
  kinds: ReadonlyArray<'breakdown' | 'q2_points' | 'outline'>,
  generatedAt: string,
) {
  const raw = localStorage.getItem(GENERATIONS_STORAGE_KEY)
  const store = raw
    ? (JSON.parse(raw) as {
        version: number
        entries: Record<
          string,
          Record<string, { content: unknown; generatedAt: string }>
        >
      })
    : { version: 1, entries: {} }
  const perKind = { ...(store.entries[questionId] ?? {}) }
  for (const kind of kinds) {
    perKind[kind] = { content: GENERATION_FIXTURES[kind], generatedAt }
  }
  store.entries[questionId] = perKind
  localStorage.setItem(GENERATIONS_STORAGE_KEY, JSON.stringify(store))
}

// 固定 user 条目的 updatedAt（排序确定性：默认顺序可控）
function patchUserQuestion(id: string, patch: Partial<RuankaoQuestion>) {
  const stored = readStored()
  localStorage.setItem(
    QUESTIONS_STORAGE_KEY,
    JSON.stringify({
      ...stored,
      questions: stored.questions.map((q) =>
        q.id === id ? { ...q, ...patch } : q,
      ),
    }),
  )
}

describe('QuestionBankPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    pushMock.mockReset()
    writeCoachHandoffMock.mockReset()
    writeCoachHandoffMock.mockResolvedValue({ ok: true, notebookId: 'nb-1' })
    generateMock.mockReset()
    mockClipboard(() => Promise.resolve())
  })

  it('renders the seed bank with real/mock origin badges and no retired sample badge', () => {
    render(<QuestionBankPanel />)

    // 种子条目在场且互斥 badge 恰好一个：real 行有 origin-real 无 origin-mock
    const lambdaRow = screen.getByTestId(`ruankao-qbank-item-${LAMBDA.id}`)
    expect(within(lambdaRow).getByTestId('ruankao-qbank-origin-real')).toBeInTheDocument()
    expect(within(lambdaRow).queryByTestId('ruankao-qbank-origin-mock')).not.toBeInTheDocument()
    expect(within(lambdaRow).getByText('ruankao.questionBank.originReal')).toBeInTheDocument()

    // 退役键全零：sampleBadge 不再渲染
    expect(screen.queryByText('ruankao.questionBank.sampleBadge')).not.toBeInTheDocument()

    // 种子行没有编辑/删除（不可变常量），但有练过开关与详情按钮
    expect(
      screen.queryByTestId(`ruankao-qbank-edit-${LAMBDA.id}`),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId(`ruankao-qbank-delete-${LAMBDA.id}`),
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId(`ruankao-qbank-practiced-toggle-${LAMBDA.id}`),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId(`ruankao-qbank-detail-${LAMBDA.id}`),
    ).toBeInTheDocument()

    // 有种子时旧「题库还是空的」空态不再出现
    expect(screen.queryByTestId('ruankao-qbank-empty')).not.toBeInTheDocument()
    // v2 存储键尚未落盘（种子是常量，无覆写时不写）
    expect(localStorage.getItem(QUESTIONS_STORAGE_KEY)).toBeNull()
  })

  it('sorts user entries ahead of seeds and persists only user rows to the v2 store', () => {
    render(<QuestionBankPanel />)
    createViaForm({ title: '论消息队列的应用', domain: '消息与集成' })
    const createdId = readStored().questions[0].id

    // user 在前：首行是新建条目，种子其后
    const order = screen
      .getAllByTestId(/^ruankao-qbank-item-/)
      .map((el) => el.getAttribute('data-testid'))
    expect(order[0]).toBe(`ruankao-qbank-item-${createdId}`)
    expect(order.indexOf(`ruankao-qbank-item-${LAMBDA.id}`)).toBeGreaterThan(0)

    // v2 存储：只有 user 条目（种子常量不落盘）
    const stored = readStored()
    expect(stored.version).toBe(2)
    expect(stored.questions).toHaveLength(1)
    expect(stored.questions[0]).toMatchObject({
      title: '论消息队列的应用',
      origin: 'mock',
      source: 'user',
    })
    // 新 user 条目行也有互斥 mock badge
    const userRow = screen.getByTestId(`ruankao-qbank-item-${createdId}`)
    expect(within(userRow).getByTestId('ruankao-qbank-origin-mock')).toBeInTheDocument()
  })

  it('validates the form before persisting across remounts', () => {
    const { unmount } = render(<QuestionBankPanel />)

    // 空表单提交：校验错误在场，不落库，对话框保持打开
    fireEvent.click(screen.getByTestId('ruankao-qbank-create-button'))
    fireEvent.click(screen.getByTestId('ruankao-qbank-form-submit'))
    expect(
      screen.getByText('ruankao.questionBank.validationRequired'),
    ).toBeInTheDocument()
    expect(localStorage.getItem(QUESTIONS_STORAGE_KEY)).toBeNull()

    // 补全后提交成功：对话框关闭，localStorage 出现 user 条目
    fireEvent.change(screen.getByTestId('ruankao-qbank-form-title'), {
      target: { value: '论幂等设计的应用' },
    })
    fireEvent.change(screen.getByTestId('ruankao-qbank-form-q1'), {
      target: { value: '第一问原文' },
    })
    fireEvent.change(screen.getByTestId('ruankao-qbank-form-q2'), {
      target: { value: '第二问原文' },
    })
    fireEvent.change(screen.getByTestId('ruankao-qbank-form-q3'), {
      target: { value: '第三问原文' },
    })
    fireEvent.click(screen.getByTestId('ruankao-qbank-form-submit'))
    expect(
      screen.queryByTestId('ruankao-qbank-form-title'),
    ).not.toBeInTheDocument()

    // 重新挂载（= 刷新）：user 条目仍在（v2 持久）
    unmount()
    render(<QuestionBankPanel />)
    expect(readStored().questions).toHaveLength(1)
  })

  it('toggles practiced on user rows and on seed rows via the v2 overrides table', () => {
    render(<QuestionBankPanel />)
    createViaForm({ title: '论微服务的应用', domain: '微服务与分布式' })
    const userId = readStored().questions[0].id

    // user 条目翻转：进 questions 数组
    fireEvent.click(screen.getByTestId(`ruankao-qbank-practiced-toggle-${userId}`))
    expect(readStored().questions[0].practiced).toBe(true)

    // 种子条目翻转：不进 questions，进 practicedOverrides（按 id 挂）
    fireEvent.click(screen.getByTestId(`ruankao-qbank-practiced-toggle-${LAMBDA.id}`))
    const stored = readStored()
    expect(stored.practicedOverrides[LAMBDA.id]).toBe(true)
    expect(stored.questions).toHaveLength(1)

    // 再点翻回并持久化
    fireEvent.click(screen.getByTestId(`ruankao-qbank-practiced-toggle-${LAMBDA.id}`))
    expect(readStored().practicedOverrides[LAMBDA.id]).toBe(false)
  })

  it('filters by domain, practiced state, origin and title together', () => {
    render(<QuestionBankPanel />)
    createViaForm({ title: '论缓存技术的应用', domain: '缓存', year: '2024 上' })
    createViaForm({ title: '论负载均衡的应用', domain: '负载均衡', year: '2023 下' })
    const [cacheId, lbId] = readStored().questions.map((q) => q.id)

    // 技术域筛选：只剩负载均衡条目（种子技术域均为池内域，被一并滤掉）
    selectOption('ruankao-qbank-filter-domain', '负载均衡')
    expect(screen.getByTestId(`ruankao-qbank-item-${lbId}`)).toBeInTheDocument()
    expect(
      screen.queryByTestId(`ruankao-qbank-item-${cacheId}`),
    ).not.toBeInTheDocument()

    // 来源筛选（三态）：仅真题 → 全部行都是 real badge，user 条目消失
    // （先把技术域筛选拨回全部，让种子行回到列表）
    selectOption('ruankao-qbank-filter-domain', 'ruankao.questionBank.filterAllDomains')
    selectOption('ruankao-qbank-filter-origin', 'ruankao.questionBank.filterReal')
    expect(
      screen.getAllByTestId('ruankao-qbank-origin-real').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByTestId('ruankao-qbank-origin-mock')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId(`ruankao-qbank-item-${lbId}`),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId(`ruankao-qbank-item-${cacheId}`),
    ).not.toBeInTheDocument()

    // 仅模拟 → real 行消失
    selectOption('ruankao-qbank-filter-origin', 'ruankao.questionBank.filterMock')
    expect(screen.queryByTestId('ruankao-qbank-origin-real')).not.toBeInTheDocument()
    expect(
      screen.getAllByTestId('ruankao-qbank-origin-mock').length,
    ).toBeGreaterThan(0)

    // 回到全部来源 → user 条目回来
    selectOption(
      'ruankao-qbank-filter-origin',
      'ruankao.questionBank.filterAllOrigins',
    )
    expect(
      screen.getByTestId(`ruankao-qbank-item-${lbId}`),
    ).toBeInTheDocument()

    // 标题搜索与筛选联动
    selectOption('ruankao-qbank-filter-domain', 'ruankao.questionBank.filterAllDomains')
    fireEvent.change(screen.getByTestId('ruankao-qbank-filter-search'), {
      target: { value: '负载' },
    })
    expect(screen.getByTestId(`ruankao-qbank-item-${lbId}`)).toBeInTheDocument()
    expect(
      screen.queryByTestId(`ruankao-qbank-item-${cacheId}`),
    ).not.toBeInTheDocument()

    // 练过状态过滤：已练只剩标记过的条目（先给负载均衡条目点上练过）
    fireEvent.change(screen.getByTestId('ruankao-qbank-filter-search'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByTestId(`ruankao-qbank-practiced-toggle-${lbId}`))
    selectOption('ruankao-qbank-filter-practiced', 'ruankao.questionBank.filterPracticed')
    expect(screen.getByTestId(`ruankao-qbank-item-${lbId}`)).toBeInTheDocument()
    expect(
      screen.queryByTestId(`ruankao-qbank-item-${cacheId}`),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId(`ruankao-qbank-item-${LAMBDA.id}`),
    ).not.toBeInTheDocument()
  })

  it('copies title, year and all three prompts to the clipboard for the coach', async () => {
    render(<QuestionBankPanel />)
    createViaForm({
      title: '论分布式事务的应用',
      domain: '分布式',
      year: '2025 上',
      q1: '概述你的分布式事务项目',
      q2: '论述分布式事务的技术组成',
      q3: '说明实施过程与效果',
    })
    const id = readStored().questions[0].id

    fireEvent.click(screen.getByTestId(`ruankao-qbank-copy-coach-${id}`))

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1))
    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).toContain('论分布式事务的应用')
    expect(text).toContain('2025 上')
    expect(text).toContain('概述你的分布式事务项目')
    expect(text).toContain('论述分布式事务的技术组成')
    expect(text).toContain('说明实施过程与效果')
    // 尾部引导行（固定中文，交给教练智能体）
    expect(text).toContain('请按论文教练的破题拆点流程')
  })

  it('falls back to a copy dialog when the clipboard is unavailable', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')))
    render(<QuestionBankPanel />)
    createViaForm({ title: '论幂等设计的应用' })
    const id = readStored().questions[0].id

    fireEvent.click(screen.getByTestId(`ruankao-qbank-copy-coach-${id}`))

    const fallback = await screen.findByTestId('ruankao-qbank-copy-fallback-text')
    expect(
      screen.getByText('ruankao.questionBank.copyFallbackTitle'),
    ).toBeInTheDocument()
    expect((fallback as HTMLTextAreaElement).value).toContain('论幂等设计的应用')
    expect((fallback as HTMLTextAreaElement).value).toContain(
      '论幂等设计的应用 的第一问原文',
    )
  })

  it('edits and deletes user entries with confirm', () => {
    render(<QuestionBankPanel />)
    createViaForm({ title: '论网关限流的应用', domain: '网关' })
    const id = readStored().questions[0].id

    // 编辑：对话框预填，改标题保存后列表与 localStorage 同步
    fireEvent.click(screen.getByTestId(`ruankao-qbank-edit-${id}`))
    expect(screen.getByTestId('ruankao-qbank-form-title')).toHaveValue(
      '论网关限流的应用',
    )
    expect(screen.getByText('ruankao.questionBank.formTitleEdit')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('ruankao-qbank-form-title'), {
      target: { value: '论网关限流的进阶应用' },
    })
    fireEvent.click(screen.getByTestId('ruankao-qbank-form-submit'))
    expect(
      screen.getByText('论网关限流的进阶应用'),
    ).toBeInTheDocument()
    expect(readStored().questions[0].title).toBe('论网关限流的进阶应用')

    // 删除：确认对话框 → 列表与 localStorage 移除
    fireEvent.click(screen.getByTestId(`ruankao-qbank-delete-${id}`))
    expect(
      screen.getByText('ruankao.questionBank.deleteTitle'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ruankao-qbank-delete-confirm'))
    expect(
      screen.queryByTestId(`ruankao-qbank-item-${id}`),
    ).not.toBeInTheDocument()
    expect(readStored().questions).toHaveLength(0)
  })

  // G 线改写（原「详情三动作 A/B/C」用例组）：详情弹窗已升级为生成工作台，
  // A/B/C 教练通道内化为三区块的 [发给教练]（载荷=题面+产物+引导行）。
  describe('detail dialog: question info and full-essay channels', () => {
    it('shows the full question info of a real seed in the widened workbench dialog (C9)', () => {
      render(<QuestionBankPanel />)
      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${LAMBDA.id}`))

      // C9：弹窗宽度覆写带 sm: 前缀（基类 sm:max-w-[calc(100%-2rem)] 会压住
      // 裸 max-w-4xl——「sm: 前缀坑」防回归）
      const dialog = screen.getByTestId('ruankao-qbank-detail-dialog')
      expect(dialog.className).toContain('sm:max-w-4xl')
      expect(dialog.className).toContain('max-h-[85vh]')
      expect(dialog.className).toContain('overflow-y-auto')

      // 题面区：origin badge、年份、标题、三问原文、来源引用
      expect(
        within(dialog).getByTestId('ruankao-qbank-detail-origin-real'),
      ).toBeInTheDocument()
      expect(within(dialog).getByText('2024')).toBeInTheDocument()
      expect(within(dialog).getByText('论大数据Lambda架构')).toBeInTheDocument()
      expect(
        within(dialog).getByText(/批处理层（batch layer）/),
      ).toBeInTheDocument()
      expect(within(dialog).getByText('真题md · zhenti_md')).toBeInTheDocument()

      // D① 通道保留：真题md 来源 → 阅读对应文章（非「生成整篇练习文」）
      expect(
        screen.getByTestId('ruankao-qbank-detail-action-full-read'),
      ).toBeInTheDocument()
      expect(
        screen.queryByTestId('ruankao-qbank-detail-action-full-generate'),
      ).not.toBeInTheDocument()
    })

    it('routes D① to the essay read deep link for seeds with a source ref', () => {
      render(<QuestionBankPanel />)
      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${LAMBDA.id}`))

      fireEvent.click(screen.getByTestId('ruankao-qbank-detail-action-full-read'))

      expect(pushMock).toHaveBeenCalledWith(
        `/ruankao?tab=essay&read=${encodeURIComponent(LAMBDA.sourceRefs[0].sourceId!)}`,
      )
      // 弹窗随跳转关闭
      expect(
        screen.queryByTestId('ruankao-qbank-detail-dialog'),
      ).not.toBeInTheDocument()
      // 教练桥不被触发（D① 是阅读通道，不是生成通道）
      expect(writeCoachHandoffMock).not.toHaveBeenCalled()
    })

    it('writes the one-shot wizard seed and switches to environments for entries without any source ref (D②)', () => {
      render(<QuestionBankPanel />)
      createViaForm({
        title: '论分布式事务的应用',
        domain: '分布式',
      })
      const id = readStored().questions[0].id

      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${id}`))
      expect(
        screen.getByTestId('ruankao-qbank-detail-action-full-generate'),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('ruankao-qbank-detail-action-full-generate'))

      // 一次性种子带上题目关键词与名称（论前缀剥离见 wizard-seed 单测）
      const raw = sessionStorage.getItem('ruankao.wizardSeed.v1')
      expect(raw).not.toBeNull()
      const seed = JSON.parse(raw!) as { name: string; keywords: string[] }
      expect(seed.name).toBe('论分布式事务的应用')
      expect(seed.keywords).toContain('分布式事务的应用')
      // 切 environments tab；弹窗关闭
      expect(pushMock).toHaveBeenCalledWith('/ruankao?tab=environments')
      expect(
        screen.queryByTestId('ruankao-qbank-detail-dialog'),
      ).not.toBeInTheDocument()
    })
  })

  describe('question workbench', () => {
    function openLambdaDetail() {
      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${LAMBDA.id}`))
    }

    it('C1: opens with three kind blocks in idle, generate buttons ready', () => {
      render(<QuestionBankPanel />)
      openLambdaDetail()

      for (const kind of ['breakdown', 'q2_points', 'outline'] as const) {
        expect(
          screen.getByTestId(`ruankao-qbank-workbench-block-${kind}`),
        ).toBeInTheDocument()
        expect(
          screen.getByTestId(`ruankao-qbank-workbench-status-${kind}`).textContent,
        ).toBe('ruankao.questionBank.workbench.statusIdle')
        expect(
          screen.getByTestId(`ruankao-qbank-workbench-generate-${kind}`),
        ).toBeEnabled()
        // idle 态没有产物内容、没有教练/复制按钮（状态机：仅 ready/error 有）
        expect(
          screen.queryByTestId(`ruankao-qbank-workbench-content-${kind}`),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByTestId(`ruankao-qbank-workbench-coach-${kind}`),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByTestId(`ruankao-qbank-workbench-note-input-${kind}`),
        ).not.toBeInTheDocument()
      }
    })

    it('every title row carries a "?" help tooltip trigger with the tipToggle aria label', () => {
      render(<QuestionBankPanel />)
      openLambdaDetail()

      // 三个标题行各有一个 tip 触发按钮（testid 后缀与 kind 解耦：
      // breakdown→decode、q2_points→q2），aria-label 统一走 tipToggle 键
      for (const [kind, tipTestId] of [
        ['breakdown', 'ruankao-qbank-workbench-tip-decode'],
        ['q2_points', 'ruankao-qbank-workbench-tip-q2'],
        ['outline', 'ruankao-qbank-workbench-tip-outline'],
      ] as const) {
        const block = screen.getByTestId(
          `ruankao-qbank-workbench-block-${kind}`,
        )
        expect(within(block).getAllByTestId(tipTestId)).toHaveLength(1)
        expect(within(block).getByTestId(tipTestId)).toHaveAttribute(
          'aria-label',
          'ruankao.questionBank.workbench.tipToggle',
        )
      }
    })

    it('C2: generate enters generating state, disables every trigger (single flight) and shows the interrupt hint', () => {
      generateMock.mockImplementation(
        () => new Promise(() => undefined), // 挂起：观察生成中禁态
      )
      render(<QuestionBankPanel />)
      openLambdaDetail()

      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))

      expect(
        screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
      ).toBe('ruankao.questionBank.workbench.statusGenerating')
      // interruptHint 文案出现（关弹窗=中断的明示）
      expect(
        screen.getByText('ruankao.questionBank.workbench.interruptHint'),
      ).toBeInTheDocument()
      // 单飞：三个区块的生成触发按钮全部禁用（含发起块自身）
      expect(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown')).toBeDisabled()
      expect(screen.getByTestId('ruankao-qbank-workbench-generate-q2_points')).toBeDisabled()
      expect(screen.getByTestId('ruankao-qbank-workbench-generate-outline')).toBeDisabled()
      // 弹窗标题行进行中徽标
      expect(
        screen.getByTestId('ruankao-qbank-detail-generating-badge'),
      ).toBeInTheDocument()
      // 请求体只携带考试元数据 + 备注（红线：无 source_id，范文构造上不可达）；
      // generateStream 是 (data, onDelta, signal) 三参形态，断言只看 data 首参
      expect(generateMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          kind: 'breakdown',
          title: LAMBDA.title,
          year: LAMBDA.year,
          domain: LAMBDA.domain,
        }),
      )
      const body = generateMock.mock.calls[0][0] as Record<string, unknown>
      expect('source_id' in body).toBe(false)
    })

    it('C3: success renders the structured result with generated time and persists the cache', async () => {
      generateMock.mockResolvedValue(BREAKDOWN_RESULT)
      render(<QuestionBankPanel />)
      openLambdaDetail()

      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))

      await waitFor(() =>
        expect(
          screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
        ).toBe('ruankao.questionBank.workbench.statusReady'),
      )
      const content = screen.getByTestId('ruankao-qbank-workbench-content-breakdown')
      expect(content).toBeInTheDocument()
      // 角度名带「1. 」序号前缀渲染 → 正则匹配
      expect(within(content).getByText(/云原生弹性负载均衡/)).toBeInTheDocument()
      expect(within(content).getByText(/建议选角度一与角度二/)).toBeInTheDocument()
      expect(
        screen.getByText('ruankao.questionBank.workbench.generatedAt'),
      ).toBeInTheDocument()
      // ready 态出现 [重新生成]/[复制]/[发给教练]
      expect(screen.getByTestId('ruankao-qbank-workbench-regenerate-breakdown')).toBeEnabled()
      expect(screen.getByTestId('ruankao-qbank-workbench-copy-breakdown')).toBeEnabled()
      expect(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown')).toBeEnabled()

      // B1（UI 面）：localStorage 出现 entries[<种子id>][breakdown]
      const stored = readGenerations()
      expect(stored?.entries[LAMBDA.id]?.breakdown?.content).toEqual(BREAKDOWN_RESULT)
      expect(typeof stored?.entries[LAMBDA.id]?.breakdown?.generatedAt).toBe('string')
    })

    it('C4: 504 maps to the timeout copy with retry, 502 to the model-error copy, no-response to network', async () => {
      generateMock.mockRejectedValueOnce(apiError('model_timeout'))
      render(<QuestionBankPanel />)
      openLambdaDetail()

      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(
          screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
        ).toBe('ruankao.questionBank.workbench.statusError'),
      )
      expect(
        screen.getByText('ruankao.questionBank.workbench.errorTimeout'),
      ).toBeInTheDocument()

      // [重试] 可再发起：这次 mock 502 → model_error 文案
      generateMock.mockRejectedValueOnce(apiError('model_error'))
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-retry-breakdown'))
      await waitFor(() =>
        expect(
          screen.getByText('ruankao.questionBank.workbench.errorModel'),
        ).toBeInTheDocument(),
      )
      expect(generateMock).toHaveBeenCalledTimes(2)

      // 网络层失败（无 response）→ network 文案
      generateMock.mockRejectedValueOnce(new Error('network down'))
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-retry-breakdown'))
      await waitFor(() =>
        expect(
          screen.getByText('ruankao.questionBank.workbench.errorNetwork'),
        ).toBeInTheDocument(),
      )
    })

    it('C5: ready-state regenerate expands the note box and resends with the note after confirm', async () => {
      generateMock.mockResolvedValue(BREAKDOWN_RESULT)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<QuestionBankPanel />)
      openLambdaDetail()

      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(screen.getByTestId('ruankao-qbank-workbench-regenerate-breakdown')).toBeEnabled(),
      )

      // [重新生成] 展开备注框（idle 首次生成无备注框，C1 已断言）
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-regenerate-breakdown'))
      const noteInput = screen.getByTestId('ruankao-qbank-workbench-note-input-breakdown')
      fireEvent.change(noteInput, { target: { value: '往云原生方向拆' } })
      // 排队第二次响应（mockResolvedValueOnce 先于 apply 点击设置）
      generateMock.mockResolvedValueOnce({
        ...BREAKDOWN_RESULT,
        combo_advice: '按备注换向后的组合建议',
      })
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-note-apply-breakdown'))

      // confirm 文案含「覆盖」语义（overwriteConfirm 键），确认后携 note 重发
      expect(confirmSpy).toHaveBeenCalledWith(
        'ruankao.questionBank.workbench.overwriteConfirm',
      )
      await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(2))
      expect(generateMock.mock.calls[1][0]).toMatchObject({
        kind: 'breakdown',
        note: '往云原生方向拆',
      })

      // 成功后备注徽标 + 单结果覆盖（无第二个版本条目）
      await waitFor(() =>
        expect(
          within(screen.getByTestId('ruankao-qbank-workbench-content-breakdown')).getByText(/按备注换向/),
        ).toBeInTheDocument(),
      )
      expect(
        screen.getByText('ruankao.questionBank.workbench.noteBadge'),
      ).toBeInTheDocument()
      const perKind = readGenerations()?.entries[LAMBDA.id]
      expect(Object.keys(perKind ?? {})).toEqual(['breakdown'])
    })

    it('C6: copy puts the full product text on the clipboard; failure falls back to the dialog', async () => {
      generateMock.mockResolvedValue(BREAKDOWN_RESULT)
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(screen.getByTestId('ruankao-qbank-workbench-copy-breakdown')).toBeEnabled(),
      )

      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-copy-breakdown'))
      await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1))
      const copied = writeTextMock.mock.calls[0][0] as string
      expect(copied).toContain('云原生弹性负载均衡')
      expect(copied).toContain('建议选角度一与角度二')

      // 剪贴板失败 → 既有兜底弹窗（copyFallbackTitle 复用）
      mockClipboard(() => Promise.reject(new Error('denied')))
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-copy-breakdown'))
      const fallback = await screen.findByTestId('ruankao-qbank-copy-fallback-text')
      expect((fallback as HTMLTextAreaElement).value).toContain('云原生弹性负载均衡')
    })

    it('C7: coach handoff carries question + product + guide line; without a product it degrades to the current behavior', async () => {
      generateMock.mockRejectedValueOnce(apiError('model_error'))
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown')).toBeEnabled(),
      )

      // 未生成（error 态）：题面 + 引导行，不含产物段
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown'))
      await waitFor(() => expect(writeCoachHandoffMock).toHaveBeenCalledTimes(1))
      const degraded = writeCoachHandoffMock.mock.calls[0][0].text as string
      expect(degraded).toContain('论大数据Lambda架构')
      expect(degraded).toContain('请按论文教练的破题拆点流程')
      expect(degraded).not.toContain('云原生弹性负载均衡')

      // ready 态：题面 + 产物全文 + 引导行（error 态的再发起入口是 [重试]）
      generateMock.mockResolvedValueOnce(BREAKDOWN_RESULT)
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-retry-breakdown'))
      await waitFor(() =>
        expect(screen.getByTestId('ruankao-qbank-workbench-copy-breakdown')).toBeEnabled(),
      )
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown'))
      await waitFor(() => expect(writeCoachHandoffMock).toHaveBeenCalledTimes(2))
      const full = writeCoachHandoffMock.mock.calls[1][0].text as string
      expect(full).toContain('论大数据Lambda架构')
      expect(full).toContain('云原生弹性负载均衡')
      expect(full).toContain('请按论文教练的破题拆点流程')
    })

    it('C8: closing mid-generation discards the result; reopening shows idle with no loading residue', async () => {
      let resolveGenerate!: (value: typeof BREAKDOWN_RESULT) => void
      generateMock.mockImplementation(
        () =>
          new Promise<typeof BREAKDOWN_RESULT>((resolve) => {
            resolveGenerate = resolve
          }),
      )
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      expect(
        screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
      ).toBe('ruankao.questionBank.workbench.statusGenerating')

      // 生成中关弹窗（X 按钮）→ token 失配
      fireEvent.click(screen.getByText('common.close'))
      expect(
        screen.queryByTestId('ruankao-qbank-detail-dialog'),
      ).not.toBeInTheDocument()

      // 迟到的结果被丢弃：不写缓存、不改状态
      await act(async () => {
        resolveGenerate(BREAKDOWN_RESULT)
      })
      expect(readGenerations()).toBeNull()

      // 重开：区块回 idle，无残留 loading
      openLambdaDetail()
      expect(
        screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
      ).toBe('ruankao.questionBank.workbench.statusIdle')
      expect(
        screen.queryByText('ruankao.questionBank.workbench.interruptHint'),
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown')).toBeEnabled()
    })

    it('C9: streaming deltas render the live metrics panel (tail ticker + metrics row) until completion', async () => {
      // 两个 delta 落地后挂 50ms 再完成：生成中面板必须被渲染过
      generateMock.mockImplementation(
        (_data: unknown, onDelta?: (d: string) => void) =>
          new Promise((resolve) => {
            onDelta?.('{"angles": [{')
            onDelta?.('"name": "云原生弹性负载均衡"}]…尾部片段')
            // 600ms：让 500ms 节流帧先把 stream 快照刷上屏，再完成
            setTimeout(() => resolve(BREAKDOWN_RESULT), 600)
          }),
      )
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))

      const panel = screen.getByTestId('ruankao-qbank-workbench-stream-breakdown')
      // 指标行在场（速度/峰值/已用时/tokens 四键，恒等 t mock 下按 testid 断言）
      expect(
        within(panel).getByTestId('ruankao-qbank-workbench-stream-breakdown-metrics'),
      ).toBeInTheDocument()
      // 尾部滚动要等 500ms 节流帧：含最后一个 delta 的结尾（数据流可见性）
      await waitFor(() =>
        expect(
          within(panel).getByTestId('ruankao-qbank-workbench-stream-breakdown-tail')
            .textContent,
        ).toContain('尾部片段'),
      )

      await waitFor(() =>
        expect(
          screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
        ).toBe('ruankao.questionBank.workbench.statusReady'),
      )
      // 完成后面板退场
      expect(
        screen.queryByTestId('ruankao-qbank-workbench-stream-breakdown'),
      ).not.toBeInTheDocument()
    })

    it('C10: QuestionStreamError reasons map to the same copy keys as the sync endpoint', async () => {
      generateMock.mockRejectedValueOnce(new QuestionStreamError('model_timeout'))
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(
          screen.getByText('ruankao.questionBank.workbench.errorTimeout'),
        ).toBeInTheDocument(),
      )

      generateMock.mockRejectedValueOnce(new QuestionStreamError('network'))
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-retry-breakdown'))
      await waitFor(() =>
        expect(
          screen.getByText('ruankao.questionBank.workbench.errorNetwork'),
        ).toBeInTheDocument(),
      )
    })

    it('C11: SSE stage events render the phase line — preparing first, then thinking overrides', async () => {
      let stageSink: ((stage: string) => void) | undefined
      let resolveGenerate!: (value: typeof BREAKDOWN_RESULT) => void
      generateMock.mockImplementation(
        (
          _data: unknown,
          _onDelta?: (d: string) => void,
          _signal?: AbortSignal,
          onStage?: (stage: string) => void,
        ) => {
          stageSink = onStage
          onStage?.('preparing')
          return new Promise<typeof BREAKDOWN_RESULT>((resolve) => {
            resolveGenerate = resolve
          })
        },
      )
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))

      // preparing 先上屏（恒等 t mock 下按 i18n 键断言）
      expect(
        screen.getByTestId('ruankao-qbank-workbench-stream-breakdown-stage')
          .textContent,
      ).toBe('ruankao.questionBank.workbench.stream.stage.preparing')

      // thinking 到达后覆盖 preparing
      await act(async () => {
        stageSink?.('thinking')
      })
      expect(
        screen.getByTestId('ruankao-qbank-workbench-stream-breakdown-stage')
          .textContent,
      ).toBe('ruankao.questionBank.workbench.stream.stage.thinking')

      // 乱序 waiting 不回退（generating/thinking 覆盖 waiting/preparing）
      await act(async () => {
        stageSink?.('waiting')
      })
      expect(
        screen.getByTestId('ruankao-qbank-workbench-stream-breakdown-stage')
          .textContent,
      ).toBe('ruankao.questionBank.workbench.stream.stage.thinking')

      // complete 清空阶段行：面板整体退场
      await act(async () => {
        resolveGenerate(BREAKDOWN_RESULT)
      })
      await waitFor(() =>
        expect(
          screen.queryByTestId('ruankao-qbank-workbench-stream-breakdown'),
        ).not.toBeInTheDocument(),
      )
    })

    it('C12: the stop button aborts the in-flight AbortSignal and the half-run is discarded', async () => {
      let abortSignal: AbortSignal | undefined
      let rejectGenerate!: (error: unknown) => void
      generateMock.mockImplementation(
        (
          _data: unknown,
          _onDelta?: (d: string) => void,
          signal?: AbortSignal,
        ) => {
          abortSignal = signal
          return new Promise<never>((_resolve, reject) => {
            rejectGenerate = reject
          })
        },
      )
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      expect(abortSignal).toBeDefined()

      // 点停止：generateStream 收到的 AbortSignal 被 abort（mock 侧监听）
      const aborted = new Promise<void>((resolve) => {
        abortSignal?.addEventListener('abort', () => resolve())
      })
      fireEvent.click(
        screen.getByTestId('ruankao-qbank-workbench-stream-breakdown-stop'),
      )
      await aborted
      expect(abortSignal?.aborted).toBe(true)

      // 真 fetch 语义：abort → AbortError 拒绝（面板终止=丢弃 → 区块回 idle）
      await act(async () => {
        rejectGenerate(new DOMException('Aborted', 'AbortError'))
      })
      await waitFor(() =>
        expect(
          screen.getByTestId('ruankao-qbank-workbench-status-breakdown')
            .textContent,
        ).toBe('ruankao.questionBank.workbench.statusIdle'),
      )
      // 半截结果不落盘，生成入口恢复可用
      expect(readGenerations()).toBeNull()
      expect(
        screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'),
      ).toBeEnabled()
    })

    it('B2: reopening the dialog shows the cached result with zero network calls (seed id and user uuid)', async () => {
      generateMock.mockResolvedValue(BREAKDOWN_RESULT)
      const { unmount } = render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(
          screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
        ).toBe('ruankao.questionBank.workbench.statusReady'),
      )
      unmount()

      // 重挂载重开（= 刷新后）：种子稳定 id 缓存命中直接 ready，端点零调用
      generateMock.mockClear()
      const secondView = render(<QuestionBankPanel />)
      openLambdaDetail()
      expect(
        screen.getByTestId('ruankao-qbank-workbench-status-breakdown').textContent,
      ).toBe('ruankao.questionBank.workbench.statusReady')
      expect(
        within(screen.getByTestId('ruankao-qbank-workbench-content-breakdown')).getByText(
          /云原生弹性负载均衡/,
        ),
      ).toBeInTheDocument()
      expect(generateMock).not.toHaveBeenCalled()

      // 自录题（UUID）同验一条
      generateMock.mockResolvedValue({
        kind: 'outline',
        paragraphs: [
          { role: 'q2', outline: 'Q2 提纲', data_anchors: ['QPS 对比'] },
          { role: 'q3', outline: 'Q3 提纲', data_anchors: ['恢复时长'] },
        ],
      })
      createViaForm({ title: '论消息队列的应用' })
      const userId = readStored().questions[0].id
      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${userId}`))
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-outline'))
      await waitFor(() =>
        expect(
          screen.getByTestId('ruankao-qbank-workbench-status-outline').textContent,
        ).toBe('ruankao.questionBank.workbench.statusReady'),
      )
      secondView.unmount()
      generateMock.mockClear()
      render(<QuestionBankPanel />)
      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${userId}`))
      expect(
        screen.getByTestId('ruankao-qbank-workbench-status-outline').textContent,
      ).toBe('ruankao.questionBank.workbench.statusReady')
      expect(generateMock).not.toHaveBeenCalled()
    })

    it('hands the no-notebook bridge result to the toast path from the error state without throwing', async () => {
      writeCoachHandoffMock.mockResolvedValue({ ok: false, reason: 'no_notebook' })
      generateMock.mockRejectedValue(apiError('model_error'))
      render(<QuestionBankPanel />)
      openLambdaDetail()
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown')).toBeEnabled(),
      )
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown'))
      await waitFor(() => expect(writeCoachHandoffMock).toHaveBeenCalledTimes(1))
      // 不抛错即通过（toast 由 sonner 全局渲染，断言桥结果分支被消费）
      expect(
        screen.getByTestId('ruankao-qbank-detail-dialog'),
      ).toBeInTheDocument()
    })

    it('omits empty prompt sections from the coach handoff for title-only seeds', async () => {
      generateMock.mockRejectedValue(apiError('model_error'))
      render(<QuestionBankPanel />)
      // 2025 下考生回忆简记：q2/q3 为空
      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${NOTE.id}`))
      // q2/q3 两个空问各显示一条引导提示
      expect(
        screen.getByTestId('ruankao-qbank-detail-empty-q2'),
      ).toBeInTheDocument()
      expect(
        screen.getByTestId('ruankao-qbank-detail-empty-q3'),
      ).toBeInTheDocument()

      // error 态的教练通道退化为题面 + 引导行（未生成不含产物段）
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'))
      await waitFor(() =>
        expect(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown')).toBeEnabled(),
      )
      fireEvent.click(screen.getByTestId('ruankao-qbank-workbench-coach-breakdown'))
      await waitFor(() => expect(writeCoachHandoffMock).toHaveBeenCalledTimes(1))
      const text = writeCoachHandoffMock.mock.calls[0][0].text as string
      expect(text).toContain('软件测试')
      expect(text).not.toContain('ruankao.questionBank.q2Label')
      expect(text).not.toContain('ruankao.questionBank.q3Label')
    })
  })

  // 宽屏治理 L 线 §2.2（紧凑行 className 约束级断言；真实像素列为手动项）
  describe('compact row layout constraints', () => {
    it('keeps rows single-flow: group root, no justify-between, no flex-1 cluster', () => {
      render(<QuestionBankPanel />)

      // A2：行根带 group（hover 显隐锚点）且不再两端撑开；行内不存在
      // flex-1 内容簇——操作组紧跟内容簇，与视口宽度无关
      const row = screen.getByTestId(`ruankao-qbank-item-${LAMBDA.id}`)
      expect(row).toHaveClass('group')
      expect(row).not.toHaveClass('justify-between')
      expect(row.querySelector('.flex-1')).toBeNull()
    })

    it('caps the row title with truncate + max-w-md + lg:max-w-lg', () => {
      render(<QuestionBankPanel />)

      // A3：标题截断封顶（结构上限「标题→详情按钮」距离 ≈ ≤720px）
      const row = screen.getByTestId(`ruankao-qbank-item-${LAMBDA.id}`)
      const title = within(row).getByText('论大数据Lambda架构')
      expect(title).toHaveClass('truncate')
      expect(title).toHaveClass('max-w-md')
      expect(title).toHaveClass('lg:max-w-lg')
    })

    it('reveals user-row edit/delete via hover + focus-within + pointer-coarse, never on seed rows', () => {
      render(<QuestionBankPanel />)
      createViaForm({ title: '论行布局约束的应用', domain: '布局' })
      const userId = readStored().questions[0].id

      // A4：低频破坏性操作组显隐类（触屏无 hover 时 pointer-coarse 常驻，
      // 裁决 0-7；键盘 focus-within 兜底）
      const editButton = screen.getByTestId(`ruankao-qbank-edit-${userId}`)
      const hoverGroup = editButton.parentElement as HTMLElement
      expect(hoverGroup).toHaveClass('opacity-0')
      expect(hoverGroup).toHaveClass('group-hover:opacity-100')
      expect(hoverGroup).toHaveClass('focus-within:opacity-100')
      expect(hoverGroup).toHaveClass('pointer-coarse:opacity-100')

      // 种子条目行不渲染该 hover 组（不可变常量无从编辑/删除）
      const seedRow = screen.getByTestId(`ruankao-qbank-item-${LAMBDA.id}`)
      expect(seedRow.querySelector('.pointer-coarse\\:opacity-100')).toBeNull()
      expect(seedRow.querySelector('.opacity-0')).toBeNull()
    })
  })

  // 列表三项改造（B/C 线）：生成过的题按最近生成时间排前 + 生成进度角标 +
  // 操作区靠右
  describe('list generation progress and row actions', () => {
    const rowIds = () =>
      screen
        .getAllByTestId(/^ruankao-qbank-item-/)
        .map((el) => el.getAttribute('data-testid'))

    it('sorts questions with generation products ahead by latest generation time (stable otherwise)', () => {
      const first = render(<QuestionBankPanel />)
      createViaForm({ title: '论排序甲的应用' })
      createViaForm({ title: '论排序乙的应用' })
      const [firstId, secondId] = readStored().questions.map((q) => q.id)

      // 固定 updatedAt：默认顺序 [甲, 乙]（乙更旧排后）；重挂载读取补丁
      patchUserQuestion(firstId, { updatedAt: '2026-06-01T00:00:00.000Z' })
      patchUserQuestion(secondId, { updatedAt: '2026-01-01T00:00:00.000Z' })
      first.unmount()
      const second = render(<QuestionBankPanel />)
      expect(rowIds()[0]).toBe(`ruankao-qbank-item-${firstId}`)
      expect(rowIds()[1]).toBe(`ruankao-qbank-item-${secondId}`)

      // 只给后一条（乙）种生成产物 → 乙排到甲前面
      seedGenerations(secondId, ['breakdown'], '2026-05-01T00:00:00.000Z')
      second.unmount()
      const third = render(<QuestionBankPanel />)
      expect(rowIds()[0]).toBe(`ruankao-qbank-item-${secondId}`)
      expect(rowIds()[1]).toBe(`ruankao-qbank-item-${firstId}`)

      // 两条都有产物：按 latest 降序（乙 05-01 > 甲 04-01 → 乙仍在前）
      seedGenerations(firstId, ['breakdown'], '2026-04-01T00:00:00.000Z')
      third.unmount()
      const fourth = render(<QuestionBankPanel />)
      expect(rowIds()[0]).toBe(`ruankao-qbank-item-${secondId}`)

      // 甲的最近生成时间更新（07-01）→ 甲回到最前
      seedGenerations(firstId, ['breakdown'], '2026-07-01T00:00:00.000Z')
      fourth.unmount()
      render(<QuestionBankPanel />)
      expect(rowIds()[0]).toBe(`ruankao-qbank-item-${firstId}`)
      expect(rowIds()[1]).toBe(`ruankao-qbank-item-${secondId}`)
    })

    it('shows the per-row {{done}}/{{total}} badge with aria label, highlighted at 3/3', () => {
      const first = render(<QuestionBankPanel />)
      createViaForm({ title: '论角标甲的应用' })
      createViaForm({ title: '论角标乙的应用' })
      const [firstId, secondId] = readStored().questions.map((q) => q.id)
      seedGenerations(
        secondId,
        ['breakdown', 'q2_points'],
        '2026-05-01T00:00:00.000Z',
      )
      first.unmount()
      const second = render(<QuestionBankPanel />)

      // done=2：等宽数字角标 "2/3"，aria-label 携带完成数与总数；未满 3 不高亮
      const badge = screen.getByTestId(
        `ruankao-qbank-generated-badge-${secondId}`,
      )
      expect(badge).toHaveTextContent('2/3')
      expect(badge).toHaveAttribute('aria-label', '2 of 3 details generated')
      expect(badge).toHaveClass('tabular-nums')
      expect(badge).not.toHaveClass('text-primary')

      // 无产物行恒显 0/3
      expect(
        screen.getByTestId(`ruankao-qbank-generated-badge-${firstId}`)
          .textContent,
      ).toBe('0/3')

      // 补齐第三个 kind → 3/3 高亮（text-primary）
      seedGenerations(secondId, ['outline'], '2026-05-02T00:00:00.000Z')
      second.unmount()
      render(<QuestionBankPanel />)
      const full = screen.getByTestId(
        `ruankao-qbank-generated-badge-${secondId}`,
      )
      expect(full).toHaveTextContent('3/3')
      expect(full).toHaveClass('text-primary')

      // 技术域列固定宽度（所有行该列对齐的保证）
      expect(
        screen.getByTestId(`ruankao-qbank-domain-cell-${secondId}`),
      ).toHaveClass('w-40', 'shrink-0')
    })

    it('refreshes the row badge right after a generation finishes (genTick), no remount', async () => {
      generateMock.mockResolvedValue(BREAKDOWN_RESULT)
      render(<QuestionBankPanel />)
      createViaForm({ title: '论即时刷新的应用' })
      const userId = readStored().questions[0].id

      // 生成前：角标 0/3
      expect(
        screen.getByTestId(`ruankao-qbank-generated-badge-${userId}`)
          .textContent,
      ).toBe('0/3')

      // 打开详情生成 breakdown，成功落盘（then 在 finally 之前）
      fireEvent.click(screen.getByTestId(`ruankao-qbank-detail-${userId}`))
      fireEvent.click(
        screen.getByTestId('ruankao-qbank-workbench-generate-breakdown'),
      )
      await waitFor(() =>
        expect(
          screen.getByTestId('ruankao-qbank-workbench-status-breakdown')
            .textContent,
        ).toBe('ruankao.questionBank.workbench.statusReady'),
      )

      // 不重挂载：runGeneration finally 递增 genTick → 列表角标即时 0/3 → 1/3
      await waitFor(() =>
        expect(
          screen.getByTestId(`ruankao-qbank-generated-badge-${userId}`)
            .textContent,
        ).toBe('1/3'),
      )
    })

    it('pushes the actions cluster to the row end with ml-auto, outside the practiced column', () => {
      render(<QuestionBankPanel />)

      // 操作区容器 ml-auto 靠右（详情/复制/编辑/删除都在其中）
      const row = screen.getByTestId(`ruankao-qbank-item-${LAMBDA.id}`)
      const actions = within(row).getByTestId(
        `ruankao-qbank-actions-${LAMBDA.id}`,
      )
      expect(actions).toHaveClass('ml-auto')

      // 练习状态列在操作区容器之外（操作区与技术域/练习状态列分开）
      expect(
        within(actions).queryByTestId(
          `ruankao-qbank-practiced-toggle-${LAMBDA.id}`,
        ),
      ).not.toBeInTheDocument()
      expect(
        within(row).getByTestId(`ruankao-qbank-practiced-toggle-${LAMBDA.id}`),
      ).toBeInTheDocument()
    })
  })
})

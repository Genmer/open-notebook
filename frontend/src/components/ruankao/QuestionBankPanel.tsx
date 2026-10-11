'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  HelpCircle,
  ListChecks,
  PenLine,
  Pencil,
  Plus,
  Table2,
  Trash2,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  QuestionStreamError,
  ruankaoQuestionsApi,
} from '@/lib/api/ruankao-questions'
import { writeCoachHandoff } from '@/lib/ruankao/coach-handoff'
import { GenerationStatusPanel } from '@/components/ruankao/GenerationStatusPanel'
import {
  computeStreamMetrics,
  type StreamMetricsSample,
} from '@/lib/ruankao/stream-metrics'
import {
  GENERATIONS_KINDS,
  getGenerationSummary,
  readGeneration,
  saveGeneration,
  type GenerationKind,
  type GenerationSummary,
} from '@/lib/ruankao/question-generations'
import {
  loadQuestions,
  newQuestionId,
  nowIso,
  saveQuestions,
  type RuankaoQuestion,
} from '@/lib/ruankao/question-bank'
import { writeWizardSeed, wizardSeedFromQuestion } from '@/lib/ruankao/wizard-seed'
import type {
  BreakdownResult,
  OutlineResult,
  Q2PointsResult,
  QuestionGenerateResult,
} from '@/lib/types/api'

type PracticedFilter = 'all' | 'unpracticed' | 'practiced'
type OriginFilter = 'all' | 'real' | 'mock'

/** 列表行视图：题目 + 生成进度汇总（角标渲染复用，避免行内重复读缓存） */
interface VisibleRow {
  q: RuankaoQuestion
  summary: GenerationSummary
}

interface QuestionFormState {
  year: string
  title: string
  domain: string
  q1: string
  q2: string
  q3: string
}

const EMPTY_FORM: QuestionFormState = {
  year: '',
  title: '',
  domain: '',
  q1: '',
  q2: '',
  q3: '',
}

// 尾部引导行是教练载荷（消费方是中文「软考论文写作教练」智能体），不是
// UI 文案，按设计稿固定中文原文，不走 i18n。三条分别对应详情动作 A/B/C：
// 措辞全部贴合教练红线——提纲与要点供参照，正文与主旨句必须考生自己写。
const COACH_GUIDE_DECODE =
  '请按论文教练的破题拆点流程，把该题目拆成 4-6 个候选论点角度'
const COACH_GUIDE_Q2 =
  '请针对问题2，先列出技术方法要点清单，再给该段提纲；要点与提纲供考生参照，正文必须由考生自己写'
const COACH_GUIDE_ARGUMENTS =
  '请为论点区给出两段提纲（每段列论点主旨候选句与支撑素材方向），示范段仅作结构参考；论点主旨句必须经考生自己改写定稿'

// 年份输入的 placeholder：软考批次的事实格式示例（数据格式，非文案）
const YEAR_PLACEHOLDER = '2024 上'

// ── 生成工作台（G 线）──────────────────────────────────────────────
// 区块状态机（每 kind 独立，互不阻塞；设计稿 1.5.2）：
//   idle ──[生成]──▶ generating ──成功──▶ ready ──[重新生成→备注→confirm 覆盖]──▶ generating
//                        │                                      │
//                        └──失败──▶ error ──[重试]──▶ generating
// 面板级单飞：同一时刻至多 1 个在途请求（其余区块触发按钮禁用），叠加
// 服务端 _invoke_json 节流锁双保险。关弹窗 = 中断（结果丢弃，token 失配）。
type WorkbenchPhase = 'idle' | 'generating' | 'ready' | 'error'

interface WorkbenchState {
  phase: WorkbenchPhase
  content?: QuestionGenerateResult
  generatedAt?: string
  note?: string
  errorKey?: string
  /** generating 期间由 500ms 节流快照刷新（流式速度/峰值/已用时） */
  stream?: StreamMetricsSample
  /** SSE stage 事件值（preparing/waiting/thinking/generating）；complete/error 清空 */
  stage?: string
}

type WorkbenchBlocks = Record<GenerationKind, WorkbenchState>
type CollapsedMap = Record<GenerationKind, boolean>

const INITIAL_BLOCKS: WorkbenchBlocks = {
  breakdown: { phase: 'idle' },
  q2_points: { phase: 'idle' },
  outline: { phase: 'idle' },
}

const INITIAL_COLLAPSED: CollapsedMap = {
  breakdown: true,
  q2_points: true,
  outline: true,
}

// 键用完整字面量（Unused Key Detection 门禁）；区块标题复用既有动作键
const KIND_TITLE_KEYS: Record<GenerationKind, string> = {
  breakdown: 'ruankao.questionBank.actionDecode',
  q2_points: 'ruankao.questionBank.actionQ2',
  outline: 'ruankao.questionBank.actionArguments',
}

// 标题行「?」悬浮解释：tooltip 主文案键 + testid 后缀（breakdown→decode、
// q2_points→q2，与 kind 名解耦；tipRelation 三区块共用，内联字面量）。键用
// 完整字面量（Unused Key Detection 门禁）。
const KIND_TIP_KEYS: Record<GenerationKind, string> = {
  breakdown: 'ruankao.questionBank.workbench.tipDecode',
  q2_points: 'ruankao.questionBank.workbench.tipQ2',
  outline: 'ruankao.questionBank.workbench.tipOutline',
}

const KIND_TIP_TESTIDS: Record<GenerationKind, string> = {
  breakdown: 'ruankao-qbank-workbench-tip-decode',
  q2_points: 'ruankao-qbank-workbench-tip-q2',
  outline: 'ruankao-qbank-workbench-tip-outline',
}

const KIND_GUIDE_LINES: Record<GenerationKind, string> = {
  breakdown: COACH_GUIDE_DECODE,
  q2_points: COACH_GUIDE_Q2,
  outline: COACH_GUIDE_ARGUMENTS,
}

const KIND_BLOCK_ICONS: Record<GenerationKind, typeof Table2> = {
  breakdown: Table2,
  q2_points: ListChecks,
  outline: PenLine,
}

const DIFFICULTY_KEYS: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'ruankao.questionBank.workbench.breakdown.difficultyEasy',
  medium: 'ruankao.questionBank.workbench.breakdown.difficultyMedium',
  hard: 'ruankao.questionBank.workbench.breakdown.difficultyHard',
}

const RISK_KEYS: Record<'low' | 'medium' | 'high', string> = {
  low: 'ruankao.questionBank.workbench.breakdown.riskLow',
  medium: 'ruankao.questionBank.workbench.breakdown.riskMedium',
  high: 'ruankao.questionBank.workbench.breakdown.riskHigh',
}

// 422/502/504/网络错误 → i18n 键（对齐 EssayPanel fixedPartsErrorKey 先例；
// axios 网络层失败没有 response）。导出供工作台测试直接钉分流口径。
export function questionGenerationErrorKey(error: unknown): string {
  if (error instanceof QuestionStreamError) {
    if (error.reason === 'no_title')
      return 'ruankao.questionBank.workbench.errorNoTitle'
    if (error.reason === 'model_timeout')
      return 'ruankao.questionBank.workbench.errorTimeout'
    if (error.reason === 'network')
      return 'ruankao.questionBank.workbench.errorNetwork'
    return 'ruankao.questionBank.workbench.errorModel'
  }
  const axiosError = error as
    | { response?: { data?: { detail?: { reason?: string } } } }
    | null
  const reason = axiosError?.response?.data?.detail?.reason
  if (reason === 'no_title')
    return 'ruankao.questionBank.workbench.errorNoTitle'
  if (reason === 'model_timeout')
    return 'ruankao.questionBank.workbench.errorTimeout'
  if (!axiosError?.response)
    return 'ruankao.questionBank.workbench.errorNetwork'
  return 'ruankao.questionBank.workbench.errorModel'
}

// 挂载水合：读缓存命中 → ready（显示生成时间与备注徽标），未命中 → idle
function hydrateBlock(
  q: RuankaoQuestion,
  kind: GenerationKind,
): WorkbenchState {
  const hit = readGeneration(q, kind)
  if (!hit) return { phase: 'idle' }
  return {
    phase: 'ready',
    content: hit.content,
    generatedAt: hit.generatedAt,
    note: hit.note,
  }
}

// 区块产物视图（结构化渲染；节标题键见设计稿 §4.2 复用清单）
function BreakdownContentView({ content }: { content: BreakdownResult }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        {content.angles.map((angle, index) => (
          <div
            key={`${angle.name}-${index}`}
            className="grid gap-1 rounded-md border p-2"
          >
            <p className="text-sm font-medium">
              {index + 1}. {angle.name}
            </p>
            <p className="text-sm text-muted-foreground">{angle.thesis_hint}</p>
            <p className="text-xs text-muted-foreground">
              {t('ruankao.questionBank.workbench.breakdown.materialMatchHeader')}
              : {angle.material_match}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">
                {t('ruankao.questionBank.workbench.breakdown.difficultyHeader')}:{' '}
                {t(DIFFICULTY_KEYS[angle.difficulty])}
              </Badge>
              <Badge variant="outline">
                {t('ruankao.questionBank.workbench.breakdown.riskHeader')}:{' '}
                {t(RISK_KEYS[angle.similarity_risk])}
              </Badge>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t('ruankao.questionBank.workbench.breakdown.comboAdviceTitle')}
        </p>
        <p className="whitespace-pre-wrap text-sm">{content.combo_advice}</p>
      </div>
    </div>
  )
}

function Q2PointsContentView({ content }: { content: Q2PointsResult }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t('ruankao.questionBank.workbench.q2.frameworkTitle')}
        </p>
        <p className="whitespace-pre-wrap text-sm">{content.framework}</p>
      </div>
      <div className="grid gap-2">
        {content.points.map((point, index) => (
          <div
            key={`${point.heading}-${index}`}
            className="grid gap-1 rounded-md border p-2"
          >
            <p className="text-sm font-medium">
              {index + 1}. {point.heading}
            </p>
            <p className="text-sm text-muted-foreground">{point.detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t('ruankao.questionBank.workbench.q2.outlineHintTitle')}
        </p>
        <p className="whitespace-pre-wrap text-sm">{content.outline_hint}</p>
      </div>
    </div>
  )
}

function OutlineContentView({ content }: { content: OutlineResult }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3">
      {content.paragraphs.map((paragraph) => (
        <div key={paragraph.role} className="grid gap-1 rounded-md border p-2">
          <Badge variant="outline" className="w-fit">
            {paragraph.role === 'q2'
              ? t('ruankao.questionBank.workbench.outline.roleQ2')
              : t('ruankao.questionBank.workbench.outline.roleQ3')}
          </Badge>
          <p className="whitespace-pre-wrap text-sm">{paragraph.outline}</p>
          <div className="grid gap-0.5">
            <p className="text-xs font-medium text-muted-foreground">
              {t('ruankao.questionBank.workbench.outline.dataAnchorsTitle')}
            </p>
            <ul className="list-disc pl-5">
              {paragraph.data_anchors.map((anchor, index) => (
                <li
                  key={`${anchor}-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  {anchor}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}

function isValidForm(form: QuestionFormState): boolean {
  return [form.title, form.q1, form.q2, form.q3].every(
    (value) => value.trim().length > 0,
  )
}

// 面板排序（设计稿 Q 线定稿）：user 在前 → year 倒序（无年份排尾）→
// 同年 real 在前 → 更新时间倒序兜底。user 条目恒为 mock，real 规则只在
// 种子之间生效；导出供 question-bank 单测直测。
export function compareQuestionsDesc(
  a: RuankaoQuestion,
  b: RuankaoQuestion,
): number {
  const sourceCmp =
    (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1)
  if (sourceCmp !== 0) return sourceCmp
  const aYear = a.year.trim()
  const bYear = b.year.trim()
  if (aYear && bYear) {
    const yearCmp = bYear.localeCompare(aYear, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
    if (yearCmp !== 0) return yearCmp
  } else if (!aYear && bYear) {
    return 1
  } else if (aYear && !bYear) {
    return -1
  }
  if (a.origin !== b.origin) return a.origin === 'real' ? -1 : 1
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
}

// D① 通道优先级（设计稿 ①）：范文正文夹 → 真题 md → 论文 PDF，都跳
// read 视图人眼阅读（ADR-017 例行通道）；exam_note 纯文本出处不参与。
function readSourceIdFor(q: RuankaoQuestion): string | null {
  for (const kind of ['essay_library', 'zhenti_md', 'lunwen_pdf'] as const) {
    const ref = q.sourceRefs.find((r) => r.kind === kind && r.sourceId)
    if (ref?.sourceId) return ref.sourceId
  }
  return null
}

// 题库面板：种子真题/模拟 + 自建题目 CRUD。零后端：种子常量（只含考试
// 元数据）+ localStorage v2 自建（ruankao.questions.v2，user 条目 + 种子
// 练过覆写表）。真题正文绝不入库、绝不进生成语境（ADR-017）。
export function QuestionBankPanel() {
  const { t } = useTranslation()
  const router = useRouter()

  // SSR/水合安全：localStorage 只在挂载后读，避免服务端/客户端首帧不一致
  const [questions, setQuestions] = useState<RuankaoQuestion[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setQuestions(loadQuestions())
    setReady(true)
  }, [])

  const commit = (next: RuankaoQuestion[]) => {
    setQuestions(next)
    saveQuestions(next)
  }

  // 过滤器（本地内存态）
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [practicedFilter, setPracticedFilter] = useState<PracticedFilter>('all')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')
  const [search, setSearch] = useState('')

  // 新建/编辑对话框（同一 Dialog，editingId 区分）
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<QuestionFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState(false)

  // 详情对话框：存 id 而非对象（练过翻转后弹窗数据跟着列表走，不 snapshot）
  const [detailId, setDetailId] = useState<string | null>(null)
  const detailQuestion = questions.find((q) => q.id === detailId) ?? null

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<RuankaoQuestion | null>(null)

  // 剪贴板不可用时的兜底展示（带各自的完成 toast 键：列表复制与工作台复制不同）
  const [fallbackCopy, setFallbackCopy] = useState<{
    text: string
    doneKey: string
  } | null>(null)
  const fallbackTextRef = useRef<HTMLTextAreaElement | null>(null)

  // 工作台状态：按题目×kind 二维组织；折叠/备注框是会话内存态（不进 localStorage）
  const [blocks, setBlocks] = useState<WorkbenchBlocks>(INITIAL_BLOCKS)
  const [collapsed, setCollapsed] = useState<CollapsedMap>(INITIAL_COLLAPSED)
  const [noteOpen, setNoteOpen] = useState<CollapsedMap>(INITIAL_COLLAPSED)
  const [noteDrafts, setNoteDrafts] = useState<Record<GenerationKind, string>>({
    breakdown: '',
    q2_points: '',
    outline: '',
  })
  // 面板级单飞：同一时刻至多 1 个生成请求在途（限流第一道闸，设计稿 1.5.3）
  const [flightKind, setFlightKind] = useState<GenerationKind | null>(null)
  // 在途请求令牌：detailId 任何变化（含关闭）都递增 → 旧请求结果一律丢弃
  const runTokenRef = useRef(0)
  // 流式在途请求的中止器：关弹窗/切题时 abort——服务端同步取消模型调用省额度
  const abortRef = useRef<AbortController | null>(null)
  // 流式累计（delta 时间戳/字符/尾部/起点/峰值）：500ms 节流快照进 block.stream
  const streamStatsRef = useRef({
    deltaTimes: [] as number[],
    chars: 0,
    tail: '',
    startedAt: 0,
    peakTps: 0,
  })

  // 生成刷新信号：runGeneration 收尾（成功/失败）递增，强制 visible 重读
  // 生成缓存 —— 生成完成后列表排序与角标即时刷新（产物在 then 落盘，先于 finally）
  const [genTick, setGenTick] = useState(0)

  const domains = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const q of questions) {
      const domain = q.domain.trim()
      if (domain && !seen.has(domain)) {
        seen.add(domain)
        out.push(domain)
      }
    }
    return out
  }, [questions])

  // 列表排序：在既有 compareQuestionsDesc 之上叠加生成进度层——有产物
  // （done>0）的题排前面按最近生成时间（latest）降序；无产物的保持既有
  // 相对顺序（sort 稳定 + 组内仍走 compareQuestionsDesc）。genTick 仅作
  // 依赖信号（见上），不参与计算。
  const visible = useMemo<VisibleRow[]>(() => {
    void genTick
    const needle = search.trim().toLowerCase()
    return questions
      .filter((q) => domainFilter === 'all' || q.domain.trim() === domainFilter)
      .filter(
        (q) =>
          practicedFilter === 'all' ||
          (practicedFilter === 'practiced' ? q.practiced : !q.practiced),
      )
      .filter(
        (q) => originFilter === 'all' || q.origin === originFilter,
      )
      .filter(
        (q) => needle === '' || q.title.toLowerCase().includes(needle),
      )
      .map((q) => ({ q, summary: getGenerationSummary(q.id) }))
      .sort((a, b) => {
        const aGenerated = a.summary.done > 0
        const bGenerated = b.summary.done > 0
        if (aGenerated && bGenerated) {
          const latestCmp = (b.summary.latest ?? 0) - (a.summary.latest ?? 0)
          if (latestCmp !== 0) return latestCmp
        } else if (aGenerated !== bGenerated) {
          return aGenerated ? -1 : 1
        }
        return compareQuestionsDesc(a.q, b.q)
      })
  }, [questions, domainFilter, practicedFilter, originFilter, search, genTick])

  // 工作台水合：detailId 变化时按题目×kind 从缓存恢复（ready 直接展示、
  // idle 折叠一行，设计稿 1.5.2）；生成中关弹窗 = 中断（token 失配 → 结果
  // 丢弃），重开回 idle 无残留 loading。依赖只跟 detailId：练过翻转等列表
  // 刷新不得打断生成中的区块。
  useEffect(() => {
    runTokenRef.current += 1
    abortRef.current?.abort()
    setFlightKind(null)
    setNoteOpen(INITIAL_COLLAPSED)
    setNoteDrafts({ breakdown: '', q2_points: '', outline: '' })
    if (detailId == null) return
    const q = questions.find((item) => item.id === detailId)
    if (!q) return
    const nextBlocks = { ...INITIAL_BLOCKS }
    const nextCollapsed = { ...INITIAL_COLLAPSED }
    for (const kind of GENERATIONS_KINDS) {
      nextBlocks[kind] = hydrateBlock(q, kind)
      if (nextBlocks[kind].phase === 'ready') nextCollapsed[kind] = false
    }
    setBlocks(nextBlocks)
    setCollapsed(nextCollapsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只跟 detailId：列表刷新不打断生成中区块
  }, [detailId])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(false)
    setFormOpen(true)
  }

  const openEdit = (q: RuankaoQuestion) => {
    setEditingId(q.id)
    setForm({
      year: q.year,
      title: q.title,
      domain: q.domain,
      q1: q.q1,
      q2: q.q2,
      q3: q.q3,
    })
    setFormError(false)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setFormError(false)
  }

  const handleSubmit = () => {
    if (!isValidForm(form)) {
      setFormError(true)
      return
    }
    if (editingId != null) {
      commit(
        questions.map((q) =>
          q.id === editingId ? { ...q, ...form, updatedAt: nowIso() } : q,
        ),
      )
    } else {
      const now = nowIso()
      commit([
        ...questions,
        {
          id: newQuestionId(),
          ...form,
          practiced: false,
          // 自录条目未经验证 → 诚实默认模拟（origin 权威链，设计稿 2.4）
          origin: 'mock',
          sourceRefs: [],
          source: 'user',
          createdAt: now,
          updatedAt: now,
        },
      ])
    }
    closeForm()
  }

  const togglePracticed = (id: string) => {
    // 种子条目同样可标练过：saveQuestions 把 seed 的 practiced 状态写进
    // 覆写表（种子本体不可变），user 条目直接进存储
    commit(
      questions.map((q) =>
        q.id === id
          ? { ...q, practiced: !q.practiced, updatedAt: nowIso() }
          : q,
      ),
    )
  }

  const confirmDelete = () => {
    if (deleteTarget == null) return
    commit(questions.filter((q) => q.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  // 教练载荷题面节（标题+年份+三问非空项）。分节标签复用表单键；引导行
  // 固定中文（见 COACH_GUIDE_* 注释）。种子条目 v2 起三问允许空，空问整节
  // 省略——教练按题目标题仍可工作。
  const coachQuestionSections = (q: RuankaoQuestion): string[] => {
    const sections: string[] = [
      `${t('ruankao.questionBank.titleLabel')}: ${q.title}`,
    ]
    if (q.year.trim()) {
      sections.push(`${t('ruankao.questionBank.yearLabel')}: ${q.year}`)
    }
    if (q.q1.trim()) {
      sections.push('', `${t('ruankao.questionBank.q1Label')}:`, q.q1)
    }
    if (q.q2.trim()) {
      sections.push('', `${t('ruankao.questionBank.q2Label')}:`, q.q2)
    }
    if (q.q3.trim()) {
      sections.push('', `${t('ruankao.questionBank.q3Label')}:`, q.q3)
    }
    return sections
  }

  const buildCoachText = (q: RuankaoQuestion, guideLine: string): string => {
    const sections = [...coachQuestionSections(q), '', guideLine]
    return sections.join('\n')
  }

  const handleCopyForCoach = async (q: RuankaoQuestion) => {
    const text = buildCoachText(q, COACH_GUIDE_DECODE)
    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.clipboard ||
        typeof navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('clipboard unavailable')
      }
      await navigator.clipboard.writeText(text)
      toast.success(t('ruankao.questionBank.copyForCoachDone'))
    } catch {
      // 剪贴板不可用（权限/非安全上下文）：兜底弹窗展示文本 + 手动复制
      setFallbackCopy({
        text,
        doneKey: 'ruankao.questionBank.copyForCoachDone',
      })
    }
  }

  const handleFallbackCopy = () => {
    const el = fallbackTextRef.current
    if (el == null || fallbackCopy == null) return
    el.focus()
    el.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    if (ok) {
      toast.success(t(fallbackCopy.doneKey))
      setFallbackCopy(null)
    }
  }

  // 工作台产物全文（复制/发教练共用；分节标题走 i18n，枚举值是端点数据）
  const formatGenerationText = (content: QuestionGenerateResult): string => {
    const lines: string[] = []
    if (content.kind === 'breakdown') {
      content.angles.forEach((angle, index) => {
        lines.push(`${index + 1}. ${angle.name}`)
        lines.push(`   ${angle.thesis_hint}`)
        lines.push(
          `   ${t('ruankao.questionBank.workbench.breakdown.materialMatchHeader')}: ${angle.material_match}`,
        )
        lines.push(
          `   ${t('ruankao.questionBank.workbench.breakdown.difficultyHeader')}: ${t(DIFFICULTY_KEYS[angle.difficulty])} · ${t('ruankao.questionBank.workbench.breakdown.riskHeader')}: ${t(RISK_KEYS[angle.similarity_risk])}`,
        )
      })
      lines.push(
        `${t('ruankao.questionBank.workbench.breakdown.comboAdviceTitle')}: ${content.combo_advice}`,
      )
      return lines.join('\n')
    }
    if (content.kind === 'q2_points') {
      lines.push(
        `${t('ruankao.questionBank.workbench.q2.frameworkTitle')}: ${content.framework}`,
      )
      content.points.forEach((point, index) => {
        lines.push(`${index + 1}. ${point.heading}`)
        lines.push(`   ${point.detail}`)
      })
      lines.push(
        `${t('ruankao.questionBank.workbench.q2.outlineHintTitle')}: ${content.outline_hint}`,
      )
      return lines.join('\n')
    }
    content.paragraphs.forEach((paragraph) => {
      lines.push(
        `[${
          paragraph.role === 'q2'
            ? t('ruankao.questionBank.workbench.outline.roleQ2')
            : t('ruankao.questionBank.workbench.outline.roleQ3')
        }]`,
      )
      lines.push(paragraph.outline)
      lines.push(
        `${t('ruankao.questionBank.workbench.outline.dataAnchorsTitle')}: ${paragraph.data_anchors.join('、')}`,
      )
    })
    return lines.join('\n')
  }

  // 生成（含重新生成/重试）：面板级单飞 + 关弹窗即真中断（abort → 服务端
  // 取消在途模型调用，设计稿 1.5.3 升级为流式版）。请求体只含考试元数据 +
  // 备注（ADR-017：无 source_id，范文构造上不可达）。
  const runGeneration = (
    q: RuankaoQuestion,
    kind: GenerationKind,
    note?: string,
  ) => {
    const token = runTokenRef.current
    const trimmedNote = note?.trim() || undefined
    setFlightKind(kind)
    setBlocks((prev) => ({ ...prev, [kind]: { phase: 'generating' } }))
    // 生成中必须可见 interruptHint：强制展开 + 收起备注框
    setCollapsed((prev) => ({ ...prev, [kind]: false }))
    setNoteOpen((prev) => ({ ...prev, [kind]: false }))
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    streamStatsRef.current = {
      deltaTimes: [],
      chars: 0,
      tail: '',
      startedAt:
        typeof performance !== 'undefined' ? performance.now() : Date.now(),
      peakTps: 0,
    }
    ruankaoQuestionsApi
      .generateStream(
        {
          kind,
          title: q.title,
          year: q.year.trim() || undefined,
          domain: q.domain.trim() || undefined,
          prompts: {
            q1: q.q1.trim() || undefined,
            q2: q.q2.trim() || undefined,
            q3: q.q3.trim() || undefined,
          },
          note: trimmedNote,
        },
        (delta) => {
          const stats = streamStatsRef.current
          stats.deltaTimes.push(
            typeof performance !== 'undefined'
              ? performance.now()
              : Date.now(),
          )
          stats.chars += delta.length
          stats.tail = (stats.tail + delta).slice(-60)
        },
        controller.signal,
        (stage) => {
          // 阶段推进只进 generating 块；generating/thinking 覆盖
          // waiting/preparing（乱序旧阶段不回退），complete/error 走各自的
          // 整块替换自然清空 stage
          setBlocks((prev) => {
            const block = prev[kind]
            if (block.phase !== 'generating') return prev
            if (
              (stage === 'waiting' || stage === 'preparing') &&
              (block.stage === 'generating' || block.stage === 'thinking')
            ) {
              return prev
            }
            if (block.stage === stage) return prev
            return { ...prev, [kind]: { ...block, stage } }
          })
        },
      )
      .then((content) => {
        if (runTokenRef.current !== token) return // 弹窗已关/已切题 → 结果丢弃
        const generatedAt = nowIso()
        saveGeneration(q, kind, content, trimmedNote)
        setBlocks((prev) => ({
          ...prev,
          [kind]: { phase: 'ready', content, generatedAt, note: trimmedNote },
        }))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          // 终止=丢弃，不保存半截结果。token 仍匹配 → 停止按钮触发的 abort
          // （弹窗还开着）：区块回 idle，可再次生成。关弹窗/切题的 abort 在
          // 水合 effect 里已重置区块且 token 失配，这里不动。
          if (runTokenRef.current === token) {
            setBlocks((prev) => ({ ...prev, [kind]: { phase: 'idle' } }))
          }
          return
        }
        if (runTokenRef.current !== token) return
        setBlocks((prev) => ({
          ...prev,
          [kind]: {
            phase: 'error',
            errorKey: questionGenerationErrorKey(error),
          },
        }))
      })
      .finally(() => {
        if (runTokenRef.current !== token) return // 关弹窗/切题：结果已丢弃
        setFlightKind(null)
        // 生成收尾即刷新列表（genTick 递增 → visible 重读生成缓存，排序/角标即时更新）
        setGenTick((t) => t + 1)
      })
  }

  // 流式指标节流：500ms 一帧（逐 delta setState 会把渲染打满），峰值在
  // ref 内只增不减，帧间由 computeStreamMetrics 统一口径
  useEffect(() => {
    if (flightKind == null) return
    const handle = setInterval(() => {
      const stats = streamStatsRef.current
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now()
      const sample = computeStreamMetrics(
        stats.deltaTimes,
        stats.chars,
        stats.tail,
        stats.startedAt,
        now,
        stats.peakTps,
      )
      stats.peakTps = sample.peakTps
      setBlocks((prev) =>
        prev[flightKind].phase === 'generating'
          ? {
              ...prev,
              // 展开既有块：保留 SSE stage（快照帧不得抹掉阶段行）
              [flightKind]: { ...prev[flightKind], stream: sample },
            }
          : prev,
      )
    }, 500)
    return () => clearInterval(handle)
  }, [flightKind])

  // 工作台复制：产物全文进剪贴板；失败走既有兜底弹窗（copyFallbackTitle 复用）
  const handleWorkbenchCopy = async (
    kind: GenerationKind,
    content: QuestionGenerateResult,
  ) => {
    const text = formatGenerationText(content)
    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.clipboard ||
        typeof navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('clipboard unavailable')
      }
      await navigator.clipboard.writeText(text)
      toast.success(t('ruankao.questionBank.workbench.copyDone'))
    } catch {
      setFallbackCopy({
        text,
        doneKey: 'ruankao.questionBank.workbench.copyDone',
      })
    }
  }

  // 工作台发教练：题面 + 该区块产物全文（若有；未生成退化为现状=题面+引导
  // 行）+ 对应引导行。「预填不代发」红线不变（coach-handoff 桥本体零改动）。
  const handleWorkbenchCoach = async (
    q: RuankaoQuestion,
    kind: GenerationKind,
    content: QuestionGenerateResult | undefined,
  ) => {
    const sections = [...coachQuestionSections(q)]
    if (content) {
      sections.push('', formatGenerationText(content))
    }
    sections.push('', KIND_GUIDE_LINES[kind])
    const result = await writeCoachHandoff({ text: sections.join('\n') })
    if (result.ok) {
      toast.success(t('ruankao.questionBank.handoffReady'))
    } else {
      toast.error(t('ruankao.questionBank.handoffNoNotebook'))
    }
  }

  // 重新生成：展开备注框；覆盖 confirm 在 apply 时弹出（文案含「覆盖」语义）
  const toggleNote = (kind: GenerationKind) => {
    setNoteOpen((prev) => ({ ...prev, [kind]: !prev[kind] }))
  }

  const applyNote = (q: RuankaoQuestion, kind: GenerationKind) => {
    if (!window.confirm(t('ruankao.questionBank.workbench.overwriteConfirm'))) {
      return
    }
    runGeneration(q, kind, noteDrafts[kind])
  }

  // D①：有对应文章（范文/真题 md/论文 PDF）→ 跳 essay read 视图人眼阅读
  //（同页深链；EssayPanel 挂载时读 ?read=，红线徽标照常显示）
  const handleFullEssayRead = (q: RuankaoQuestion) => {
    const sourceId = readSourceIdFor(q)
    if (!sourceId) return
    setDetailId(null)
    router.push(`/ruankao?tab=essay&read=${encodeURIComponent(sourceId)}`)
  }

  // D②：无对应文章 → 写一次性向导种子并切 environments tab，向导打开且
  // 题目关键词预填（种子即焚，消费端在 EnvironmentsPanel 挂载时取走）
  const handleFullEssayGenerate = (q: RuankaoQuestion) => {
    writeWizardSeed(wizardSeedFromQuestion(q))
    setDetailId(null)
    router.push('/ruankao?tab=environments')
    toast.success(t('ruankao.questionBank.wizardSeedReady'))
  }

  if (!ready) {
    return (
      <div
        className="flex items-center justify-center py-16"
        data-testid="ruankao-qbank-root"
      >
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="ruankao-qbank-root">
      {/* 头部：标题 + 描述 + 新建 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t('ruankao.questionBank.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('ruankao.questionBank.desc')}
          </p>
        </div>
        <Button
          data-testid="ruankao-qbank-create-button"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          {t('ruankao.questionBank.createButton')}
        </Button>
      </div>

      {/* 空态：种子为空且没有自录条目时才出现（有种子时列表永远在场） */}
      {questions.length === 0 && (
        <div data-testid="ruankao-qbank-empty">
          <EmptyState
            icon={ClipboardList}
            title={t('ruankao.questionBank.emptyTitle')}
            description={t('ruankao.questionBank.emptyDesc')}
            action={
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('ruankao.questionBank.createButton')}
              </Button>
            }
          />
        </div>
      )}

      {/* 过滤行：技术域 Select + 练过状态 + 来源（真题/模拟）+ 标题搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={domainFilter} onValueChange={setDomainFilter}>
          <SelectTrigger
            size="sm"
            className="w-44"
            data-testid="ruankao-qbank-filter-domain"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('ruankao.questionBank.filterAllDomains')}
            </SelectItem>
            {domains.map((domain) => (
              <SelectItem key={domain} value={domain}>
                {domain}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={practicedFilter}
          onValueChange={(value) => setPracticedFilter(value as PracticedFilter)}
        >
          <SelectTrigger
            size="sm"
            className="w-32"
            data-testid="ruankao-qbank-filter-practiced"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('ruankao.questionBank.filterAll')}
            </SelectItem>
            <SelectItem value="unpracticed">
              {t('ruankao.questionBank.filterUnpracticed')}
            </SelectItem>
            <SelectItem value="practiced">
              {t('ruankao.questionBank.filterPracticed')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={originFilter}
          onValueChange={(value) => setOriginFilter(value as OriginFilter)}
        >
          <SelectTrigger
            size="sm"
            className="w-36"
            data-testid="ruankao-qbank-filter-origin"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('ruankao.questionBank.filterAllOrigins')}
            </SelectItem>
            <SelectItem value="real">
              {t('ruankao.questionBank.filterReal')}
            </SelectItem>
            <SelectItem value="mock">
              {t('ruankao.questionBank.filterMock')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('ruankao.questionBank.searchPlaceholder')}
          className="max-w-xs"
          data-testid="ruankao-qbank-filter-search"
        />
      </div>

      {/* 题目列表：有生成产物的题排前（按最近生成时间降序），其余 user 在前、
          种子按年份倒序（同年 real 在前，无年份排尾） */}
      {visible.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t('common.noMatches')}
        </p>
      ) : (
        <div
          className="divide-y divide-border rounded-md border"
          data-testid="ruankao-qbank-list"
        >
          {visible.map(({ q, summary }) => (
            <div
              key={q.id}
              data-testid={`ruankao-qbank-item-${q.id}`}
              className="group flex items-center gap-2 py-2 pl-3 pr-3"
            >
              {/* 内容簇：origin 徽标 → 年份徽标 → 标题（截断封顶兜住宽视口下
                  「标题→技术域列」的距离，宽屏治理 L 线 §2.2），靠左聚簇 */}
              {/* 真题/模拟互斥 badge：每行恰好一个（title=判定口径提示） */}
              {q.origin === 'real' ? (
                <Badge
                  variant="default"
                  className="shrink-0"
                  data-testid="ruankao-qbank-origin-real"
                  title={t('ruankao.questionBank.originRealDesc')}
                >
                  {t('ruankao.questionBank.originReal')}
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="shrink-0"
                  data-testid="ruankao-qbank-origin-mock"
                  title={t('ruankao.questionBank.originMockDesc')}
                >
                  {t('ruankao.questionBank.originMock')}
                </Badge>
              )}
              {q.year.trim() && (
                <Badge variant="outline" className="shrink-0">
                  {q.year}
                </Badge>
              )}
              <span className="min-w-0 max-w-md truncate text-sm font-medium lg:max-w-lg">
                {q.title}
              </span>
              {/* 技术域列：固定宽度保证所有行该列对齐；域名截断 + title 悬停
                  看全名；旁挂生成进度角标（等宽数字，done=3 高亮） */}
              <div
                className="flex w-40 shrink-0 items-center gap-1.5"
                data-testid={`ruankao-qbank-domain-cell-${q.id}`}
              >
                {q.domain.trim() && (
                  <span
                    className="min-w-0 truncate text-xs text-muted-foreground"
                    title={q.domain}
                  >
                    {q.domain}
                  </span>
                )}
                <span
                  className={`ml-auto shrink-0 text-xs tabular-nums ${
                    summary.done === GENERATIONS_KINDS.length
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  }`}
                  aria-label={t('ruankao.questionBank.list.generatedAria', {
                    done: summary.done,
                    total: GENERATIONS_KINDS.length,
                  })}
                  data-testid={`ruankao-qbank-generated-badge-${q.id}`}
                >
                  {t('ruankao.questionBank.list.generatedBadge', {
                    done: summary.done,
                    total: GENERATIONS_KINDS.length,
                  })}
                </span>
              </div>

              {/* 练习状态列：shrink-0 不受技术域固定宽度挤压 */}
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={q.practiced}
                  data-testid={`ruankao-qbank-practiced-toggle-${q.id}`}
                  onCheckedChange={() => togglePracticed(q.id)}
                />
                {q.practiced
                  ? t('ruankao.questionBank.filterPracticed')
                  : t('ruankao.questionBank.filterUnpracticed')}
              </label>

              {/* 操作区靠右（ml-auto 推到行尾，与技术域/练习状态列脱开）。
                  高频动作常驻不藏：详情/复制教练每行都可能点，hover 收起与
                  「复制给教练」的高频定位矛盾 */}
              <div
                className="ml-auto flex shrink-0 items-center gap-2"
                data-testid={`ruankao-qbank-actions-${q.id}`}
              >
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t('ruankao.questionBank.detailAction')}
                  data-testid={`ruankao-qbank-detail-${q.id}`}
                  onClick={() => setDetailId(q.id)}
                >
                  {t('ruankao.questionBank.detailAction')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`ruankao-qbank-copy-coach-${q.id}`}
                  onClick={() => handleCopyForCoach(q)}
                >
                  <Copy className="h-4 w-4" />
                  {t('ruankao.questionBank.copyForCoach')}
                </Button>

                {/* 低频破坏性操作降噪：hover/键盘聚焦（focus-within）/触屏
                    （pointer-coarse，无 hover 设备常驻）三通道显隐 */}
                {q.source === 'user' && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('common.edit')}
                      data-testid={`ruankao-qbank-edit-${q.id}`}
                      onClick={() => openEdit(q)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={t('ruankao.questionBank.deleteAction')}
                      data-testid={`ruankao-qbank-delete-${q.id}`}
                      onClick={() => setDeleteTarget(q)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 题目详情 = 生成工作台：题面区 + 三产物区块（每 kind 独立状态机）
          + D①/D② 完整文章通道。生成通道只携带考试元数据与备注（ADR-017）。
          覆写宽度必须带 sm: 前缀（基类 sm:max-w-[calc(100%-2rem)] 会压住裸
          max-w-4xl——「sm: 前缀坑」，C9 断言防回归）。 */}
      <Dialog
        open={detailQuestion != null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"
          data-testid="ruankao-qbank-detail-dialog"
        >
          {detailQuestion && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {t('ruankao.questionBank.detailTitle')}
                  {/* 生成中徽标：关弹窗=中断的可见提醒（设计稿 1.5.3） */}
                  {flightKind !== null && (
                    <Badge
                      variant="outline"
                      data-testid="ruankao-qbank-detail-generating-badge"
                    >
                      {t('ruankao.questionBank.workbench.statusGenerating')}
                    </Badge>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {detailQuestion.origin === 'real' ? (
                    <Badge
                      variant="default"
                      data-testid="ruankao-qbank-detail-origin-real"
                      title={t('ruankao.questionBank.originRealDesc')}
                    >
                      {t('ruankao.questionBank.originReal')}
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      data-testid="ruankao-qbank-detail-origin-mock"
                      title={t('ruankao.questionBank.originMockDesc')}
                    >
                      {t('ruankao.questionBank.originMock')}
                    </Badge>
                  )}
                  {detailQuestion.year.trim() && (
                    <Badge variant="outline">{detailQuestion.year}</Badge>
                  )}
                  {detailQuestion.domain.trim() && (
                    <Badge variant="outline">{detailQuestion.domain}</Badge>
                  )}
                </div>
                <p
                  className="text-sm font-medium"
                  data-testid="ruankao-qbank-detail-title"
                >
                  {detailQuestion.title}
                </p>
                {detailQuestion.originNote && (
                  <p className="text-xs text-muted-foreground">
                    {detailQuestion.originNote}
                  </p>
                )}
                {/* 三问原文（种子 v2 起允许空：空问显示引导提示而非空块）；
                    键用完整字面量（Unused Key Detection 门禁） */}
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('ruankao.questionBank.q1Label')}
                  </p>
                  {detailQuestion.q1.trim() ? (
                    <p className="whitespace-pre-wrap text-sm">
                      {detailQuestion.q1}
                    </p>
                  ) : (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="ruankao-qbank-detail-empty-q1"
                    >
                      {t('ruankao.questionBank.detailNoPromptText')}
                    </p>
                  )}
                </div>
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('ruankao.questionBank.q2Label')}
                  </p>
                  {detailQuestion.q2.trim() ? (
                    <p className="whitespace-pre-wrap text-sm">
                      {detailQuestion.q2}
                    </p>
                  ) : (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="ruankao-qbank-detail-empty-q2"
                    >
                      {t('ruankao.questionBank.detailNoPromptText')}
                    </p>
                  )}
                </div>
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('ruankao.questionBank.q3Label')}
                  </p>
                  {detailQuestion.q3.trim() ? (
                    <p className="whitespace-pre-wrap text-sm">
                      {detailQuestion.q3}
                    </p>
                  ) : (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="ruankao-qbank-detail-empty-q3"
                    >
                      {t('ruankao.questionBank.detailNoPromptText')}
                    </p>
                  )}
                </div>
                {detailQuestion.sourceRefs.length > 0 && (
                  <div className="grid gap-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('ruankao.questionBank.detailSourceLabel')}
                    </p>
                    <ul className="space-y-0.5">
                      {detailQuestion.sourceRefs.map((ref, index) => (
                        <li
                          key={`${ref.kind}-${ref.sourceId ?? index}-${index}`}
                          className="text-sm text-muted-foreground"
                        >
                          {ref.folder} · {ref.kind}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {/* 三产物区块：每 kind 独立状态机，互不阻塞；单飞禁用其它触发 */}
              <div className="grid gap-3" data-testid="ruankao-qbank-workbench">
                {GENERATIONS_KINDS.map((kind) => {
                  const state = blocks[kind]
                  const isCollapsed = collapsed[kind]
                  const Icon = KIND_BLOCK_ICONS[kind]
                  const generating = state.phase === 'generating'
                  // 单飞：任一在途请求禁用所有生成触发按钮（含本块）
                  const triggerDisabled = flightKind !== null
                  const statusText =
                    state.phase === 'idle'
                      ? t('ruankao.questionBank.workbench.statusIdle')
                      : state.phase === 'generating'
                        ? t('ruankao.questionBank.workbench.statusGenerating')
                        : state.phase === 'ready'
                          ? t('ruankao.questionBank.workbench.statusReady')
                          : t('ruankao.questionBank.workbench.statusError')
                  return (
                    <div
                      key={kind}
                      className="rounded-md border"
                      data-testid={`ruankao-qbank-workbench-block-${kind}`}
                    >
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        {/* 标题簇：折叠开关 + 「?」悬浮解释。提示按钮独立于
                            开关 button（button 嵌套非法，且点击会误触发折叠），
                            紧跟标题行内联说明区块含义与三者关系 */}
                        <div className="flex min-w-0 items-center gap-1">
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-2 text-left"
                            disabled={generating}
                            data-testid={`ruankao-qbank-workbench-toggle-${kind}`}
                            onClick={() =>
                              setCollapsed((prev) => ({
                                ...prev,
                                [kind]: !prev[kind],
                              }))
                            }
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-4 w-4 shrink-0" />
                            ) : (
                              <ChevronDown className="h-4 w-4 shrink-0" />
                            )}
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate text-sm font-medium">
                              {t(KIND_TITLE_KEYS[kind])}
                            </span>
                            <span
                              className="shrink-0 text-xs text-muted-foreground"
                              data-testid={`ruankao-qbank-workbench-status-${kind}`}
                            >
                              {statusText}
                            </span>
                          </button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label={t(
                                  'ruankao.questionBank.workbench.tipToggle',
                                )}
                                data-testid={KIND_TIP_TESTIDS[kind]}
                                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                              >
                                <HelpCircle className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p>{t(KIND_TIP_KEYS[kind])}</p>
                              <p>
                                {t(
                                  'ruankao.questionBank.workbench.tipRelation',
                                )}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {(state.phase === 'idle' ||
                            state.phase === 'generating') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={triggerDisabled}
                              data-testid={`ruankao-qbank-workbench-generate-${kind}`}
                              onClick={() =>
                                runGeneration(detailQuestion, kind)
                              }
                            >
                              {t('ruankao.questionBank.workbench.generate')}
                            </Button>
                          )}
                          {state.phase === 'ready' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={triggerDisabled}
                                data-testid={`ruankao-qbank-workbench-regenerate-${kind}`}
                                onClick={() => toggleNote(kind)}
                              >
                                {t(
                                  'ruankao.questionBank.workbench.regenerate',
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`ruankao-qbank-workbench-copy-${kind}`}
                                onClick={() =>
                                  handleWorkbenchCopy(kind, state.content!)
                                }
                              >
                                <Copy className="h-4 w-4" />
                                {t('ruankao.questionBank.workbench.copy')}
                              </Button>
                            </>
                          )}
                          {(state.phase === 'ready' ||
                            state.phase === 'error') && (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`ruankao-qbank-workbench-coach-${kind}`}
                              onClick={() =>
                                handleWorkbenchCoach(
                                  detailQuestion,
                                  kind,
                                  state.content,
                                )
                              }
                            >
                              {t(
                                'ruankao.questionBank.workbench.sendToCoach',
                              )}
                            </Button>
                          )}
                          {state.phase === 'error' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={triggerDisabled}
                              data-testid={`ruankao-qbank-workbench-retry-${kind}`}
                              onClick={() =>
                                runGeneration(detailQuestion, kind)
                              }
                            >
                              {t('ruankao.questionBank.workbench.retry')}
                            </Button>
                          )}
                        </div>
                      </div>
                      {/* 展开体：ready 内容 / generating 提示 / error 文案 + 备注框 */}
                      {(!isCollapsed || generating) && (
                        <div className="grid gap-3 border-t px-3 py-3">
                          {generating && (
                            <>
                              <GenerationStatusPanel
                                title={t(KIND_TITLE_KEYS[kind])}
                                metrics={
                                  state.stream ?? {
                                    tokens: 0,
                                    chars: 0,
                                    tail: '',
                                    speedTps: 0,
                                    peakTps: 0,
                                    elapsedMs: 0,
                                  }
                                }
                                testId={`ruankao-qbank-workbench-stream-${kind}`}
                                stage={state.stage}
                                onStop={() => abortRef.current?.abort()}
                              />
                              <p className="text-sm text-muted-foreground">
                                {t(
                                  'ruankao.questionBank.workbench.interruptHint',
                                )}
                              </p>
                            </>
                          )}
                          {state.phase === 'ready' && state.content && (
                            <>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span
                                  data-testid={`ruankao-qbank-workbench-generated-at-${kind}`}
                                >
                                  {t(
                                    'ruankao.questionBank.workbench.generatedAt',
                                    {
                                      time: state.generatedAt
                                        ? new Date(
                                            state.generatedAt,
                                          ).toLocaleString()
                                        : '',
                                    },
                                  )}
                                </span>
                                {state.note && (
                                  <Badge variant="outline">
                                    {t(
                                      'ruankao.questionBank.workbench.noteBadge',
                                    )}
                                  </Badge>
                                )}
                              </div>
                              <div
                                data-testid={`ruankao-qbank-workbench-content-${kind}`}
                              >
                                {state.content.kind === 'breakdown' && (
                                  <BreakdownContentView
                                    content={state.content}
                                  />
                                )}
                                {state.content.kind === 'q2_points' && (
                                  <Q2PointsContentView
                                    content={state.content}
                                  />
                                )}
                                {state.content.kind === 'outline' && (
                                  <OutlineContentView content={state.content} />
                                )}
                              </div>
                            </>
                          )}
                          {state.phase === 'error' && (
                            <p
                              className="text-sm text-destructive"
                              data-testid={`ruankao-qbank-workbench-error-${kind}`}
                            >
                              {state.errorKey
                                ? t(state.errorKey)
                                : t(
                                    'ruankao.questionBank.workbench.errorModel',
                                  )}
                            </p>
                          )}
                          {state.phase === 'ready' && noteOpen[kind] && (
                            <div className="grid gap-2 border-t pt-3">
                              <Label
                                htmlFor={`ruankao-qbank-workbench-note-${kind}`}
                              >
                                {t('ruankao.questionBank.workbench.noteLabel')}
                              </Label>
                              <Input
                                id={`ruankao-qbank-workbench-note-${kind}`}
                                value={noteDrafts[kind]}
                                placeholder={t(
                                  'ruankao.questionBank.workbench.notePlaceholder',
                                )}
                                onChange={(event) =>
                                  setNoteDrafts((prev) => ({
                                    ...prev,
                                    [kind]: event.target.value,
                                  }))
                                }
                                data-testid={`ruankao-qbank-workbench-note-input-${kind}`}
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => toggleNote(kind)}
                                >
                                  {t('common.cancel')}
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={triggerDisabled}
                                  data-testid={`ruankao-qbank-workbench-note-apply-${kind}`}
                                  onClick={() =>
                                    applyNote(detailQuestion, kind)
                                  }
                                >
                                  {t(
                                    'ruankao.questionBank.workbench.noteApply',
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
                {/* D①/D② 完整文章通道：原样保留（红线 5） */}
                {readSourceIdFor(detailQuestion) ? (
                  <Button
                    size="sm"
                    data-testid="ruankao-qbank-detail-action-full-read"
                    onClick={() => handleFullEssayRead(detailQuestion)}
                  >
                    <BookOpen className="h-4 w-4" />
                    {t('ruankao.questionBank.actionFullEssayRead')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    data-testid="ruankao-qbank-detail-action-full-generate"
                    onClick={() => handleFullEssayGenerate(detailQuestion)}
                  >
                    <Wand2 className="h-4 w-4" />
                    {t('ruankao.questionBank.actionFullEssayGenerate')}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 新建/编辑 Dialog：年份（格式示例 placeholder）、标题、技术域自由输入、三问原文 */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm()
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId != null
                ? t('ruankao.questionBank.formTitleEdit')
                : t('ruankao.questionBank.formTitleNew')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="qbank-year">
                  {t('ruankao.questionBank.yearLabel')}
                </Label>
                <Input
                  id="qbank-year"
                  value={form.year}
                  placeholder={YEAR_PLACEHOLDER}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, year: event.target.value }))
                  }
                  data-testid="ruankao-qbank-form-year"
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="qbank-title">
                  {t('ruankao.questionBank.titleLabel')}
                </Label>
                <Input
                  id="qbank-title"
                  value={form.title}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  data-testid="ruankao-qbank-form-title"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qbank-domain">
                {t('ruankao.questionBank.domainLabel')}
              </Label>
              <Input
                id="qbank-domain"
                value={form.domain}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, domain: event.target.value }))
                }
                data-testid="ruankao-qbank-form-domain"
              />
            </div>
            {/* 三问原文分三个粘贴框；键用完整字面量（Unused Key Detection 门禁） */}
            <div className="grid gap-2">
              <Label htmlFor="qbank-q1">
                {t('ruankao.questionBank.q1Label')}
              </Label>
              <Textarea
                id="qbank-q1"
                value={form.q1}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, q1: event.target.value }))
                }
                data-testid="ruankao-qbank-form-q1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qbank-q2">
                {t('ruankao.questionBank.q2Label')}
              </Label>
              <Textarea
                id="qbank-q2"
                value={form.q2}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, q2: event.target.value }))
                }
                data-testid="ruankao-qbank-form-q2"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qbank-q3">
                {t('ruankao.questionBank.q3Label')}
              </Label>
              <Textarea
                id="qbank-q3"
                value={form.q3}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, q3: event.target.value }))
                }
                data-testid="ruankao-qbank-form-q3"
              />
            </div>
            {formError && (
              <p
                className="text-sm text-destructive"
                data-testid="ruankao-qbank-form-error"
              >
                {t('ruankao.questionBank.validationRequired')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              data-testid="ruankao-qbank-form-submit"
            >
              {t('ruankao.questionBank.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认（仅本地存储，不可恢复；种子不在可删范围） */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent data-testid="ruankao-qbank-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('ruankao.questionBank.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `${deleteTarget.title} — ` : ''}
              {t('ruankao.questionBank.deleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="ruankao-qbank-delete-confirm"
              onClick={confirmDelete}
            >
              {t('ruankao.questionBank.deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 剪贴板兜底：展示全文 + 手动复制按钮（最小兜底；列表复制与工作台
          复制共用弹窗，完成 toast 按 fallbackCopy.doneKey 分流） */}
      <Dialog
        open={fallbackCopy != null}
        onOpenChange={(open) => {
          if (!open) setFallbackCopy(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('ruankao.questionBank.copyFallbackTitle')}
            </DialogTitle>
          </DialogHeader>
          <textarea
            ref={fallbackTextRef}
            readOnly
            value={fallbackCopy?.text ?? ''}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-64 w-full resize-y rounded-md border bg-transparent p-3 font-mono text-xs"
            data-testid="ruankao-qbank-copy-fallback-text"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFallbackCopy(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleFallbackCopy}>
              <Copy className="h-4 w-4" />
              {t('ruankao.questionBank.copyForCoach')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

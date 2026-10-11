// 软考论文题库（v2，批次：真题入库）：种子常量 + localStorage 自建合并。
// 数据策略（ADR-018 零后端 + ADR-020 离线语料产物准入）：
//   - 种子 SEED_QUESTIONS 来自离线提取管线（question-bank-seeds.gen.ts，生成物），
//     只含考试元数据——标题/年份 marker/三问逐字原文/来源引用；范文正文绝不入库。
//     预设常量永不落盘（ADR-018 先例）：种子条目不可编辑，仅「练过」可覆写。
//   - localStorage ruankao.questions.v2 只存 user 条目 + 种子练过覆写表；
//     v1 自录条目一次性迁移（origin 默认 mock，诚实口径），v1 key 不删除（回滚无损）。
import {
  SEED_QUESTIONS,
  type QuestionOrigin,
  type RuankaoQuestionSourceRef,
} from './question-bank-seeds.gen'

export type { QuestionOrigin, RuankaoQuestionSourceRef }

export interface RuankaoQuestion {
  id: string
  /** 考试批次，自由文本（如 '2024 上'、'2025 下'）；允许 ''（年份未标注） */
  year: string
  /** 技术主题（如「论负载均衡技术的应用」） */
  title: string
  /** 技术域标签，单值自由输入 */
  domain: string
  /** 问题1 原文（项目概叙与本人工作）；v2 起允许 ''（标题-only 条目） */
  q1: string
  /** 问题2 原文（技术组成论述）；v2 起允许 '' */
  q2: string
  /** 问题3 原文（实施与效果）；v2 起允许 '' */
  q3: string
  practiced: boolean
  /** 真题/模拟判定（origin 权威链见设计稿 2.4）；未验证为真题一律 mock（保守） */
  origin: QuestionOrigin
  /** 判定依据（中文数据字段，不进 i18n）：'真题md·真题段'、'题库权威未收录→默认模拟' 等 */
  originNote?: string
  /** 来源引用（folder + kind + sourceId）；sourceId 为 null 表示纯文本出处 */
  sourceRefs: RuankaoQuestionSourceRef[]
  /** 'seed'（种子常量，不可编辑）| 'user'（自录，可编辑可删） */
  source: 'seed' | 'user'
  /** ISO 时间戳 */
  createdAt: string
  updatedAt: string
}

// v2 存储键（本批起）；v1 键保留只读（迁移源，不删除 → 回滚无损）
export const QUESTIONS_STORAGE_KEY = 'ruankao.questions.v2'
export const QUESTIONS_STORAGE_KEY_V1 = 'ruankao.questions.v1'

// v1 形状（迁移源；source: 'preset' 的演示条目从未落盘，无需处理）
interface QuestionsStorageV1 {
  version: 1
  questions: RuankaoQuestion[]
}

interface QuestionsStorageV2 {
  version: 2
  /** 仅 user 条目；种子是常量，永不落盘 */
  questions: RuankaoQuestion[]
  /** 种子条目 id → 练过覆写（种子本体不可变，覆写挂 id，重跑种子不漂移） */
  practicedOverrides: Record<string, boolean>
}

// v1 自录迁移的判定依据（中文数据字段，不进 i18n）：v1 表单无 origin 概念，
// 自录条目未经验证 → 诚实默认模拟
export const V1_MIGRATION_ORIGIN_NOTE = 'v1 自录迁移'

// 宽容读取（延续 v1 先例）：结构不符/单条损坏不拖垮面板，坏条目被剔除；
// sourceRefs 与 origin 这类 v2 新字段做净化归一，不因旧数据缺字段而拒收整条。
function sanitizeUserQuestion(q: unknown): RuankaoQuestion | null {
  if (q == null || typeof q !== 'object') return null
  const raw = q as Partial<RuankaoQuestion> & { source?: unknown }
  if (
    raw.source !== 'user' ||
    typeof raw.id !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.year !== 'string' ||
    typeof raw.domain !== 'string' ||
    typeof raw.q1 !== 'string' ||
    typeof raw.q2 !== 'string' ||
    typeof raw.q3 !== 'string' ||
    typeof raw.practiced !== 'boolean'
  ) {
    return null
  }
  const sourceRefs = Array.isArray(raw.sourceRefs)
    ? raw.sourceRefs.filter(
        (ref): ref is RuankaoQuestionSourceRef =>
          ref != null &&
          typeof ref === 'object' &&
          typeof (ref as RuankaoQuestionSourceRef).kind === 'string' &&
          typeof (ref as RuankaoQuestionSourceRef).folder === 'string' &&
          ((ref as RuankaoQuestionSourceRef).sourceId === null ||
            typeof (ref as RuankaoQuestionSourceRef).sourceId === 'string'),
      )
    : []
  return {
    id: raw.id,
    year: raw.year,
    title: raw.title,
    domain: raw.domain,
    q1: raw.q1,
    q2: raw.q2,
    q3: raw.q3,
    practiced: raw.practiced,
    origin: raw.origin === 'real' ? 'real' : 'mock',
    originNote: typeof raw.originNote === 'string' ? raw.originNote : undefined,
    sourceRefs,
    source: 'user',
    createdAt:
      typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    updatedAt:
      typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  }
}

// 练过覆写表净化：只收 boolean 值
function sanitizeOverrides(raw: unknown): Record<string, boolean> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') out[id] = value
  }
  return out
}

interface ReadResult {
  questions: RuankaoQuestion[]
  practicedOverrides: Record<string, boolean>
}

function readV2(raw: string): ReadResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<QuestionsStorageV2>
    if (parsed.version !== 2 || !Array.isArray(parsed.questions)) return null
    const questions = parsed.questions
      .map(sanitizeUserQuestion)
      .filter((q): q is RuankaoQuestion => q !== null)
    return { questions, practicedOverrides: sanitizeOverrides(parsed.practicedOverrides) }
  } catch {
    return null
  }
}

// v1 → v2 迁移：user 条目补 origin:'mock' + originNote + sourceRefs:[]；
// v1 的 preset 演示条目从未落盘（saveQuestions 恒过滤），若手工出现也按
// v1 读取口径剔除（先滤 raw source==='user'，再强转 user 进净化器）
function readV1(raw: string): ReadResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<QuestionsStorageV1>
    if (!Array.isArray(parsed.questions)) return null
    const questions = parsed.questions
      .filter(
        (q): q is RuankaoQuestion =>
          q != null && (q as { source?: unknown }).source === 'user',
      )
      .map((q) =>
        sanitizeUserQuestion({
          ...q,
          source: 'user',
          origin: 'mock',
          originNote: V1_MIGRATION_ORIGIN_NOTE,
          sourceRefs: [],
        }),
      )
      .filter((q): q is RuankaoQuestion => q !== null)
    return { questions, practicedOverrides: {} }
  } catch {
    return null
  }
}

function readStorage(): ReadResult | null {
  if (typeof window === 'undefined') return null
  try {
    const v2Raw = window.localStorage.getItem(QUESTIONS_STORAGE_KEY)
    if (v2Raw) {
      const v2 = readV2(v2Raw)
      if (v2) return v2
    }
    // 无 v2（或 v2 损坏）→ 读 v1 迁移；v1 key 永不删除，回滚无损
    const v1Raw = window.localStorage.getItem(QUESTIONS_STORAGE_KEY_V1)
    if (v1Raw) return readV1(v1Raw)
    return null
  } catch {
    return null
  }
}

/** 读种子（应用练过覆写的副本）并与 user 条目合并返回；解析失败回退仅种子。 */
export function loadQuestions(): RuankaoQuestion[] {
  const storage = readStorage()
  const overrides = storage?.practicedOverrides ?? {}
  const seeds = SEED_QUESTIONS.map((q) => ({
    ...q,
    practiced: q.id in overrides ? overrides[q.id] : q.practiced,
  }))
  return [...seeds, ...(storage?.questions ?? [])]
}

/** 只存 user 条目 + 种子练过覆写：传入数组中的 seed 条目本体被静默丢弃
 * （种子不可变），仅取其 practiced 状态进覆写表。 */
export function saveQuestions(qs: RuankaoQuestion[]): void {
  if (typeof window === 'undefined') return
  const questions = qs.filter((q) => q.source === 'user')
  const practicedOverrides: Record<string, boolean> = {}
  for (const q of qs) {
    if (q.source === 'seed') practicedOverrides[q.id] = q.practiced
  }
  const payload: QuestionsStorageV2 = { version: 2, questions, practicedOverrides }
  try {
    window.localStorage.setItem(QUESTIONS_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 隐私模式/配额写失败：静默降级（下次读回旧值，UI 不崩）
  }
}

export function newQuestionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  )
}

export function nowIso(): string {
  return new Date().toISOString()
}

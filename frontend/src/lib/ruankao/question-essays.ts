// 软考题目「整篇生成」缓存：localStorage v1 持久，零后端（ADR-018
// local-first）。每题只存最新一篇（重新生成 = 带 note 覆盖，与
// question-generations 的单结果心智一致）；读写做防御性 sanitize——
// 损坏条目即弃，单条坏目不拖垮整体。红线（ADR-017）：缓存的只有生成
// 结果本体（基于考试元数据 + 考生自己的项目环境），不携带范文正文。

// 容量上限=题（题目条目数），超出按 generatedAt 最旧淘汰（与
// question-generations 的 GENERATIONS_MAX_QUESTIONS 同款裁决：常量定死）。
export const ESSAYS_STORAGE_KEY = 'ruankao.questionEssays.v1'
export const ESSAYS_MAX_QUESTIONS = 100
// QuotaExceededError 兜底：先淘汰最旧 10 题重试一次，仍失败静默放弃
// （question-generations 先例：UI 会话内存仍可见，不抛未捕获异常）。
export const ESSAYS_QUOTA_RETRY_EVICT_COUNT = 10

export interface StoredQuestionEssay {
  envId: string
  envName: string
  content: string
  generatedAt: string // ISO
  note?: string // 本次生成所用备注（空缺 = 无备注生成）
  modelName?: string // 显式选择的模型名（缺省 = 系统默认生成，旧条目无此字段）
  templateName?: string // 提示词模板（=智能体）名（缺省 = 未使用）
}

interface QuestionEssaysStoreV1 {
  version: 1
  /** key = 题目 id（种子稳定 id / user UUID） */
  entries: Record<string, StoredQuestionEssay>
}

// 宽松净化（对齐 question-generations sanitize 姿态）：缺字段/类型不符 →
// null，即弃该条。
function sanitizeEssay(value: unknown): StoredQuestionEssay | null {
  if (value == null || typeof value !== 'object') return null
  const raw = value as Partial<StoredQuestionEssay>
  if (
    typeof raw.envId !== 'string' ||
    !raw.envId ||
    typeof raw.envName !== 'string' ||
    !raw.envName ||
    typeof raw.content !== 'string' ||
    !raw.content ||
    typeof raw.generatedAt !== 'string' ||
    !raw.generatedAt
  ) {
    return null
  }
  return {
    envId: raw.envId,
    envName: raw.envName,
    content: raw.content,
    generatedAt: raw.generatedAt,
    note: typeof raw.note === 'string' && raw.note ? raw.note : undefined,
    // 可选回显字段：非字符串/空串一律丢弃（旧条目无 → undefined）
    modelName:
      typeof raw.modelName === 'string' && raw.modelName
        ? raw.modelName
        : undefined,
    templateName:
      typeof raw.templateName === 'string' && raw.templateName
        ? raw.templateName
        : undefined,
  }
}

function sanitizeEntries(raw: unknown): QuestionEssaysStoreV1['entries'] {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: QuestionEssaysStoreV1['entries'] = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const sanitized = sanitizeEssay(value)
    if (sanitized !== null) entries[key] = sanitized
  }
  return entries
}

// 读取宽容：JSON 解析失败 / version 不符 → 回退空 store（不抛异常）
function readStore(): QuestionEssaysStoreV1 {
  const empty: QuestionEssaysStoreV1 = { version: 1, entries: {} }
  if (typeof window === 'undefined') return empty
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(ESSAYS_STORAGE_KEY)
  } catch {
    return empty
  }
  if (!raw) return empty
  try {
    const parsed = JSON.parse(raw) as Partial<QuestionEssaysStoreV1>
    if (parsed.version !== 1 || parsed.entries == null) return empty
    return { version: 1, entries: sanitizeEntries(parsed.entries) }
  } catch {
    return empty
  }
}

function evictOldest(
  entries: QuestionEssaysStoreV1['entries'],
  count: number,
): void {
  const oldestKeys = Object.entries(entries)
    .sort(([, a], [, b]) => {
      const aTime = Date.parse(a.generatedAt)
      const bTime = Date.parse(b.generatedAt)
      return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime)
    })
    .slice(0, count)
    .map(([key]) => key)
  for (const key of oldestKeys) delete entries[key]
}

function writeStore(entries: QuestionEssaysStoreV1['entries']): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      ESSAYS_STORAGE_KEY,
      JSON.stringify({ version: 1, entries } satisfies QuestionEssaysStoreV1),
    )
  } catch {
    // QuotaExceededError 兜底：淘汰最旧 10 题重试一次；仍失败静默放弃本次
    // 缓存（UI 会话内存仍可见结果，不抛未捕获异常）。
    const evictCount = Math.min(
      ESSAYS_QUOTA_RETRY_EVICT_COUNT,
      Object.keys(entries).length,
    )
    if (evictCount === 0) return
    evictOldest(entries, evictCount)
    try {
      window.localStorage.setItem(
        ESSAYS_STORAGE_KEY,
        JSON.stringify({ version: 1, entries } satisfies QuestionEssaysStoreV1),
      )
    } catch {
      // 静默放弃
    }
  }
}

/** 读缓存：该题最新一篇整篇生成（无 → null） */
export function readQuestionEssay(questionId: string): StoredQuestionEssay | null {
  return readStore().entries[questionId] ?? null
}

/** 写缓存（单结果覆盖语义：重新生成 = 覆盖同 key）：上限 100 题超出淘汰
 * 最旧题；返回是否落盘成功（false = 静默放弃）。 */
export function saveQuestionEssay(
  questionId: string,
  essay: StoredQuestionEssay,
): boolean {
  if (typeof window === 'undefined') return false
  const { entries } = readStore()
  const trimmedNote = essay.note?.trim() || undefined
  const modelName = essay.modelName?.trim() || undefined
  const templateName = essay.templateName?.trim() || undefined
  entries[questionId] = {
    envId: essay.envId,
    envName: essay.envName,
    content: essay.content,
    generatedAt: essay.generatedAt,
    ...(trimmedNote ? { note: trimmedNote } : {}),
    ...(modelName ? { modelName } : {}),
    ...(templateName ? { templateName } : {}),
  }
  // 上限按题计：超出按 generatedAt 最旧淘汰
  const keys = Object.keys(entries)
  if (keys.length > ESSAYS_MAX_QUESTIONS) {
    evictOldest(entries, keys.length - ESSAYS_MAX_QUESTIONS)
  }
  writeStore(entries)
  // 重读校验落盘结果（quota 兜底后仍可能失败 → 静默放弃信号）
  const persisted = readStore()
  return persisted.entries[questionId] != null
}

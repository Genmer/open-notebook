// 软考题目工作台生成缓存（G 线）：localStorage v1 持久，零后端（ADR-018
// local-first；升级触发器未命中不升级）。与端点响应同形的内容按「题目×kind」
// 二维组织，每格单结果（重新生成 = 带 note 覆盖，不保留版本列表——单结果
// 心智 + 上限/淘汰复杂度 + 旧论点是干扰项，设计稿裁决）。
// 红线（ADR-017）：缓存的只有生成结果本体，不携带范文正文。

import type {
  BreakdownAngle,
  OutlineParagraph,
  Q2Point,
  QuestionGenerateResult,
} from '@/lib/types/api'

export const GENERATIONS_STORAGE_KEY = 'ruankao.questionGenerations.v1'
export const GENERATIONS_KINDS = ['breakdown', 'q2_points', 'outline'] as const
export type GenerationKind = (typeof GENERATIONS_KINDS)[number]
// 容量上限=题（题目条目数），超出按「该题最近一次生成时间」最旧淘汰
// （设计稿裁决 0-5：无遥测不做数据驱动调参，常量定死）。
export const GENERATIONS_MAX_QUESTIONS = 100
// QuotaExceededError 兜底：先淘汰最旧 10 题重试一次，仍失败静默放弃
// （essay-drafts/question-bank 先例：UI 会话内存仍可见，不抛未捕获异常）。
export const QUOTA_RETRY_EVICT_COUNT = 10

export interface QuestionRef {
  /** 种子稳定 id / user UUID；防御未来出现无 id 条目（undefined → 标题兜底） */
  id?: string
  title: string
}

export interface StoredGeneration {
  content: QuestionGenerateResult
  generatedAt: string // ISO
  note?: string // 本次生成所用备注（空缺 = 无备注生成）
}

interface GenerationsStoreV1 {
  version: 1
  /** key = 题目 id 或规范化标题（两种共存，读取时 id 未命中再试 normTitle） */
  entries: Record<string, Partial<Record<GenerationKind, StoredGeneration>>>
}

/** 规范化标题兜底键（防御无 id 条目） */
export function normTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 写入键：id 优先，无 id 用规范化标题 */
function writeKey(q: QuestionRef): string {
  const id = (q.id ?? '').trim()
  return id || normTitleKey(q.title)
}

function isGenerationKind(value: unknown): value is GenerationKind {
  return (
    value === 'breakdown' || value === 'q2_points' || value === 'outline'
  )
}

function isBreakdownAngle(value: unknown): value is BreakdownAngle {
  if (value == null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.name === 'string' &&
    typeof raw.thesis_hint === 'string' &&
    typeof raw.material_match === 'string' &&
    (raw.difficulty === 'easy' ||
      raw.difficulty === 'medium' ||
      raw.difficulty === 'hard') &&
    (raw.similarity_risk === 'low' ||
      raw.similarity_risk === 'medium' ||
      raw.similarity_risk === 'high')
  )
}

function isQ2Point(value: unknown): value is Q2Point {
  if (value == null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return typeof raw.heading === 'string' && typeof raw.detail === 'string'
}

function isOutlineParagraph(value: unknown): value is OutlineParagraph {
  if (value == null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    (raw.role === 'q2' || raw.role === 'q3') &&
    typeof raw.outline === 'string' &&
    Array.isArray(raw.data_anchors) &&
    raw.data_anchors.every(anchor => typeof anchor === 'string')
  )
}

// 宽容净化（对齐 question-bank sanitize 姿态）：kind 非法/内容缺字段 → null，
// 单条坏目剔除不拖垮整体。
function sanitizeStored(value: unknown, mapKey: string): StoredGeneration | null {
  if (!isGenerationKind(mapKey)) return null
  if (value == null || typeof value !== 'object') return null
  const raw = value as Partial<StoredGeneration> & { content?: unknown }
  if (typeof raw.generatedAt !== 'string' || !raw.generatedAt) return null
  // 内容判别字段必须与所在 map 键一致（错位条目按坏目剔除）
  const content = sanitizeContent(mapKey, raw.content)
  if (content === null) return null
  return {
    content,
    generatedAt: raw.generatedAt,
    note: typeof raw.note === 'string' && raw.note ? raw.note : undefined,
  }
}

function sanitizeContent(
  kind: GenerationKind,
  raw: unknown
): QuestionGenerateResult | null {
  if (raw == null || typeof raw !== 'object') return null
  const content = raw as Record<string, unknown>
  if (content.kind !== kind) return null
  if (kind === 'breakdown') {
    if (typeof content.combo_advice !== 'string' || !Array.isArray(content.angles))
      return null
    const angles = content.angles.filter(isBreakdownAngle)
    if (angles.length === 0) return null
    return { kind, angles, combo_advice: content.combo_advice }
  }
  if (kind === 'q2_points') {
    if (
      typeof content.framework !== 'string' ||
      typeof content.outline_hint !== 'string' ||
      !Array.isArray(content.points)
    )
      return null
    const points = content.points.filter(isQ2Point)
    if (points.length === 0) return null
    return { kind, framework: content.framework, points, outline_hint: content.outline_hint }
  }
  if (!Array.isArray(content.paragraphs)) return null
  const paragraphs = content.paragraphs.filter(isOutlineParagraph)
  if (paragraphs.length === 0) return null
  return { kind, paragraphs }
}

function sanitizeEntries(raw: unknown): GenerationsStoreV1['entries'] {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: GenerationsStoreV1['entries'] = {}
  for (const [key, perKind] of Object.entries(raw as Record<string, unknown>)) {
    if (perKind == null || typeof perKind !== 'object' || Array.isArray(perKind))
      continue
    const cleaned: Partial<Record<GenerationKind, StoredGeneration>> = {}
    for (const [kind, stored] of Object.entries(perKind as Record<string, unknown>)) {
      if (!isGenerationKind(kind)) continue
      const sanitized = sanitizeStored(stored, kind)
      if (sanitized !== null) cleaned[kind] = sanitized
    }
    if (Object.keys(cleaned).length > 0) entries[key] = cleaned
  }
  return entries
}

// 读取宽容：JSON 解析失败 / version 不符 → 回退空 store（不抛异常）
function readStore(): GenerationsStoreV1 {
  const empty: GenerationsStoreV1 = { version: 1, entries: {} }
  if (typeof window === 'undefined') return empty
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(GENERATIONS_STORAGE_KEY)
  } catch {
    return empty
  }
  if (!raw) return empty
  try {
    const parsed = JSON.parse(raw) as Partial<GenerationsStoreV1>
    if (parsed.version !== 1 || parsed.entries == null) return empty
    return { version: 1, entries: sanitizeEntries(parsed.entries) }
  } catch {
    return empty
  }
}

function latestGenerationAt(perKind: Partial<Record<GenerationKind, StoredGeneration>>): number {
  let latest = 0
  for (const stored of Object.values(perKind)) {
    const time = Date.parse(stored.generatedAt)
    if (!Number.isNaN(time) && time > latest) latest = time
  }
  return latest
}

/** 该题最近一次生成时间（淘汰排序用；无生成 → 0 = 最旧） */
function evictOldest(entries: GenerationsStoreV1['entries'], count: number): void {
  const oldestKeys = Object.entries(entries)
    .sort(([, a], [, b]) => latestGenerationAt(a) - latestGenerationAt(b))
    .slice(0, count)
    .map(([key]) => key)
  for (const key of oldestKeys) delete entries[key]
}

function writeStore(entries: GenerationsStoreV1['entries']): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      GENERATIONS_STORAGE_KEY,
      JSON.stringify({ version: 1, entries } satisfies GenerationsStoreV1)
    )
  } catch {
    // QuotaExceededError 兜底：淘汰最旧 10 题重试一次；仍失败静默放弃本次
    // 缓存（UI 会话内存仍可见结果，不抛未捕获异常）。
    const evictCount = Math.min(QUOTA_RETRY_EVICT_COUNT, Object.keys(entries).length)
    if (evictCount === 0) return
    evictOldest(entries, evictCount)
    try {
      window.localStorage.setItem(
        GENERATIONS_STORAGE_KEY,
        JSON.stringify({ version: 1, entries } satisfies GenerationsStoreV1)
      )
    } catch {
      // 静默放弃
    }
  }
}

/** 读缓存：题目 id 未命中再试规范化标题兜底键（两种 key 共存同一 map）。 */
export function readGeneration(
  q: QuestionRef,
  kind: GenerationKind
): StoredGeneration | null {
  const { entries } = readStore()
  const byId = q.id ? entries[q.id]?.[kind] : undefined
  if (byId) return byId
  return entries[normTitleKey(q.title)]?.[kind] ?? null
}

export interface GenerationSummary {
  /** 有产物的 kind 数（0-3） */
  done: number
  /** 各产物 generatedAt（ISO）的最大毫秒值；无产物（或时间不可解析）为 null */
  latest: number | null
}

/** 列表排序/角标汇总：按 id 依次查 3 个 kind 的生成缓存（id 未命中回落
 * 规范化标题键，readGeneration 同口径）。无产物返回 { done: 0, latest: null }。 */
export function getGenerationSummary(questionId: string): GenerationSummary {
  let done = 0
  let latest: number | null = null
  for (const kind of GENERATIONS_KINDS) {
    const stored = readGeneration({ id: questionId, title: '' }, kind)
    if (!stored) continue
    done += 1
    const time = new Date(stored.generatedAt).getTime()
    if (!Number.isNaN(time) && (latest === null || time > latest)) {
      latest = time
    }
  }
  return { done, latest }
}

/** 写缓存（单结果覆盖语义：重新生成 = 带 note 覆盖同 key）：
 * 上限 100 题超出淘汰最旧题；返回是否落盘成功（false = 静默放弃）。 */
export function saveGeneration(
  q: QuestionRef,
  kind: GenerationKind,
  content: QuestionGenerateResult,
  note?: string
): boolean {
  if (typeof window === 'undefined') return false
  const { entries } = readStore()
  const key = writeKey(q)
  const trimmedNote = note?.trim() || undefined
  const perKind = entries[key] ?? {}
  perKind[kind] = {
    content,
    generatedAt: new Date().toISOString(),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  }
  entries[key] = perKind
  // 上限按题计：超出按「该题最近一次生成时间」最旧淘汰
  const keys = Object.keys(entries)
  if (keys.length > GENERATIONS_MAX_QUESTIONS) {
    evictOldest(entries, keys.length - GENERATIONS_MAX_QUESTIONS)
  }
  writeStore(entries)
  // 重读校验落盘结果（quota 兜底后仍可能失败 → 静默放弃信号）
  const persisted = readStore()
  return persisted.entries[key]?.[kind] != null
}

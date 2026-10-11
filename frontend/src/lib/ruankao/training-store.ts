// 软考憋字训练记录 store（批次5）：localStorage 持久，零后端（ADR-018 起步姿态）。
// 「憋字的全部意义是没有退路」——训练器不落任何 AI 触点，记录只含计时/字数
// 事实数据（题目与提纲是考生自己的输入，正文从不写入记录——记录只存字数）。
// 上限 50 轮，超出丢最旧（essay-drafts 同款形态）。

export interface RuankaoTrainingSession {
  id: string
  topic: string
  /** 本轮使用的提纲原文（考生从教练对话复制来的自己的提纲，非范文） */
  outline: string
  /** ISO 时间戳 */
  startedAt: string
  endedAt: string
  /** 本轮实际用时（秒），交卷时定格 */
  durationSec: number
  argChars: number
  q2Chars: number
  targetMet: boolean
}

// localStorage key 注册表（设计稿 6.2，批次5）：ruankao.trainingSessions.v1
const STORAGE_KEY = 'ruankao.trainingSessions.v1'
export const TRAINING_LIMIT = 50

// 分段字数目标（教练七步流口径，设计稿 5.1）：论点区两段共 ~1000、问题2 下限 400
export const ARG_SECTION_TARGET = 1000
export const Q2_TARGET = 400

export function isTargetMet(argChars: number, q2Chars: number): boolean {
  return argChars >= ARG_SECTION_TARGET && q2Chars >= Q2_TARGET
}

export function newSessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  )
}

function isValidSession(value: unknown): value is RuankaoTrainingSession {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.id === 'string' &&
    typeof s.topic === 'string' &&
    typeof s.outline === 'string' &&
    typeof s.startedAt === 'string' &&
    typeof s.endedAt === 'string' &&
    typeof s.durationSec === 'number' &&
    typeof s.argChars === 'number' &&
    typeof s.q2Chars === 'number' &&
    typeof s.targetMet === 'boolean'
  )
}

export function loadSessions(): RuankaoTrainingSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidSession)
  } catch {
    // 解析失败回退空数组（本地存储损坏不阻塞训练器）
    return []
  }
}

export function saveSessions(sessions: RuankaoTrainingSession[]): void {
  if (typeof window === 'undefined') return
  // 上限 50：按 endedAt 保留最新 50 轮（列表按最新在前存储）
  const capped = [...sessions]
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1))
    .slice(0, TRAINING_LIMIT)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
  } catch {
    // 存储满/隐私模式：静默失败（UI 已带「本地存储」明示）
  }
}

/** 交卷落账：prepend 新一轮并落盘，返回落盘后的列表（已含上限裁剪结果）。 */
export function appendSession(session: RuankaoTrainingSession): RuankaoTrainingSession[] {
  saveSessions([session, ...loadSessions()])
  return loadSessions()
}

export function clearSessions(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // remove 失败不致命（下次读取仍会按解析回退）
  }
}

// 软考论文草稿 store（批次4 写作台）：localStorage 持久，零后端（ADR-018 起步姿态）。
// 不复用 Note——Note.save() 会自动 embed 进通用笔记检索语境，与「草稿是私人纸面」
// 的产品意图相悖；且 Note 无分段 schema。上限 20 稿，超出丢最旧。

export interface RuankaoEssaySections {
  abstract: string // 摘要 ≤300（含标点）
  background: string // 项目背景 ~500
  question2: string // 问题2 技术方法说明 ~500（下限 400）
  arguments: string // 论点区 两段各 ~500 共 ~1000（段内空行分段）
  closing: string // 结尾 ~400
}

export interface RuankaoEssayDraft {
  id: string
  title: string
  projectEnvId: string | null // 关联项目环境（固定件生成源）
  sections: RuankaoEssaySections
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'ruankao.essayDrafts.v1'
export const DRAFTS_LIMIT = 20

export function emptySections(): RuankaoEssaySections {
  return { abstract: '', background: '', question2: '', arguments: '', closing: '' }
}

export function newDraftId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createDraft(title = ''): RuankaoEssayDraft {
  const now = new Date().toISOString()
  return {
    id: newDraftId(),
    title,
    projectEnvId: null,
    sections: emptySections(),
    createdAt: now,
    updatedAt: now,
  }
}

function isValidDraft(value: unknown): value is RuankaoEssayDraft {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.id === 'string' &&
    typeof draft.title === 'string' &&
    (draft.projectEnvId === null || typeof draft.projectEnvId === 'string') &&
    typeof draft.sections === 'object' &&
    draft.sections !== null &&
    typeof (draft.sections as Record<string, unknown>).abstract === 'string' &&
    typeof draft.createdAt === 'string' &&
    typeof draft.updatedAt === 'string'
  )
}

export function loadDrafts(): RuankaoEssayDraft[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidDraft)
  } catch {
    // 解析失败回退空数组（本地存储损坏不阻塞写作台）
    return []
  }
}

export function saveDrafts(drafts: RuankaoEssayDraft[]): void {
  if (typeof window === 'undefined') return
  // 上限 20：超出丢最旧（updatedAt 最小者），写作台自建时已提示
  const capped = [...drafts]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
    .slice(Math.max(0, drafts.length - DRAFTS_LIMIT))
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
  } catch {
    // 存储满/隐私模式：静默失败（UI 已带「本地存储」明示）
  }
}

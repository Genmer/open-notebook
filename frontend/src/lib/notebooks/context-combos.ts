// 上下文组合（chat 选择器的具名勾选快照）：localStorage v1 持久，零后端。
// 每个组合存完整模式快照（sources/notes 全量），保存时过滤 'off'（等价不存）；
// 应用时整表替换，组合外的已知 id 一律 'off'。与折叠记忆按 notebookId 隔离。
// 激活记录带 dirty 位：勾选偏离激活组合快照时置 true，回正或更新快照时清零。

import type {
  ContextMode,
  ContextSelections,
  NoteContextMode,
} from '@/lib/types/notebook-context'

export const CONTEXT_COMBOS_STORAGE_KEY = 'notebooks.contextCombos.v1'

// 上限 20 个/笔记本，超出按 updatedAt 最旧淘汰（对齐 essay-drafts DRAFTS_LIMIT）
export const CONTEXT_COMBOS_LIMIT = 20

/** 默认组合的存储名占位：渲染名走 i18n（chat.contextComboDefaultName），永不直接展示 */
export const DEFAULT_COMBO_STORAGE_NAME = '__default__'

/** 组件间组合存储变更广播：跨表面（弹窗↔上下文栏）写后同步，避免 stale 读 */
export const CONTEXT_COMBOS_CHANGED_EVENT = 'context-combos-changed'

function notifyCombosChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONTEXT_COMBOS_CHANGED_EVENT))
}

/** 保存时已过滤 'off'：sources 值只会有 'full'/'insights'，notes 值只会有 'full' */
export interface ContextComboModes {
  sources: Record<string, ContextMode>
  notes: Record<string, NoteContextMode>
}

export interface ContextCombo extends ContextComboModes {
  id: string
  /** trim 后非空 */
  name: string
  createdAt: string
  updatedAt: string
  /** 默认组合（空快照、不计入上限、永不淘汰） */
  isDefault?: true
}

/** 激活组合完整状态：id 指向的组合 + 当前勾选是否已偏离其快照 */
export interface ActiveComboState {
  id: string
  dirty: boolean
}

// 磁盘宽容形态：旧版本只存字符串 id
type ActiveComboDiskValue = string | { id: string; dirty?: boolean } | null | undefined

interface ContextCombosStoreV1 {
  version: 1
  byNotebook: Record<string, ContextCombo[]>
  /** 每笔记本当前激活的组合；无激活时该 key 不存在 */
  activeByNotebook: Record<string, ActiveComboState>
}

function newComboId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `combo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// 空结果必须每次新建：写路径会原地改写 parseStore 的返回值（同 folder-collapse）
function emptyStore(): ContextCombosStoreV1 {
  return { version: 1, byNotebook: {}, activeByNotebook: {} }
}

// 读取宽容：坏 JSON / version 不符 / byNotebook 非 object → 空 store（不抛异常）。
// activeByNotebook 就地归一化为 {id, dirty}：旧字符串 → dirty:false，坏对象删 key。
function parseStore(): ContextCombosStoreV1 {
  if (typeof window === 'undefined') return emptyStore()
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)
  } catch {
    return emptyStore()
  }
  if (!raw) return emptyStore()
  try {
    const parsed = JSON.parse(raw) as Partial<ContextCombosStoreV1>
    if (
      parsed.version !== 1 ||
      parsed.byNotebook == null ||
      typeof parsed.byNotebook !== 'object'
    ) {
      return emptyStore()
    }
    const rawActive =
      parsed.activeByNotebook && typeof parsed.activeByNotebook === 'object'
        ? (parsed.activeByNotebook as Record<string, ActiveComboDiskValue>)
        : {}
    const activeByNotebook: Record<string, ActiveComboState> = {}
    for (const [nb, value] of Object.entries(rawActive)) {
      if (typeof value === 'string' && value) {
        activeByNotebook[nb] = { id: value, dirty: false }
      } else if (value != null && typeof value === 'object' && value.id) {
        activeByNotebook[nb] = { id: value.id, dirty: value.dirty === true }
      }
    }
    return { version: 1, byNotebook: parsed.byNotebook, activeByNotebook }
  } catch {
    return emptyStore()
  }
}

// 写静默：存储满/隐私模式下放弃落盘（调用方靠写后重读发现失败）
function writeStore(store: ContextCombosStoreV1): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 静默放弃
  }
}

// 宽容净化：id/name/时间戳非空字符串、sources 值 ∈ {'full','insights'}、
// notes 值 === 'full'，坏条目剔除不拖垮整体（对齐 question-generations sanitize 姿态）
function sanitizeCombo(value: unknown): ContextCombo | null {
  if (value == null || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (
    typeof raw.id !== 'string' ||
    !raw.id ||
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    typeof raw.createdAt !== 'string' ||
    !raw.createdAt ||
    typeof raw.updatedAt !== 'string' ||
    !raw.updatedAt ||
    raw.sources == null ||
    typeof raw.sources !== 'object' ||
    raw.notes == null ||
    typeof raw.notes !== 'object'
  ) {
    return null
  }
  const sources: Record<string, ContextMode> = {}
  for (const [id, mode] of Object.entries(raw.sources as Record<string, unknown>)) {
    if (mode === 'full' || mode === 'insights') sources[id] = mode
  }
  const notes: Record<string, NoteContextMode> = {}
  for (const [id, mode] of Object.entries(raw.notes as Record<string, unknown>)) {
    if (mode === 'full') notes[id] = mode
  }
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sources,
    notes,
    ...(raw.isDefault === true ? { isDefault: true as const } : {}),
  }
}

function sanitizeList(raw: unknown): ContextCombo[] {
  if (!Array.isArray(raw)) return []
  const combos: ContextCombo[] = []
  for (const entry of raw) {
    const combo = sanitizeCombo(entry)
    if (combo !== null) combos.push(combo)
  }
  return combos
}

export function listCombos(notebookId: string): ContextCombo[] {
  const { byNotebook } = parseStore()
  return sanitizeList(byNotebook[notebookId])
}

// 写后重读校验落盘结果（quota 静默放弃 → null 信号）。磁盘上同 id 条目可能
// 仍是旧值（覆盖/更新分支），必须比对 updatedAt 才能识破写失败
function writeStoreAndVerify(
  notebookId: string,
  store: ContextCombosStoreV1,
  comboId: string,
  expectedUpdatedAt: string,
): ContextCombo | null {
  writeStore(store)
  const persisted = listCombos(notebookId)
  const target = persisted.find(combo => combo.id === comboId)
  if (!target || target.updatedAt !== expectedUpdatedAt) return null
  return target
}

/** 保存当前勾选为组合：空选择（过滤 off 后全空）或 name trim 空 → null 不落盘；
 * 同名（trim 全等）覆盖更新（保留 id/createdAt，更新 modes/updatedAt）；
 * 用户组合超 LIMIT 淘汰 updatedAt 最旧（默认组合不计入、永不淘汰）；
 * 写后重读校验失败 → null。保存即激活。 */
export function saveCombo(
  notebookId: string,
  name: string,
  modes: ContextComboModes,
): ContextCombo | null {
  if (typeof window === 'undefined') return null
  const trimmedName = name.trim()
  if (!trimmedName) return null
  // 占位名专用：默认组合只能经 ensureDefaultCombo 创建
  if (trimmedName === DEFAULT_COMBO_STORAGE_NAME) return null
  // 过滤 off：等价不存
  const sources: Record<string, ContextMode> = {}
  for (const [id, mode] of Object.entries(modes.sources)) {
    if (mode !== 'off') sources[id] = mode
  }
  const notes: Record<string, NoteContextMode> = {}
  for (const [id, mode] of Object.entries(modes.notes)) {
    if (mode !== 'off') notes[id] = mode
  }
  if (Object.keys(sources).length === 0 && Object.keys(notes).length === 0) {
    return null
  }

  const store = parseStore()
  const combos = sanitizeList(store.byNotebook[notebookId])
  const now = new Date().toISOString()
  // 同名覆盖只看用户组合：手植的同名 '__default__' 条目不受 saveCombo 影响
  const existing = combos.find(
    combo => !combo.isDefault && combo.name.trim() === trimmedName
  )
  let targetId: string
  if (existing) {
    existing.sources = sources
    existing.notes = notes
    existing.updatedAt = now
    targetId = existing.id
  } else {
    targetId = newComboId()
    combos.push({
      id: targetId,
      name: trimmedName,
      createdAt: now,
      updatedAt: now,
      sources,
      notes,
    })
    // 上限按用户组合个数计：超出淘汰 updatedAt 最旧，默认组合永不淘汰
    const userCombos = combos.filter(combo => !combo.isDefault)
    if (userCombos.length > CONTEXT_COMBOS_LIMIT) {
      const keepIds = new Set(
        [...userCombos]
          .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
          .slice(-CONTEXT_COMBOS_LIMIT)
          .map(combo => combo.id),
      )
      const kept = combos.filter(combo => combo.isDefault || keepIds.has(combo.id))
      combos.length = 0
      combos.push(...kept)
    }
  }
  store.byNotebook[notebookId] = combos
  const target = writeStoreAndVerify(notebookId, store, targetId, now)
  if (!target) return null
  notifyCombosChanged()
  // 保存即激活：新存/覆盖的组合成为当前激活组合
  setActiveComboId(notebookId, target.id)
  return target
}

/** 按 id 覆盖组合快照：保 id/name/createdAt/isDefault，仅刷 modes/updatedAt；
 * 允许空快照；isDefault 目标拒绝；未知 id → null；写后重读校验失败 → null。
 * 若正是激活组合则同次落盘清 dirty。 */
export function updateCombo(
  notebookId: string,
  comboId: string,
  modes: ContextComboModes,
): ContextCombo | null {
  if (typeof window === 'undefined') return null
  const store = parseStore()
  const combos = sanitizeList(store.byNotebook[notebookId])
  const target = combos.find(combo => combo.id === comboId)
  if (!target || target.isDefault) return null
  // 过滤 off：等价不存（允许空快照）
  const sources: Record<string, ContextMode> = {}
  for (const [id, mode] of Object.entries(modes.sources)) {
    if (mode !== 'off') sources[id] = mode
  }
  const notes: Record<string, NoteContextMode> = {}
  for (const [id, mode] of Object.entries(modes.notes)) {
    if (mode !== 'off') notes[id] = mode
  }
  const now = new Date().toISOString()
  target.sources = sources
  target.notes = notes
  target.updatedAt = now
  store.byNotebook[notebookId] = combos
  const active = store.activeByNotebook[notebookId]
  if (active && active.id === comboId && active.dirty) {
    store.activeByNotebook[notebookId] = { id: comboId, dirty: false }
  }
  const updated = writeStoreAndVerify(notebookId, store, comboId, now)
  if (updated) notifyCombosChanged()
  return updated
}

/** 幂等保证默认组合存在：已有 isDefault 条目直接返回；否则创建空快照默认组合。
 * 不激活、不触发淘汰；写后校验失败 → null。 */
export function ensureDefaultCombo(notebookId: string): ContextCombo | null {
  if (typeof window === 'undefined') return null
  const store = parseStore()
  const combos = sanitizeList(store.byNotebook[notebookId])
  const existing = combos.find(combo => combo.isDefault)
  if (existing) return existing
  const now = new Date().toISOString()
  const id = newComboId()
  combos.push({
    id,
    name: DEFAULT_COMBO_STORAGE_NAME,
    createdAt: now,
    updatedAt: now,
    sources: {},
    notes: {},
    isDefault: true,
  })
  store.byNotebook[notebookId] = combos
  const created = writeStoreAndVerify(notebookId, store, id, now)
  if (created) notifyCombosChanged()
  return created
}

export function deleteCombo(notebookId: string, comboId: string): void {
  const store = parseStore()
  const combos = sanitizeList(store.byNotebook[notebookId])
  // 默认组合不可删（UI 不给删除口，存储层同姿态守卫）
  const target = combos.find(combo => combo.id === comboId)
  if (!target || target.isDefault) return
  const next = combos.filter(combo => combo.id !== comboId)
  if (next.length === combos.length) return
  store.byNotebook[notebookId] = next
  // 删除的若是激活组合，激活记录一并清掉
  const cur = store.activeByNotebook[notebookId]
  const activeId = typeof cur === 'string' ? cur : cur?.id
  if (activeId === comboId) {
    delete store.activeByNotebook[notebookId]
  }
  writeStore(store)
  notifyCombosChanged()
}

/** 激活组合完整状态；指向的组合已不存在时顺手清掉失效记录并返回 null */
export function getActiveCombo(notebookId: string): ActiveComboState | null {
  if (typeof window === 'undefined') return null
  const store = parseStore()
  const active = store.activeByNotebook[notebookId]
  if (!active) return null
  const combos = sanitizeList(store.byNotebook[notebookId])
  if (!combos.some(combo => combo.id === active.id)) {
    delete store.activeByNotebook[notebookId]
    writeStore(store)
    return null
  }
  return active
}

/** 当前激活组合 id（getActiveCombo 的 id 投影，兼容既有调用方） */
export function getActiveComboId(notebookId: string): string | null {
  return getActiveCombo(notebookId)?.id ?? null
}

/** 记录/清除激活组合；null 表示脱离组合（无激活）。写入即 dirty:false。 */
export function setActiveComboId(notebookId: string, comboId: string | null): void {
  if (typeof window === 'undefined') return
  const store = parseStore()
  if (comboId === null) {
    delete store.activeByNotebook[notebookId]
  } else {
    store.activeByNotebook[notebookId] = { id: comboId, dirty: false }
  }
  writeStore(store)
  notifyCombosChanged()
}

/** 仅当激活记录存在时改 dirty；不存在 → no-op。 */
export function setActiveComboDirty(notebookId: string, dirty: boolean): void {
  if (typeof window === 'undefined') return
  const store = parseStore()
  const active = store.activeByNotebook[notebookId]
  if (!active) return
  store.activeByNotebook[notebookId] = { ...active, dirty }
  writeStore(store)
  notifyCombosChanged()
}

/**
 * 当前勾选与组合快照的存活条目精确匹配：selections 非 off 条目与组合条目
 * 各自先按当前池过滤再比（键数与值都相等）。被删/未加载 id 不参与比对；
 * 空 vs 空 → true。组合应用的整表替换纯函数见 computeComboReplacement。
 */
export function selectionsMatchCombo(
  selections: ContextSelections,
  combo: ContextComboModes,
  sourceIds: ReadonlySet<string>,
  noteIds: ReadonlySet<string>,
): boolean {
  const activeSources = Object.entries(selections.sources).filter(
    ([, m]) => m && m !== 'off'
  )
  const activeNotes = Object.entries(selections.notes).filter(
    ([, m]) => m && m !== 'off'
  )
  const comboSourceEntries = Object.entries(combo.sources).filter(([id]) =>
    sourceIds.has(id)
  )
  const comboNoteEntries = Object.entries(combo.notes).filter(([id]) => noteIds.has(id))
  const activeValidSources = activeSources.filter(([id]) => sourceIds.has(id))
  const activeValidNotes = activeNotes.filter(([id]) => noteIds.has(id))
  if (
    activeValidSources.length !== comboSourceEntries.length ||
    activeValidNotes.length !== comboNoteEntries.length
  ) {
    return false
  }
  return (
    comboSourceEntries.every(([id, m]) => selections.sources[id] === m) &&
    comboNoteEntries.every(([id, m]) => selections.notes[id] === m)
  )
}

/**
 * 组合应用的整表替换纯函数。universe = 当前池 id ∪ prev 已选键 ∪ 组合键；
 * 组合有值取组合值否则 'off'。组合键必须入 universe：分页尚未加载的来源若
 * 被当作已删除跳过，后续分页加载时会回落到默认模式而不是组合值。
 */
export function computeComboReplacement(
  combo: ContextComboModes,
  sourceIds: Set<string>,
  noteIds: Set<string>,
  prev: ContextSelections,
): ContextSelections {
  const sources: Record<string, ContextMode> = {}
  const sourceUniverse = new Set<string>([
    ...sourceIds,
    ...Object.keys(prev.sources),
    ...Object.keys(combo.sources),
  ])
  for (const id of sourceUniverse) {
    sources[id] = combo.sources[id] ?? 'off'
  }
  const notes: Record<string, NoteContextMode> = {}
  const noteUniverse = new Set<string>([
    ...noteIds,
    ...Object.keys(prev.notes),
    ...Object.keys(combo.notes),
  ])
  for (const id of noteUniverse) {
    notes[id] = combo.notes[id] ?? 'off'
  }
  return { sources, notes }
}

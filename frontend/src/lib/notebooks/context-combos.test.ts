import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_COMBOS_LIMIT,
  CONTEXT_COMBOS_STORAGE_KEY,
  computeComboReplacement,
  deleteCombo,
  ensureDefaultCombo,
  getActiveCombo,
  getActiveComboId,
  listCombos,
  saveCombo,
  selectionsMatchCombo,
  setActiveComboDirty,
  setActiveComboId,
  updateCombo,
  type ContextComboModes,
} from './context-combos'
import type { ContextSelections } from '@/lib/types/notebook-context'

function modes(sources: string[], notes: string[] = []): ContextComboModes {
  return {
    sources: Object.fromEntries(sources.map(id => [id, 'full' as const])),
    notes: Object.fromEntries(notes.map(id => [id, 'full' as const])),
  }
}

// 直接落一个组合进原始 store（构造坏数据 / 固定时间戳用）
function seedRawCombo(combo: unknown, notebookId = 'nb1'): void {
  const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)
  const store = raw
    ? (JSON.parse(raw) as { version: number; byNotebook: Record<string, unknown[]> })
    : { version: 1, byNotebook: {} }
  const list = (store.byNotebook[notebookId] as unknown[] | undefined) ?? []
  list.push(combo)
  store.byNotebook[notebookId] = list
  window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))
}

describe('context-combos store', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('rejects an empty selection (after off filtering) without writing', () => {
    expect(saveCombo('nb1', 'A', { sources: {}, notes: {} })).toBeNull()
    expect(
      saveCombo('nb1', 'A', {
        sources: { s1: 'off', s2: 'off' },
        notes: { n1: 'off' },
      }),
    ).toBeNull()
    expect(saveCombo('nb1', '   ', modes(['s1']))).toBeNull()
    expect(listCombos('nb1')).toEqual([])
    expect(window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)).toBeNull()
  })

  it('round-trips a combo and drops off values at save time', () => {
    const saved = saveCombo('nb1', '论文模式', {
      sources: { s1: 'insights', s2: 'off' },
      notes: { n1: 'full', n2: 'off' },
    })
    expect(saved).not.toBeNull()
    expect(saved!.sources).toEqual({ s1: 'insights' })
    expect(saved!.notes).toEqual({ n1: 'full' })

    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(saved!.id)
    expect(loaded[0].name).toBe('论文模式')
    expect(loaded[0].sources).toEqual({ s1: 'insights' })
    expect(loaded[0].notes).toEqual({ n1: 'full' })
  })

  it('overrides a same-name combo keeping id/createdAt and refreshing modes/updatedAt', () => {
    const first = saveCombo('nb1', '我的组合', modes(['s1']))
    expect(first).not.toBeNull()
    const second = saveCombo('nb1', '  我的组合  ', modes(['s2']))
    expect(second).not.toBeNull()

    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(first!.id)
    expect(loaded[0].createdAt).toBe(first!.createdAt)
    expect(loaded[0].sources).toEqual({ s2: 'full' })
  })

  it('caps storage at 20 combos, evicting the oldest by updatedAt', () => {
    for (let i = 0; i < CONTEXT_COMBOS_LIMIT; i++) {
      expect(saveCombo('nb1', `c${i}`, modes(['s1']))).not.toBeNull()
    }
    // 保存时间戳可能同毫秒：手工铺开 updatedAt 保证淘汰序确定
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as {
      version: 1
      byNotebook: Record<string, Array<{ name: string; updatedAt: string }>>
    }
    store.byNotebook.nb1.forEach((combo, i) => {
      combo.updatedAt = new Date(Date.UTC(2026, 0, 1 + i)).toISOString()
    })
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))

    expect(saveCombo('nb1', 'newest', modes(['s1']))).not.toBeNull()

    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(CONTEXT_COMBOS_LIMIT)
    const names = loaded.map(combo => combo.name)
    expect(names).toContain('newest')
    expect(names).not.toContain('c0')
    expect(names).toContain('c1')
  })

  it('keeps notebooks isolated from each other', () => {
    saveCombo('nb1', 'only-nb1', modes(['s1']))
    saveCombo('nb2', 'only-nb2', modes(['s2']))
    expect(listCombos('nb1').map(combo => combo.name)).toEqual(['only-nb1'])
    expect(listCombos('nb2').map(combo => combo.name)).toEqual(['only-nb2'])
  })

  it('returns an empty list on missing key, bad JSON or wrong version', () => {
    expect(listCombos('nb1')).toEqual([])

    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, '{not json')
    expect(listCombos('nb1')).toEqual([])

    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({ version: 2, byNotebook: { nb1: [] } }),
    )
    expect(listCombos('nb1')).toEqual([])

    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({ version: 1, byNotebook: 'nope' }),
    )
    expect(listCombos('nb1')).toEqual([])
  })

  it('sanitizes illegal modes and drops nameless entries instead of failing the list', () => {
    seedRawCombo({
      id: 'c1',
      name: '组合一',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sources: { s1: 'insights', s2: 'weird', s3: 'full' },
      notes: { n1: 'full', n2: 'insights' },
    })
    seedRawCombo({ id: 'c2', name: '   ', sources: {}, notes: {} })
    seedRawCombo({ id: 'c3' })

    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('c1')
    expect(loaded[0].sources).toEqual({ s1: 'insights', s3: 'full' })
    expect(loaded[0].notes).toEqual({ n1: 'full' })
  })

  it('returns null on silent write failure in the overwrite branch (disk still has the old entry)', () => {
    const first = saveCombo('nb1', '我的组合', modes(['s1']))
    expect(first).not.toBeNull()

    // 同毫秒内两次保存会让 updatedAt 比对必然相等，先拨回磁盘时间戳保证可辨
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as {
      byNotebook: Record<string, Array<{ updatedAt: string }>>
    }
    store.byNotebook.nb1[0].updatedAt = '2026-01-01T00:00:00.000Z'
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))

    // jsdom 的 setItem 挂在 Storage.prototype 上，实例级 spy 拦不住
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      })
    try {
      expect(saveCombo('nb1', '我的组合', modes(['s2']))).toBeNull()
    } finally {
      setItem.mockRestore()
    }

    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].sources).toEqual({ s1: 'full' })
  })

  it('deletes only the target combo and ignores unknown ids', () => {
    const a = saveCombo('nb1', 'A', modes(['s1']))
    const b = saveCombo('nb1', 'B', modes(['s2']))
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()

    deleteCombo('nb1', 'unknown-id')
    expect(listCombos('nb1')).toHaveLength(2)

    deleteCombo('nb1', a!.id)
    const loaded = listCombos('nb1')
    expect(loaded.map(combo => combo.name)).toEqual(['B'])
  })
})

describe('active combo memory', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('marks the saved combo active automatically (save = activate)', () => {
    const saved = saveCombo('nb1', '论文', modes(['s1']))
    expect(saved).not.toBeNull()
    expect(getActiveComboId('nb1')).toBe(saved!.id)

    // 换个笔记本保存，激活记录互不影响
    const other = saveCombo('nb2', '案例', modes(['s2']))
    expect(getActiveComboId('nb1')).toBe(saved!.id)
    expect(getActiveComboId('nb2')).toBe(other!.id)

    // 覆盖同名组合后保持激活
    const updated = saveCombo('nb1', '论文', modes(['s2']))
    expect(updated!.id).toBe(saved!.id)
    expect(getActiveComboId('nb1')).toBe(saved!.id)
  })

  it('clears the active combo with setActiveComboId(nb, null)', () => {
    const saved = saveCombo('nb1', '案例', modes(['s1']))
    expect(getActiveComboId('nb1')).toBe(saved!.id)

    setActiveComboId('nb1', null)
    expect(getActiveComboId('nb1')).toBeNull()

    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null',
    )
    expect(stored.byNotebook.nb1).toHaveLength(1)
    expect(stored.activeByNotebook).toEqual({})
  })

  it('clears the active record when the active combo is deleted', () => {
    const a = saveCombo('nb1', 'A', modes(['s1']))
    const b = saveCombo('nb1', 'B', modes(['s2']))
    // saveCombo 保存即激活：b 成为激活组合
    expect(getActiveComboId('nb1')).toBe(b!.id)

    deleteCombo('nb1', b!.id)
    expect(getActiveComboId('nb1')).toBeNull()
    expect(listCombos('nb1').map(combo => combo.id)).toEqual([a!.id])
  })

  it('returns null and cleans up when the active record points to a missing combo', () => {
    saveCombo('nb1', 'A', modes(['s1']))
    // 模拟存储被外部改坏：激活 id 指向不存在的组合
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as {
      activeByNotebook: Record<string, string | null>
    }
    store.activeByNotebook.nb1 = 'ghost-id'
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))

    expect(getActiveComboId('nb1')).toBeNull()
    const after = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!,
    ) as { activeByNotebook: Record<string, string | null> }
    expect(after.activeByNotebook.nb1).toBeUndefined()
  })

  it('returns null on empty storage or corrupted active data', () => {
    expect(getActiveComboId('nb1')).toBeNull()

    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({ version: 1, byNotebook: { nb1: [] }, activeByNotebook: 'nope' }),
    )
    expect(getActiveComboId('nb1')).toBeNull()

    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({ version: 1, byNotebook: { nb1: [] }, activeByNotebook: { nb1: 42 } }),
    )
    expect(getActiveComboId('nb1')).toBeNull()

    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, '{not json')
    expect(getActiveComboId('nb1')).toBeNull()
  })
})

describe('computeComboReplacement', () => {
  const poolIds = new Set(['s1', 's2', 's3'])
  const noteIds = new Set(['n1', 'n2'])

  it('applies combo values inside the pool and fills the rest with off', () => {
    const replacement = computeComboReplacement(
      { sources: { s1: 'insights' }, notes: { n1: 'full' } },
      poolIds,
      noteIds,
      { sources: {}, notes: {} },
    )
    expect(replacement.sources).toEqual({
      s1: 'insights',
      s2: 'off',
      s3: 'off',
    })
    expect(replacement.notes).toEqual({ n1: 'full', n2: 'off' })
  })

  it('keeps combo entries outside the pool at their combo value (deleted or not yet paginated in)', () => {
    const replacement = computeComboReplacement(
      { sources: { s1: 'full', s9: 'full' }, notes: { n9: 'full' } },
      poolIds,
      noteIds,
      { sources: {}, notes: {} },
    )
    expect(replacement.sources).toEqual({
      s1: 'full',
      s2: 'off',
      s3: 'off',
      s9: 'full',
    })
    expect(replacement.notes).toEqual({ n1: 'off', n2: 'off', n9: 'full' })
  })

  it('turns previously selected out-of-pool ids off when the combo omits them', () => {
    const prev: ContextSelections = {
      sources: { s1: 'insights', s7: 'full' },
      notes: { n3: 'full' },
    }
    const replacement = computeComboReplacement(
      { sources: { s1: 'full' }, notes: {} },
      poolIds,
      noteIds,
      prev,
    )
    expect(replacement.sources).toEqual({
      s1: 'full',
      s2: 'off',
      s3: 'off',
      s7: 'off',
    })
    expect(replacement.notes).toEqual({ n1: 'off', n2: 'off', n3: 'off' })
  })
})

describe('updateCombo', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function rewindUpdatedAt(notebookId: string, comboId: string): void {
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as {
      byNotebook: Record<string, Array<{ id: string; updatedAt: string }>>
    }
    const combo = store.byNotebook[notebookId].find(c => c.id === comboId)
    if (combo) combo.updatedAt = '2026-01-01T00:00:00.000Z'
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))
  }

  it('overwrites by id keeping id/name/createdAt, refreshing modes/updatedAt and clearing dirty', () => {
    const saved = saveCombo('nb1', '论文组合', modes(['s1'], ['n1']))
    expect(saved).not.toBeNull()
    setActiveComboDirty('nb1', true)
    rewindUpdatedAt('nb1', saved!.id)

    const updated = updateCombo('nb1', saved!.id, modes(['s2']))
    expect(updated).not.toBeNull()
    expect(updated!.id).toBe(saved!.id)
    expect(updated!.name).toBe('论文组合')
    expect(updated!.createdAt).toBe(saved!.createdAt)
    expect(updated!.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
    expect(updated!.sources).toEqual({ s2: 'full' })
    expect(updated!.notes).toEqual({})
    expect(getActiveCombo('nb1')).toEqual({ id: saved!.id, dirty: false })
  })

  it('accepts an empty snapshot', () => {
    const saved = saveCombo('nb1', '空组合', modes(['s1']))
    expect(saved).not.toBeNull()

    const updated = updateCombo('nb1', saved!.id, { sources: {}, notes: {} })
    expect(updated).not.toBeNull()
    expect(updated!.sources).toEqual({})
    expect(updated!.notes).toEqual({})
    expect(listCombos('nb1')).toHaveLength(1)
  })

  it('returns null for unknown ids and refuses isDefault targets', () => {
    const saved = saveCombo('nb1', '普通组合', modes(['s1']))
    expect(saved).not.toBeNull()
    expect(updateCombo('nb1', 'ghost-id', modes(['s2']))).toBeNull()

    const def = ensureDefaultCombo('nb1')
    expect(def).not.toBeNull()
    expect(updateCombo('nb1', def!.id, modes(['s2']))).toBeNull()
    expect(listCombos('nb1').find(c => c.isDefault)!.sources).toEqual({})
  })

  it('returns null on silent write failure leaving the disk unchanged', () => {
    const saved = saveCombo('nb1', '我的组合', modes(['s1']))
    expect(saved).not.toBeNull()
    rewindUpdatedAt('nb1', saved!.id)

    // jsdom 的 setItem 挂在 Storage.prototype 上，实例级 spy 拦不住
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      })
    try {
      expect(updateCombo('nb1', saved!.id, modes(['s2']))).toBeNull()
    } finally {
      setItem.mockRestore()
    }

    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].sources).toEqual({ s1: 'full' })
    expect(loaded[0].updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('ensureDefaultCombo', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('creates an empty isDefault combo once and is idempotent', () => {
    const first = ensureDefaultCombo('nb1')
    expect(first).not.toBeNull()
    expect(first!.isDefault).toBe(true)
    expect(first!.name).toBe('__default__')
    expect(first!.sources).toEqual({})
    expect(first!.notes).toEqual({})

    const second = ensureDefaultCombo('nb1')
    expect(second!.id).toBe(first!.id)
    expect(listCombos('nb1')).toHaveLength(1)

    // 默认组合不改变激活记忆
    expect(getActiveComboId('nb1')).toBeNull()
  })

  it('survives eviction while user combos are capped at the limit', () => {
    expect(ensureDefaultCombo('nb1')).not.toBeNull()
    for (let i = 0; i < CONTEXT_COMBOS_LIMIT; i++) {
      expect(saveCombo('nb1', `c${i}`, modes(['s1']))).not.toBeNull()
    }
    // 保存时间戳可能同毫秒：手工铺开 updatedAt 保证淘汰序确定
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as {
      byNotebook: Record<string, Array<{ name: string; updatedAt: string; isDefault?: boolean }>>
    }
    let userIndex = 0
    for (const combo of store.byNotebook.nb1) {
      if (combo.isDefault) continue
      combo.updatedAt = new Date(Date.UTC(2026, 0, 1 + userIndex)).toISOString()
      userIndex++
    }
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))

    expect(saveCombo('nb1', 'newest', modes(['s1']))).not.toBeNull()

    const loaded = listCombos('nb1')
    // 20 个用户组合 + 存活的默认组合
    expect(loaded).toHaveLength(CONTEXT_COMBOS_LIMIT + 1)
    const names = loaded.map(combo => combo.name)
    expect(names).toContain('newest')
    expect(names).not.toContain('c0')
    expect(loaded.filter(combo => combo.isDefault)).toHaveLength(1)
  })
})

describe('active combo state (id + dirty)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('normalizes a legacy string activeByNotebook entry to {id, dirty:false}', () => {
    saveCombo('nb1', '旧组合', modes(['s1']))
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as {
      activeByNotebook: Record<string, { id: string } | string>
    }
    const comboId =
      typeof store.activeByNotebook.nb1 === 'string'
        ? store.activeByNotebook.nb1
        : store.activeByNotebook.nb1.id
    store.activeByNotebook.nb1 = comboId // 回写为旧版字符串形态
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))

    expect(getActiveCombo('nb1')).toEqual({ id: comboId, dirty: false })
    expect(getActiveComboId('nb1')).toBe(comboId)
  })

  it('drops corrupt active objects instead of exposing them', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: { nb1: [] },
        activeByNotebook: { nb1: { nope: true }, nb2: { id: '' }, nb3: 42 },
      }),
    )
    expect(getActiveCombo('nb1')).toBeNull()
    expect(getActiveCombo('nb2')).toBeNull()
    expect(getActiveCombo('nb3')).toBeNull()
    expect(getActiveComboId('nb1')).toBeNull()
  })

  it('flips dirty only when an active record exists (no-op otherwise)', () => {
    setActiveComboDirty('nb1', true)
    expect(getActiveCombo('nb1')).toBeNull()
    expect(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY),
    ).toBeNull()

    const saved = saveCombo('nb1', '组合', modes(['s1']))
    expect(getActiveCombo('nb1')).toEqual({ id: saved!.id, dirty: false })

    setActiveComboDirty('nb1', true)
    expect(getActiveCombo('nb1')).toEqual({ id: saved!.id, dirty: true })

    setActiveComboDirty('nb1', false)
    expect(getActiveCombo('nb1')).toEqual({ id: saved!.id, dirty: false })
  })

  it('keeps dirty through deleteCombo of a different combo and writes dirty:false on setActiveComboId', () => {
    const a = saveCombo('nb1', 'A', modes(['s1']))
    const b = saveCombo('nb1', 'B', modes(['s2']))
    expect(getActiveComboId('nb1')).toBe(b!.id)

    deleteCombo('nb1', a!.id)
    expect(getActiveCombo('nb1')).toEqual({ id: b!.id, dirty: false })

    setActiveComboDirty('nb1', true)
    setActiveComboId('nb1', b!.id)
    expect(getActiveCombo('nb1')).toEqual({ id: b!.id, dirty: false })
  })
})

describe('selectionsMatchCombo', () => {
  const sourceIds = new Set(['s1', 's2', 's3'])
  const noteIds = new Set(['n1', 'n2'])

  it('matches exact selections inside the pool', () => {
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'full', s2: 'insights', s3: 'off' }, notes: { n1: 'full' } },
        { sources: { s1: 'full', s2: 'insights' }, notes: { n1: 'full' } },
        sourceIds,
        noteIds,
      ),
    ).toBe(true)
  })

  it('fails when values differ or counts differ', () => {
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'insights' }, notes: {} },
        { sources: { s1: 'full' }, notes: {} },
        sourceIds,
        noteIds,
      ),
    ).toBe(false)
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'full', s2: 'full' }, notes: {} },
        { sources: { s1: 'full' }, notes: {} },
        sourceIds,
        noteIds,
      ),
    ).toBe(false)
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'full' }, notes: { n1: 'full' } },
        { sources: { s1: 'full' }, notes: {} },
        sourceIds,
        noteIds,
      ),
    ).toBe(false)
  })

  it('ignores combo entries deleted from the pools', () => {
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'full', s2: 'off', s3: 'off' }, notes: { n1: 'full' } },
        { sources: { s1: 'full', s9: 'full' }, notes: { n1: 'full', n9: 'full' } },
        sourceIds,
        noteIds,
      ),
    ).toBe(true)
  })

  it('ignores off entries on the selection side', () => {
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'full', s2: 'off' }, notes: { n2: 'off' } },
        { sources: { s1: 'full' }, notes: {} },
        sourceIds,
        noteIds,
      ),
    ).toBe(true)
  })

  it('matches empty vs empty and fails empty vs non-empty', () => {
    expect(
      selectionsMatchCombo({ sources: {}, notes: {} }, { sources: {}, notes: {} }, sourceIds, noteIds),
    ).toBe(true)
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'full' }, notes: {} },
        { sources: {}, notes: {} },
        sourceIds,
        noteIds,
      ),
    ).toBe(false)
  })

  it('does not fail on out-of-pool non-off selections', () => {
    // s7 不在池内（未加载/已删）：不参与比对，不导致失配
    expect(
      selectionsMatchCombo(
        { sources: { s1: 'full', s7: 'full' }, notes: {} },
        { sources: { s1: 'full' }, notes: {} },
        sourceIds,
        noteIds,
      ),
    ).toBe(true)
  })
})

describe('placeholder name and default-combo guards', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('rejects saving the placeholder name and never touches the default combo', () => {
    const def = ensureDefaultCombo('nb1')
    expect(def).not.toBeNull()

    expect(saveCombo('nb1', '__default__', modes(['s1']))).toBeNull()
    // trim 后命中占位名同样拒绝
    expect(saveCombo('nb1', '  __default__  ', modes(['s2']))).toBeNull()

    // 默认组合原样：未被覆盖、未新增
    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(def!.id)
    expect(loaded[0].isDefault).toBe(true)
    expect(loaded[0].sources).toEqual({})
  })

  it('keeps a hand-seeded plain __default__ entry a normal user combo', () => {
    seedRawCombo({
      id: 'c-plain',
      name: '__default__',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sources: { s1: 'full' },
      notes: {},
    })
    // ensureDefaultCombo 不把同名普通条目当默认组合：另建 isDefault 条目
    const def = ensureDefaultCombo('nb1')
    expect(def).not.toBeNull()
    expect(def!.isDefault).toBe(true)
    expect(def!.id).not.toBe('c-plain')

    const loaded = listCombos('nb1')
    expect(loaded.filter(combo => combo.isDefault)).toHaveLength(1)
    expect(loaded.filter(combo => !combo.isDefault).map(combo => combo.id)).toEqual([
      'c-plain',
    ])
  })

  it('refuses to delete the default combo', () => {
    const def = ensureDefaultCombo('nb1')
    expect(def).not.toBeNull()

    deleteCombo('nb1', def!.id)

    const loaded = listCombos('nb1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].isDefault).toBe(true)
  })
})

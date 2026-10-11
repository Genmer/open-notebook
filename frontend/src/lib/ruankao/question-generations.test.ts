import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GENERATIONS_MAX_QUESTIONS,
  GENERATIONS_STORAGE_KEY,
  normTitleKey,
  readGeneration,
  saveGeneration,
} from './question-generations'
import type {
  BreakdownResult,
  OutlineResult,
  Q2PointsResult,
} from '@/lib/types/api'

// 纯函数单测：真 localStorage（beforeEach 清空），B7 用 setItem spy 模拟配额。

const BREAKDOWN: BreakdownResult = {
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
      name: '一致性哈希的落地取舍',
      thesis_hint: '主旨候选句方向二',
      material_match: '中：需要缓存场景支撑',
      difficulty: 'medium',
      similarity_risk: 'low',
    },
  ],
  combo_advice: '建议选角度一与角度二，与摘要呼应',
}

const Q2_POINTS: Q2PointsResult = {
  kind: 'q2_points',
  framework: '总-分-总技术方法论述框架',
  points: [{ heading: '要点一', detail: '展开说明' }],
  outline_hint: '按要点顺序组织，正文必须考生自己写',
}

const OUTLINE: OutlineResult = {
  kind: 'outline',
  paragraphs: [
    { role: 'q2', outline: '主旨候选句 + 分层展开', data_anchors: ['扩容前后 QPS 对比'] },
    { role: 'q3', outline: '实施与效果展开', data_anchors: ['故障恢复时长'] },
  ],
}

function readRaw(): { version: number; entries: Record<string, Record<string, unknown>> } | null {
  const raw = localStorage.getItem(GENERATIONS_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

interface RawStored {
  generatedAt?: string
  content?: unknown
  note?: string
}

function seedEntry(key: string, iso: string, kind = 'breakdown') {
  const store = readRaw() ?? { version: 1, entries: {} }
  store.entries[key] = {
    [kind]: {
      content: { ...BREAKDOWN, combo_advice: `缓存于 ${key}` },
      generatedAt: iso,
    },
  }
  localStorage.setItem(GENERATIONS_STORAGE_KEY, JSON.stringify(store))
}

describe('question-generations storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('B1: a successful generation lands under entries[<id>][kind] with generatedAt and content', () => {
    const ok = saveGeneration(
      { id: 'ruankao-question-seed-fa2045ae62', title: '软件测试' },
      'breakdown',
      BREAKDOWN
    )

    expect(ok).toBe(true)
    const raw = readRaw()
    expect(raw?.version).toBe(1)
    const stored = raw?.entries['ruankao-question-seed-fa2045ae62']?.breakdown as
      | RawStored
      | undefined
    expect(stored).toBeDefined()
    expect(typeof stored?.generatedAt).toBe('string')
    expect(stored?.content).toEqual(BREAKDOWN)
    expect(stored?.note).toBeUndefined()
    // 读接口按同一题目取回同一结果
    expect(readGeneration({ id: 'ruankao-question-seed-fa2045ae62', title: '软件测试' }, 'breakdown')?.content).toEqual(BREAKDOWN)
  })

  it('B2: seed (stable id) and user (UUID) questions each round-trip their own entry', () => {
    saveGeneration({ id: 'ruankao-question-seed-fa2045ae62', title: '软件测试' }, 'breakdown', BREAKDOWN)
    saveGeneration({ id: '0d9a2c1e-0000-4000-8000-000000000001', title: '论消息队列的应用' }, 'outline', OUTLINE)

    const seedHit = readGeneration({ id: 'ruankao-question-seed-fa2045ae62', title: '软件测试' }, 'breakdown')
    const userHit = readGeneration(
      { id: '0d9a2c1e-0000-4000-8000-000000000001', title: '论消息队列的应用' },
      'outline'
    )
    expect(seedHit?.content).toEqual(BREAKDOWN)
    expect(userHit?.content).toEqual(OUTLINE)
    // kind 互不串扰
    expect(readGeneration({ id: 'ruankao-question-seed-fa2045ae62', title: '软件测试' }, 'outline')).toBeNull()
  })

  it('B3: regenerating with a note overwrites the single entry (no version list)', () => {
    // 固定时钟并推进：两次写入的 generatedAt 必须可区分
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'))
    const q = { id: 'user-uuid-1', title: '论网关限流的应用' }
    saveGeneration(q, 'q2_points', Q2_POINTS)
    const first = readRaw()!.entries['user-uuid-1'].q2_points as RawStored
    const regenerated = { ...Q2_POINTS, framework: '按备注换向：漏桶算法为主线' }
    vi.setSystemTime(new Date('2026-10-11T00:05:00Z'))

    const ok = saveGeneration(q, 'q2_points', regenerated, '往漏桶方向重写')
    vi.useRealTimers()

    expect(ok).toBe(true)
    const perKind = readRaw()!.entries['user-uuid-1']
    // 单结果覆盖：同 kind 仍只有一个条目，无第二版本
    expect(Object.keys(perKind)).toEqual(['q2_points'])
    const second = perKind.q2_points as Record<string, unknown>
    expect(second.content).toEqual(regenerated)
    expect(second.note).toBe('往漏桶方向重写')
    expect(second.generatedAt).not.toBe(first.generatedAt)
  })

  it('B4: id-less questions key by normalized title and are found by it', () => {
    const ok = saveGeneration({ title: '  论   微服务 网关 的应用 ' }, 'breakdown', BREAKDOWN)

    expect(ok).toBe(true)
    // 规范化标题键：trim + 空白折叠 + 小写
    expect(Object.keys(readRaw()!.entries)).toEqual([normTitleKey('论 微服务 网关 的应用')])
    // 带 id 读取时 id 未命中 → 再试规范化标题兜底键
    const hit = readGeneration({ id: 'some-other-uuid', title: '论 微服务 网关 的应用' }, 'breakdown')
    expect(hit?.content).toEqual(BREAKDOWN)
  })

  it('B5: bad JSON / wrong version / broken entries fall back without crashing', () => {
    // 坏 JSON → 空读
    localStorage.setItem(GENERATIONS_STORAGE_KEY, '{not json')
    expect(readGeneration({ id: 'a', title: 'x' }, 'breakdown')).toBeNull()

    // version 不符 → 空读
    localStorage.setItem(GENERATIONS_STORAGE_KEY, JSON.stringify({ version: 2, entries: { a: {} } }))
    expect(readGeneration({ id: 'a', title: 'x' }, 'breakdown')).toBeNull()

    // 单条坏目剔除不拖垮整体：坏条目缺 generatedAt / kind 非法 / 内容形状错
    localStorage.setItem(
      GENERATIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: {
          broken_no_time: { breakdown: { content: BREAKDOWN } },
          broken_kind: { nonsense_kind: { content: BREAKDOWN, generatedAt: '2026-10-11T00:00:00Z' } },
          broken_shape: {
            breakdown: { content: { kind: 'breakdown', angles: 'not-an-array' }, generatedAt: '2026-10-11T00:00:00Z' },
          },
          broken_content_kind_mismatch: {
            breakdown: { content: OUTLINE, generatedAt: '2026-10-11T00:00:00Z' },
          },
          good: { breakdown: { content: BREAKDOWN, generatedAt: '2026-10-11T00:00:00Z' } },
        },
      })
    )
    expect(readGeneration({ id: 'good', title: 'x' }, 'breakdown')?.content).toEqual(BREAKDOWN)
    expect(readGeneration({ id: 'broken_no_time', title: 'x' }, 'breakdown')).toBeNull()
    expect(readGeneration({ id: 'broken_kind', title: 'x' }, 'breakdown' as never)).toBeNull()
    expect(readGeneration({ id: 'broken_shape', title: 'x' }, 'breakdown')).toBeNull()
    expect(readGeneration({ id: 'broken_content_kind_mismatch', title: 'x' }, 'breakdown')).toBeNull()
  })

  it('B6: beyond the 100-question cap the oldest question entry is evicted', () => {
    for (let i = 0; i < GENERATIONS_MAX_QUESTIONS; i += 1) {
      seedEntry(`q-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
    }
    expect(Object.keys(readRaw()!.entries)).toHaveLength(GENERATIONS_MAX_QUESTIONS)

    const ok = saveGeneration(
      { id: 'q-new', title: '新题目' },
      'breakdown',
      BREAKDOWN
    )

    expect(ok).toBe(true)
    const entries = readRaw()!.entries
    expect(Object.keys(entries)).toHaveLength(GENERATIONS_MAX_QUESTIONS)
    expect(entries['q-new']).toBeDefined()
    // 最旧（时间戳最小）的 q-0 被淘汰
    expect(entries['q-0']).toBeUndefined()
    // 其余完好：q-1 与最后一题都在
    expect(entries['q-1']).toBeDefined()
    expect(entries[`q-${GENERATIONS_MAX_QUESTIONS - 1}`]).toBeDefined()
  })

  it('B7: quota error evicts the 10 oldest entries and retries once', () => {
    for (let i = 0; i < 15; i += 1) {
      seedEntry(`q-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
    }
    // jsdom 下 spyOn(localStorage, 'setItem') 不拦截（实验证实），整体替换
    // window.localStorage 描述符：第一次 setItem 抛 QuotaExceededError，
    // 之后透传真实存储。
    const real = window.localStorage
    const backing = new Map<string, string>()
    for (let i = 0; i < real.length; i += 1) {
      const key = real.key(i)
      if (key != null) backing.set(key, real.getItem(key) ?? '')
    }
    let calls = 0
    const quotaError = new Error('quota exceeded')
    quotaError.name = 'QuotaExceededError'
    const fake = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        calls += 1
        if (calls === 1) throw quotaError
        backing.set(key, value)
      },
      removeItem: (key: string) => void backing.delete(key),
      clear: () => backing.clear(),
      key: (index: number) => Array.from(backing.keys())[index] ?? null,
      get length() {
        return backing.size
      },
    }
    Object.defineProperty(window, 'localStorage', { value: fake, configurable: true })
    try {
      const ok = saveGeneration({ id: 'q-new', title: '新题目' }, 'breakdown', BREAKDOWN)

      expect(ok).toBe(true)
      expect(calls).toBe(2) // 失败一次 → 淘汰后重试一次
      const store = readRaw()!
      const entries = store.entries
      // 15 - 10（最旧淘汰）+ 1（新写入）= 6
      expect(Object.keys(entries)).toHaveLength(6)
      expect(entries['q-new']).toBeDefined()
      for (let i = 0; i < 10; i += 1) {
        expect(entries[`q-${i}`]).toBeUndefined()
      }
      expect(entries['q-10']).toBeDefined()
    } finally {
      Object.defineProperty(window, 'localStorage', { value: real, configurable: true })
    }
  })

  it('B7: a persistent quota error gives up silently (no throw, not persisted)', () => {
    seedEntry('q-0', new Date(Date.UTC(2026, 0, 1)).toISOString())
    const real = window.localStorage
    const quotaError = new Error('quota exceeded')
    quotaError.name = 'QuotaExceededError'
    const fake = {
      getItem: () => real.getItem(GENERATIONS_STORAGE_KEY),
      setItem: () => {
        throw quotaError
      },
      removeItem: (key: string) => real.removeItem(key),
      clear: () => real.clear(),
      key: (index: number) => real.key(index),
      get length() {
        return real.length
      },
    }
    Object.defineProperty(window, 'localStorage', { value: fake, configurable: true })
    try {
      expect(() =>
        saveGeneration({ id: 'q-new', title: '新题目' }, 'breakdown', BREAKDOWN)
      ).not.toThrow()
      // 返回 false = 未落盘（UI 会话内存仍可见结果，调用方不依赖返回值强一致）
      expect(saveGeneration({ id: 'q-new', title: '新题目' }, 'breakdown', BREAKDOWN)).toBe(false)
    } finally {
      Object.defineProperty(window, 'localStorage', { value: real, configurable: true })
    }
  })
})

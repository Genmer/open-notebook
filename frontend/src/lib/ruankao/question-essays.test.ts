import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ESSAYS_MAX_QUESTIONS,
  ESSAYS_STORAGE_KEY,
  readQuestionEssay,
  saveQuestionEssay,
} from './question-essays'

// 纯函数单测：真 localStorage（beforeEach 清空），配额用整体替换
// window.localStorage 描述符模拟（question-generations.test.ts 先例）。

const ESSAY_A = {
  envId: 'env-1',
  envName: '电商订单中台',
  content: '摘要段……正文两段……结尾段。',
  generatedAt: '2026-10-18T00:00:00.000Z',
}

const ESSAY_B = {
  envId: 'env-2',
  envName: '物流调度平台',
  content: '第二篇草稿全文。',
  generatedAt: '2026-10-18T01:00:00.000Z',
}

function readRaw(): {
  version: number
  entries: Record<string, Record<string, unknown>>
} | null {
  const raw = localStorage.getItem(ESSAYS_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

function seedEntry(questionId: string, iso: string) {
  const store = readRaw() ?? { version: 1, entries: {} }
  store.entries[questionId] = {
    envId: `env-${questionId}`,
    envName: `环境-${questionId}`,
    content: `缓存于 ${questionId}`,
    generatedAt: iso,
  }
  localStorage.setItem(ESSAYS_STORAGE_KEY, JSON.stringify(store))
}

describe('question-essays storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('a successful essay lands under entries[<questionId>] with env meta and round-trips', () => {
    const ok = saveQuestionEssay('ruankao-question-seed-x', ESSAY_A)

    expect(ok).toBe(true)
    const raw = readRaw()
    expect(raw?.version).toBe(1)
    const stored = raw?.entries['ruankao-question-seed-x'] as
      | typeof ESSAY_A & { note?: string }
      | undefined
    expect(stored).toBeDefined()
    expect(stored).toMatchObject(ESSAY_A)
    expect(stored?.note).toBeUndefined() // 无备注生成 → 条目不带 note
    // 读接口按同一题目取回同一结果；未知题目 → null
    expect(readQuestionEssay('ruankao-question-seed-x')).toEqual(ESSAY_A)
    expect(readQuestionEssay('unknown-id')).toBeNull()
  })

  it('regenerating overwrites the single per-question entry (no version list); note is trimmed', () => {
    saveQuestionEssay('user-uuid-1', ESSAY_A)
    const first = readRaw()!.entries['user-uuid-1'] as typeof ESSAY_A

    // 重新生成：generatedAt 由调用方传入（ESSAY_B 更晚），note 经 trim 落盘
    const ok = saveQuestionEssay('user-uuid-1', {
      ...ESSAY_B,
      note: '  往高并发方向重写  ',
    })

    expect(ok).toBe(true)
    const entries = readRaw()!.entries
    // 单结果覆盖：该题仍只有一个条目（每题最新一篇，无第二版本）
    expect(Object.keys(entries)).toEqual(['user-uuid-1'])
    const second = entries['user-uuid-1'] as typeof ESSAY_B & { note?: string }
    expect(second).toMatchObject({
      envId: ESSAY_B.envId,
      envName: ESSAY_B.envName,
      content: ESSAY_B.content,
    })
    expect(second.note).toBe('往高并发方向重写') // trim 后落盘
    expect(second.generatedAt).not.toBe(first.generatedAt)
  })

  it('bad JSON / wrong version / broken entries fall back without crashing', () => {
    // 坏 JSON → 空读
    localStorage.setItem(ESSAYS_STORAGE_KEY, '{not json')
    expect(readQuestionEssay('a')).toBeNull()

    // version 不符 → 空读
    localStorage.setItem(
      ESSAYS_STORAGE_KEY,
      JSON.stringify({ version: 2, entries: { a: ESSAY_A } }),
    )
    expect(readQuestionEssay('a')).toBeNull()

    // 单条坏目剔除不拖垮整体：缺 generatedAt / 缺 envId / 空 content /
    // 类型错位 / 非对象条目
    localStorage.setItem(
      ESSAYS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: {
          broken_no_time: { ...ESSAY_A, generatedAt: '' },
          broken_no_env: { ...ESSAY_A, envId: '' },
          broken_no_env_name: { envId: 'env-1', envName: 42, content: 'x', generatedAt: '2026-10-18T00:00:00Z' },
          broken_empty_content: { ...ESSAY_A, content: '' },
          broken_types: { envId: 'env-1', envName: 'n', content: 7, generatedAt: '2026-10-18T00:00:00Z' },
          broken_non_object: 'not-an-entry',
          good: ESSAY_A,
        },
      }),
    )
    expect(readQuestionEssay('good')).toEqual(ESSAY_A)
    expect(readQuestionEssay('broken_no_time')).toBeNull()
    expect(readQuestionEssay('broken_no_env')).toBeNull()
    expect(readQuestionEssay('broken_no_env_name')).toBeNull()
    expect(readQuestionEssay('broken_empty_content')).toBeNull()
    expect(readQuestionEssay('broken_types')).toBeNull()
    expect(readQuestionEssay('broken_non_object')).toBeNull()
  })

  it('beyond the 100-question cap the oldest entry is evicted', () => {
    for (let i = 0; i < ESSAYS_MAX_QUESTIONS; i += 1) {
      seedEntry(`q-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
    }
    expect(Object.keys(readRaw()!.entries)).toHaveLength(ESSAYS_MAX_QUESTIONS)

    const ok = saveQuestionEssay('q-new', ESSAY_A)

    expect(ok).toBe(true)
    const entries = readRaw()!.entries
    expect(Object.keys(entries)).toHaveLength(ESSAYS_MAX_QUESTIONS)
    expect(entries['q-new']).toBeDefined()
    // 最旧（时间戳最小）的 q-0 被淘汰
    expect(entries['q-0']).toBeUndefined()
    // 其余完好：q-1 与最后一题都在
    expect(entries['q-1']).toBeDefined()
    expect(entries[`q-${ESSAYS_MAX_QUESTIONS - 1}`]).toBeDefined()
  })

  it('quota error evicts the 10 oldest entries and retries once', () => {
    for (let i = 0; i < 15; i += 1) {
      seedEntry(`q-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString())
    }
    // jsdom 下 spyOn(localStorage, 'setItem') 不拦截（question-generations
    // 先例实验证实），整体替换 window.localStorage 描述符：第一次 setItem
    // 抛 QuotaExceededError，之后透传真实存储。
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
    Object.defineProperty(window, 'localStorage', {
      value: fake,
      configurable: true,
    })
    try {
      const ok = saveQuestionEssay('q-new', ESSAY_A)

      expect(ok).toBe(true)
      expect(calls).toBe(2) // 失败一次 → 淘汰后重试一次
      const entries = readRaw()!.entries
      // 15 - 10（最旧淘汰）+ 1（新写入）= 6
      expect(Object.keys(entries)).toHaveLength(6)
      expect(entries['q-new']).toBeDefined()
      for (let i = 0; i < 10; i += 1) {
        expect(entries[`q-${i}`]).toBeUndefined()
      }
      expect(entries['q-10']).toBeDefined()
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: real,
        configurable: true,
      })
    }
  })

  it('a persistent quota error gives up silently (no throw, returns false)', () => {
    seedEntry('q-0', new Date(Date.UTC(2026, 0, 1)).toISOString())
    const real = window.localStorage
    const quotaError = new Error('quota exceeded')
    quotaError.name = 'QuotaExceededError'
    const fake = {
      getItem: () => real.getItem(ESSAYS_STORAGE_KEY),
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
    Object.defineProperty(window, 'localStorage', {
      value: fake,
      configurable: true,
    })
    try {
      expect(() => saveQuestionEssay('q-new', ESSAY_A)).not.toThrow()
      // 返回 false = 未落盘（UI 会话内存仍可见结果，调用方不依赖返回值强一致）
      expect(saveQuestionEssay('q-new', ESSAY_B)).toBe(false)
      expect(readQuestionEssay('q-new')).toBeNull()
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: real,
        configurable: true,
      })
    }
  })
})

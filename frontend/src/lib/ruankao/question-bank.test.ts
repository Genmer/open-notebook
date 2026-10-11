import { beforeEach, describe, expect, it } from 'vitest'
import { compareQuestionsDesc } from '@/components/ruankao/QuestionBankPanel'
import {
  QUESTIONS_STORAGE_KEY,
  QUESTIONS_STORAGE_KEY_V1,
  V1_MIGRATION_ORIGIN_NOTE,
  loadQuestions,
  saveQuestions,
  type RuankaoQuestion,
} from './question-bank'
import { SEED_QUESTIONS, SEED_VERSION } from './question-bank-seeds.gen'

// 生成物门禁（设计稿 2.1）：量级落 [100,150]、origin 权威链形状、id 稳定前缀
// 与唯一性；真题/模拟样本条目钉扎（重跑种子时这几条断言守护提取口径）。
describe('question bank seeds', () => {
  it('lands in the [100,150] magnitude gate with both origins present', () => {
    expect(SEED_VERSION).toBeGreaterThanOrEqual(1)
    expect(SEED_QUESTIONS.length).toBeGreaterThanOrEqual(100)
    expect(SEED_QUESTIONS.length).toBeLessThanOrEqual(150)
    expect(SEED_QUESTIONS.some((q) => q.origin === 'real')).toBe(true)
    expect(SEED_QUESTIONS.some((q) => q.origin === 'mock')).toBe(true)
  })

  it('has stable unique seed ids and well-formed refs', () => {
    const ids = SEED_QUESTIONS.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const q of SEED_QUESTIONS) {
      expect(q.id.startsWith('ruankao-question-seed-')).toBe(true)
      expect(q.source).toBe('seed')
      expect(q.practiced).toBe(false)
      expect(Array.isArray(q.sourceRefs)).toBe(true)
      expect(q.sourceRefs.length).toBeGreaterThan(0)
      for (const ref of q.sourceRefs) {
        expect(typeof ref.kind).toBe('string')
        expect(typeof ref.folder).toBe('string')
        expect(ref.sourceId === null || typeof ref.sourceId === 'string').toBe(true)
      }
    }
  })

  it('pins extractor decisions: 微服务 single/mock with a Xisai ref, 2025-下 note real, knowledge files out', () => {
    // 去重钉扎：范文库标题命中真题集合 → 合并为一条 mock，不重复建条
    const weixifuwu = SEED_QUESTIONS.filter((q) => q.title === '论微服务架构及其应用')
    expect(weixifuwu).toHaveLength(1)
    expect(weixifuwu[0].origin).toBe('mock')
    expect(
      weixifuwu[0].sourceRefs.some(
        (r) => r.kind === 'essay_library' && r.folder === '希赛论文范文' && r.sourceId,
      ),
    ).toBe(true)
    // 2025 下半年考生回忆简记：real、年份 marker 原样
    const note = SEED_QUESTIONS.filter((q) => q.title === '软件测试')
    expect(note).toHaveLength(1)
    expect(note[0].origin).toBe('real')
    expect(note[0].year).toBe('2025 下')
    // 块名单：知识文章不入库（设计稿 2.4 规则 5）
    expect(
      SEED_QUESTIONS.some((q) => q.title.includes('论文常用知识')),
    ).toBe(false)
    expect(SEED_QUESTIONS.some((q) => q.title.includes('论文组件'))).toBe(false)
  })

  it('allows empty prompts by design (v2: title-only entries) and pins the seed domain closed set', () => {
    // v2 口径（ADR-020）：三问允许为空——标题-only 条目是设计形态，UI 有
    // detailNoPromptText 空问引导；生成时点 103 条中 53 条至少一问为空
    // （52 标题-only + 1 仅 q1），这是对源的如实引用而非缺数据。门禁钉住
    // 的是「题目标题恒在」（空问条目按标题开练的下限），不钉空问计数
    // （补齐逐字原文属合法重跑，不允许为凑非空而编造）。
    for (const q of SEED_QUESTIONS) {
      expect(
        q.title.length > 0 ||
          [q.q1, q.q2, q.q3].some((p) => p.length > 0),
      ).toBe(true)
    }
    // 生成物域标签闭集（ADR-020）：每条 seed domain 非空且落在闭集内；
    // 提取管线重跑产出第 14 个值时此断言失败，强制人工 review diff。
    // domain 对 user 条目恒为自由文本（面板不校验），闭集只约束生成物。
    const CLOSED_SET: readonly string[] = [
      'AI 与智能应用',
      'Web 与前后端架构',
      '中间件与事务',
      '云原生与运维',
      '可靠性与容错',
      '大数据与实时计算',
      '安全与风控',
      '微服务与分布式',
      '架构风格与设计模式',
      '消息与集成',
      '物联网与嵌入式',
      '综合',
      '缓存与存储',
    ]
    for (const q of SEED_QUESTIONS) {
      expect(q.domain.length).toBeGreaterThan(0)
      expect(CLOSED_SET).toContain(q.domain)
    }
  })
})

// user 条目工厂（v2 形状）
function userQuestion(overrides: Partial<RuankaoQuestion> = {}): RuankaoQuestion {
  return {
    id: 'q-user-1',
    year: '2024 上',
    title: '论负载均衡技术的应用',
    domain: '网络与通信',
    q1: '第一问原文',
    q2: '第二问原文',
    q3: '第三问原文',
    practiced: false,
    origin: 'mock',
    sourceRefs: [],
    source: 'user',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('question-bank v2 storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('merges seed copies (practiced overrides applied) with user entries', () => {
    const seed = SEED_QUESTIONS[0]
    saveQuestions([
      ...SEED_QUESTIONS.map((q) =>
        q.id === seed.id ? { ...q, practiced: true } : q,
      ),
      userQuestion(),
    ])

    const raw = JSON.parse(
      window.localStorage.getItem(QUESTIONS_STORAGE_KEY) ?? '{}',
    )
    expect(raw.version).toBe(2)
    // v2 只存 user 条目 + 覆写表；种子本体不落盘
    expect(raw.questions).toHaveLength(1)
    expect(raw.questions[0].source).toBe('user')
    expect(raw.practicedOverrides[seed.id]).toBe(true)

    const loaded = loadQuestions()
    expect(loaded).toHaveLength(SEED_QUESTIONS.length + 1)
    const mergedSeed = loaded.find((q) => q.id === seed.id)
    expect(mergedSeed?.practiced).toBe(true)
    expect(loaded.find((q) => q.id === 'q-user-1')).toBeTruthy()
  })

  it('overrides ride on seed ids: user flip survives a fresh load without mutating the constant', () => {
    const seed = SEED_QUESTIONS[1]
    expect(SEED_QUESTIONS.find((q) => q.id === seed.id)?.practiced).toBe(false)
    saveQuestions([
      ...SEED_QUESTIONS.map((q) =>
        q.id === seed.id ? { ...q, practiced: true } : q,
      ),
    ])
    const loaded = loadQuestions()
    expect(loaded.find((q) => q.id === seed.id)?.practiced).toBe(true)
    // 常量本体不可变
    expect(SEED_QUESTIONS.find((q) => q.id === seed.id)?.practiced).toBe(false)
  })

  it('migrates v1 user entries to v2 with an honest mock origin and keeps the v1 key', () => {
    const v1 = {
      version: 1,
      questions: [
        {
          id: 'q-v1-1',
          year: '2023 下',
          title: '论消息队列的应用',
          domain: '消息与集成',
          q1: '一',
          q2: '二',
          q3: '三',
          practiced: true,
          source: 'user',
          createdAt: '2026-10-09T00:00:00.000Z',
          updatedAt: '2026-10-09T00:00:00.000Z',
        },
      ],
    }
    window.localStorage.setItem(QUESTIONS_STORAGE_KEY_V1, JSON.stringify(v1))

    const loaded = loadQuestions()
    const migrated = loaded.find((q) => q.id === 'q-v1-1')
    expect(migrated).toMatchObject({
      title: '论消息队列的应用',
      origin: 'mock',
      originNote: V1_MIGRATION_ORIGIN_NOTE,
      sourceRefs: [],
      practiced: true,
      source: 'user',
    })
    // 回滚无损：v1 key 不删除
    expect(window.localStorage.getItem(QUESTIONS_STORAGE_KEY_V1)).not.toBeNull()

    // 再保存一次：v2 键出现且含迁移条目（migration 稳定，不重复注记）
    saveQuestions(loaded)
    expect(window.localStorage.getItem(QUESTIONS_STORAGE_KEY)).not.toBeNull()
    const reloaded = loadQuestions()
    expect(reloaded.filter((q) => q.id === 'q-v1-1')).toHaveLength(1)
  })

  it('drops malformed entries, bad override shapes and whole-parse failures without dying', () => {
    // v2 坏条目 + 坏覆写：好条目存活，坏字段被净化
    window.localStorage.setItem(
      QUESTIONS_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        questions: [
          userQuestion({ id: 'q-good' }),
          { id: 'q-no-title', source: 'user' },
          userQuestion({ id: 'q-bad-practiced', practiced: 'yes' as never }),
          null,
        ],
        practicedOverrides: { 'seed-x': true, 'seed-y': 'nope', '': false },
      }),
    )
    let loaded = loadQuestions()
    expect(loaded.some((q) => q.id === 'q-good')).toBe(true)
    expect(loaded.some((q) => q.id === 'q-no-title')).toBe(false)
    expect(loaded.some((q) => q.id === 'q-bad-practiced')).toBe(false)

    // v2 整体损坏 → 回退读 v1
    window.localStorage.setItem(QUESTIONS_STORAGE_KEY, '{not json')
    window.localStorage.setItem(
      QUESTIONS_STORAGE_KEY_V1,
      JSON.stringify({
        version: 1,
        questions: [
          {
            id: 'q-v1-rescue',
            year: '',
            title: '论回退读取',
            domain: '',
            q1: '一',
            q2: '二',
            q3: '三',
            practiced: false,
            source: 'user',
            createdAt: '2026-10-09T00:00:00.000Z',
            updatedAt: '2026-10-09T00:00:00.000Z',
          },
        ],
      }),
    )
    loaded = loadQuestions()
    expect(loaded.some((q) => q.id === 'q-v1-rescue')).toBe(true)

    // 两者全坏 → 仅种子
    window.localStorage.setItem(QUESTIONS_STORAGE_KEY_V1, 'also not json')
    expect(loadQuestions()).toHaveLength(SEED_QUESTIONS.length)
  })

  it('never persists seed entries or preset-source v1 rows', () => {
    const v1 = {
      version: 1,
      questions: [
        userQuestion({ id: 'q-keep' }),
        userQuestion({ id: 'q-preset', source: 'preset' as never }),
      ],
    }
    window.localStorage.setItem(QUESTIONS_STORAGE_KEY_V1, JSON.stringify(v1))
    const loaded = loadQuestions()
    expect(loaded.some((q) => q.id === 'q-keep')).toBe(true)
    expect(loaded.some((q) => q.id === 'q-preset')).toBe(false)

    saveQuestions(loaded)
    const stored = JSON.parse(
      window.localStorage.getItem(QUESTIONS_STORAGE_KEY) ?? '{}',
    )
    expect(stored.questions.every((q: RuankaoQuestion) => q.source === 'user')).toBe(true)
  })
})

describe('panel sort contract (user first, year desc, real first, no-year last)', () => {
  const base = {
    domain: '',
    q1: '',
    q2: '',
    q3: '',
    practiced: false,
    sourceRefs: [],
    createdAt: '2026-10-10T00:00:00.000Z',
  }
  const q = (over: Partial<RuankaoQuestion>): RuankaoQuestion =>
    ({
      id: 'x',
      year: '',
      title: 't',
      origin: 'mock',
      source: 'seed',
      updatedAt: '2026-10-10T00:00:00.000Z',
      ...base,
      ...over,
    }) as RuankaoQuestion

  it('puts user entries ahead of seeds', () => {
    const user = q({ id: 'u', source: 'user', year: '2017' })
    const seed = q({ id: 's', year: '2025 下' })
    expect(compareQuestionsDesc(user, seed)).toBeLessThan(0)
    expect(compareQuestionsDesc(seed, user)).toBeGreaterThan(0)
  })

  it('sorts years descending and sends yearless entries to the tail', () => {
    const y2024 = q({ id: 'a', year: '2024' })
    const y2023 = q({ id: 'b', year: '2023 下' })
    const noYear = q({ id: 'c', year: '' })
    expect(compareQuestionsDesc(y2024, y2023)).toBeLessThan(0)
    expect(compareQuestionsDesc(y2023, noYear)).toBeLessThan(0)
    expect(compareQuestionsDesc(noYear, y2024)).toBeGreaterThan(0)
    // 两个无年份条目：落到 origin/updated 兜底（不抛错、全序一致）
    expect(compareQuestionsDesc(noYear, q({ id: 'd', year: '' }))).toBeLessThanOrEqual(0)
  })

  it('breaks same-year ties with real before mock, then updatedAt desc', () => {
    const real = q({ id: 'r', year: '2024', origin: 'real' })
    const mock = q({ id: 'm', year: '2024', origin: 'mock' })
    expect(compareQuestionsDesc(real, mock)).toBeLessThan(0)
    expect(compareQuestionsDesc(mock, real)).toBeGreaterThan(0)

    const newer = q({ id: 'n', year: '2024', updatedAt: '2026-10-11T00:00:00.000Z' })
    const older = q({ id: 'o', year: '2024', updatedAt: '2026-10-01T00:00:00.000Z' })
    expect(compareQuestionsDesc(newer, older)).toBeLessThan(0)
  })
})

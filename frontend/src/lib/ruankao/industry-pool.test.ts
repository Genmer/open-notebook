import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import {
  filterIndustryPool,
  INDUSTRY_HINT_MAX_CHARS,
  INDUSTRY_MAX_CHARS,
  INDUSTRY_POOL,
  INDUSTRY_PROFILES,
  industryTitleLines,
} from './industry-pool'

// 设计稿定稿数：docs/7-DEVELOPMENT/plans/industry-pool-upgrade-design.md ②（12+10+5+5+7+8+6+2+4+4+6+3+5）
const DESIGN_POOL_SIZE = 77

const codePoints = (s: string): number => [...s].length

describe('INDUSTRY_POOL 数据完整性', () => {
  it('条数与设计稿定稿一致（77 条）', () => {
    expect(INDUSTRY_POOL.length).toBe(DESIGN_POOL_SIZE)
  })

  it('name 全部非空且 ≤ INDUSTRY_MAX_CHARS', () => {
    for (const { name } of INDUSTRY_POOL) {
      expect(name.trim().length, `空 name：${JSON.stringify(name)}`).toBeGreaterThan(0)
      expect(
        codePoints(name.trim()),
        `name 超长：${name}（${codePoints(name)} 字）`,
      ).toBeLessThanOrEqual(INDUSTRY_MAX_CHARS)
    }
  })

  it('name 全池唯一（它是落库值与后端查表键）', () => {
    const names = new Set(INDUSTRY_POOL.map((item) => item.name))
    expect(names.size).toBe(INDUSTRY_POOL.length)
  })

  it('hint 全部非空且 ≤ INDUSTRY_HINT_MAX_CHARS', () => {
    for (const { name, hint } of INDUSTRY_POOL) {
      expect(hint.trim().length, `${name} 的 hint 为空`).toBeGreaterThan(0)
      expect(
        codePoints(hint),
        `${name} 的 hint 超长（${codePoints(hint)} 字）`,
      ).toBeLessThanOrEqual(INDUSTRY_HINT_MAX_CHARS)
    }
  })
})

describe('filterIndustryPool', () => {
  it('空查询返回全池', () => {
    expect(filterIndustryPool('')).toBe(INDUSTRY_POOL)
    expect(filterIndustryPool('   ')).toBe(INDUSTRY_POOL)
  })

  it("搜「银行」恰返回 4 条银行条目（首条=银行核心系统改造，顺序契约）", () => {
    const hits = filterIndustryPool('银行')
    expect(hits.map((item) => item.name)).toEqual([
      '银行核心系统改造',
      '银行反诈止付（金融风控）',
      '银行统一收单平台',
      '银行统一用户体系',
    ])
  })

  it('只按 name 过滤：命中 hint 但不命中任何 name 的词返回 0 条', () => {
    // 「清分」出现在多条 hint（银行统一收单平台、高速公路收费与稽核），不在任何 name 中
    expect(filterIndustryPool('清分')).toEqual([])
  })
})

// 行业画像：有语料覆盖行业的离线提炼定稿（I 线本批 68 篇范文 → 40 行业；
// 设计稿预期 25~32 个行业，实际提炼归联后 40 个池内行业有覆盖）。
const DESIGN_PROFILE_SIZE = 40

describe('INDUSTRY_PROFILES 数据完整性', () => {
  it('行业数与本批提炼定稿一致（40 个）', () => {
    expect(Object.keys(INDUSTRY_PROFILES).length).toBe(DESIGN_PROFILE_SIZE)
  })

  it('profile 键 ⊆ 池 names（键=落库值，逐字同源）', () => {
    const names = new Set(INDUSTRY_POOL.map((item) => item.name))
    for (const key of Object.keys(INDUSTRY_PROFILES)) {
      expect(names.has(key), `池外 profile 键：${key}`).toBe(true)
    }
  })

  it('形状：projectForms 1~4 / techStack 3~6 / businessFlows 3~5（下限 1：单篇覆盖行业只有 1 个真实项目形态，宁可空缺不编造）', () => {
    const shape: Array<[keyof (typeof INDUSTRY_PROFILES)[string], number, number]> = [
      ['projectForms', 1, 4],
      ['techStack', 3, 6],
      ['businessFlows', 3, 5],
    ]
    for (const [name, profile] of Object.entries(INDUSTRY_PROFILES)) {
      for (const [field, low, high] of shape) {
        expect(
          profile[field].length,
          `${name}.${field} 条数 ${profile[field].length} 出界 [${low},${high}]`,
        ).toBeGreaterThanOrEqual(low)
        expect(profile[field].length, `${name}.${field} 条数超上限`).toBeLessThanOrEqual(high)
      }
    }
  })

  it('单条 1~25 code points 且非空白（行业级事实模式，范文句子禁入）', () => {
    for (const [name, profile] of Object.entries(INDUSTRY_PROFILES)) {
      const items = [...profile.projectForms, ...profile.techStack, ...profile.businessFlows]
      for (const item of items) {
        expect(item.trim().length, `${name} 有空白条目`).toBeGreaterThan(0)
        expect(
          codePoints(item),
          `${name} 条目超长（${codePoints(item)} 字）：${item}`,
        ).toBeLessThanOrEqual(25)
      }
    }
  })

  it('条目内无效果数据数字（技术 token 如 K8s/DB2 放行，数字不得与中文字直连）', () => {
    for (const [name, profile] of Object.entries(INDUSTRY_PROFILES)) {
      const items = [...profile.projectForms, ...profile.techStack, ...profile.businessFlows]
      for (const item of items) {
        const chars = [...item]
        chars.forEach((ch, i) => {
          if (!/\d/.test(ch)) return
          const prev = chars[i - 1] ?? ''
          const next = chars[i + 1] ?? ''
          const isCjk = (c: string) => /[\u4e00-\u9fff]/.test(c)
          expect(
            isCjk(prev) || isCjk(next),
            `${name} 条目「${item}」数字与中文直连（疑似效果数据）`,
          ).toBe(false)
        })
      }
    }
  })
})

// hover 多行解释（industryTitleLines）：t() 用键映射 stub（非回显），
// 断言能区分 4 个键的插值产物
const tStub = ((key: string, params?: { hint?: string; items?: string }) => {
  if (key === 'ruankao.industry.hintLine') return `H:${params?.hint ?? ''}`
  if (key === 'ruankao.industry.profileFormsLine') return `F:${params?.items ?? ''}`
  if (key === 'ruankao.industry.profileTechLine') return `T:${params?.items ?? ''}`
  if (key === 'ruankao.industry.profileFlowsLine') return `B:${params?.items ?? ''}`
  return key
}) as unknown as TFunction

describe('industryTitleLines', () => {
  it('有画像行业返回 5 行：名/业务特征/形态/技术栈/流程（items=；join）', () => {
    const entry = INDUSTRY_POOL.find((item) => item.name === '银行核心系统改造')
    const profile = INDUSTRY_PROFILES['银行核心系统改造']
    expect(entry).toBeDefined()
    expect(profile).toBeDefined()
    expect(industryTitleLines(entry!, tStub)).toEqual([
      '银行核心系统改造',
      `H:${entry!.hint}`,
      `F:${profile!.projectForms.join('；')}`,
      `T:${profile!.techStack.join('；')}`,
      `B:${profile!.businessFlows.join('；')}`,
    ])
  })

  it('无画像行业只有 2 行（行集与无画像功能上线前逐字节一致）', () => {
    const entry = INDUSTRY_POOL.find(
      (item) => item.name === '智慧城管' && INDUSTRY_PROFILES[item.name] === undefined,
    )
    expect(entry).toBeDefined()
    expect(industryTitleLines(entry!, tStub)).toEqual(['智慧城管', `H:${entry!.hint}`])
  })
})

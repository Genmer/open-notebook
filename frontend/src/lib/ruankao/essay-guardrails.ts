// 软考论文字数护栏（批次4 写作台）：纯前端确定性口径，零 AI。
import type { RuankaoEssaySections } from './essay-drafts'
// 口径出处：阅卷人视角的教练模板（agent-templates.ts 的 ruankao-essay-coach）
// —— 摘要 ≤300 含标点；正文 2000-2500 健康、2500 硬上限（考场按 2500 截断）；
// 问题2 下限 400（「字数就是作答态度」）；论点区目标两段共 ~1000，下限 900；
// 结尾目标 ~400，下限 300。

// 中文含标点口径：按 Unicode 码点计数（代理对算一个字，emoji 不多计）
export function countChars(text: string): number {
  return [...text].length
}

export type SectionGuard = 'ok' | 'warn' | 'over'

// 摘要 >300 即超（考场硬口径，含标点）
export function guardAbstract(n: number): SectionGuard {
  return n > 300 ? 'over' : 'ok'
}

// 正文（背景+问题2+论点区+结尾合计）：2000-2500 健康，2500 起=红锁（硬上限，
// 考场按 2500 截断——恰好 2500 是「已达」预警不是安全），<2000 偏薄
export function guardBody(total: number): SectionGuard {
  if (total >= 2500) return 'over'
  if (total < 2000) return 'warn'
  return 'ok'
}

// 问题2 技术方法说明 ~500，下限 400
export function guardQ2(n: number): SectionGuard {
  return n < 400 ? 'warn' : 'ok'
}

// 论点区两段各 ~500 共 ~1000，下限 900
export function guardArguments(n: number): SectionGuard {
  return n < 900 ? 'warn' : 'ok'
}

// 结尾 ~400，下限 300
export function guardClosing(n: number): SectionGuard {
  return n < 300 ? 'warn' : 'ok'
}

// ── 论文容量基准表（写作台仪表单一数字源）────────────────────────────
// 四态机（under/ok/near/over）只服务容量条呈现；上方旧三态守卫保持原样——
// 憋字训练器只 import 并使用 guardArguments/guardQ2，行为逐字节不变。

export type EssaySectionKey = keyof RuankaoEssaySections

export interface SectionBaseline {
  key: EssaySectionKey
  floor: number // F 下限：低于即未达（under）
  target: number // T 目标：泳道宽 = T/2700、填充占比分母
  ceiling: number // C 近超：超过进入偏多带（near）
  hard: number // H 红线：超过即超限（over）
  labelKey: string // 旧版带口径的长标签（段卡 title 提示沿用，键不退役）
  nameKey: string // 纯段名键（段卡标题/图例/完整度 chips）
  colorClass: string // 段色（ADR-011 token，仅泳道填充与图例色点）
}

// 摘要 300 即硬口径（C=H=300，near 带为空）；四段 H=C+100 统一失衡带；
// 摘要+四段目标之和 = 2700 = 容量条轨道容量（摘要也是五分之一篇）。
export const SECTION_BASELINES: readonly SectionBaseline[] = [
  {
    key: 'abstract',
    floor: 200,
    target: 300,
    ceiling: 300,
    hard: 300,
    labelKey: 'ruankao.essay.write.sectionAbstract',
    nameKey: 'ruankao.essay.write.sectionAbstractName',
    colorClass: 'bg-teal',
  },
  {
    key: 'background',
    floor: 400,
    target: 500,
    ceiling: 600,
    hard: 700,
    labelKey: 'ruankao.essay.write.sectionBackground',
    nameKey: 'ruankao.essay.write.sectionBackgroundName',
    colorClass: 'bg-slate-hue',
  },
  {
    key: 'question2',
    floor: 400,
    target: 500,
    ceiling: 600,
    hard: 700,
    labelKey: 'ruankao.essay.write.sectionQ2',
    nameKey: 'ruankao.essay.write.sectionQ2Name',
    colorClass: 'bg-plum',
  },
  {
    key: 'arguments',
    floor: 900,
    target: 1000,
    ceiling: 1100,
    hard: 1200,
    labelKey: 'ruankao.essay.write.sectionArguments',
    nameKey: 'ruankao.essay.write.sectionArgumentsName',
    colorClass: 'bg-fern',
  },
  {
    key: 'closing',
    floor: 300,
    target: 400,
    ceiling: 500,
    hard: 600,
    labelKey: 'ruankao.essay.write.sectionClosing',
    nameKey: 'ruankao.essay.write.sectionClosingName',
    colorClass: 'bg-sage',
  },
]

// 容量条轨道容量 = 五段目标之和（含摘要泳道）
export const SECTION_TARGET_TOTAL = SECTION_BASELINES.reduce(
  (sum, b) => sum + b.target,
  0
) // 2700

// 正文黄线/红锁（与旧 guardBody 同源口径：四段目标之和 2400 触黄、2500 红锁）
export const BODY_OK_MIN = 2000
export const BODY_NEAR_MIN = 2400
export const BODY_HARD_CAP = 2500

export type SectionState = 'under' | 'ok' | 'near' | 'over'
export type BodyState = 'thin' | 'ok' | 'near' | 'over'

// 段四态：n<F 未达 / F≤n≤C 达标 / C<n≤H 偏多 / n>H 超限
export function sectionState(key: EssaySectionKey, n: number): SectionState {
  const b = SECTION_BASELINES.find((row) => row.key === key)
  if (!b) return 'ok'
  if (n < b.floor) return 'under'
  if (n > b.hard) return 'over'
  if (n > b.ceiling) return 'near'
  return 'ok'
}

// 正文四态：<2000 偏薄 / 2000-2399 健康 / 2400-2499 接近红锁 / ≥2500 红锁
export function bodyState(total: number): BodyState {
  if (total >= BODY_HARD_CAP) return 'over'
  if (total >= BODY_NEAR_MIN) return 'near'
  if (total >= BODY_OK_MIN) return 'ok'
  return 'thin'
}

// 泳道填充占比：min(100, n/target*100)
export function capacityPercent(n: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(100, (n / target) * 100)
}

export interface CompletenessIssue {
  key: EssaySectionKey
  state: Exclude<SectionState, 'ok'> // issues 只装非达标态
}

// 交卷完整度：达标 = 段四态为 ok（under/near/over 都算未达标并出 chip）。
// 全空诚实显示 0/5；仅提示不阻断发送。
export function essayCompleteness(sections: RuankaoEssaySections): {
  met: number
  total: number
  issues: CompletenessIssue[]
} {
  const issues: CompletenessIssue[] = []
  for (const b of SECTION_BASELINES) {
    const state = sectionState(b.key, countChars(sections[b.key]))
    if (state !== 'ok') issues.push({ key: b.key, state })
  }
  return {
    met: SECTION_BASELINES.length - issues.length,
    total: SECTION_BASELINES.length,
    issues,
  }
}

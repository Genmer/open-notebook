// AI 模拟向导种子通道（Q 线动作 D②）：sessionStorage 一次性种子 + 切 tab。
// 题库详情「生成整篇练习文」在无对应文章可读时，带题目关键词跳项目环境 tab，
// 向导自动打开且 mock 表单预填——与 coach-handoff 同款「一次性种子」模式，
// 消费即焚，父面板（EnvironmentsPanel）关闭向导时不再残留。
// 注入语境论证：种子只含题目关键词（考试元数据，考生自持事实数据），
// 不含范文正文任何片段——生成链路无范文可达路径（ADR-017 不受影响）。

export const RUANKAO_WIZARD_SEED_KEY = 'ruankao.wizardSeed.v1'

/** 预填载荷：字段全部可选（存在才落值，向导受控输入不被 undefined 打断） */
export interface RuankaoWizardSeed {
  industry?: string
  keywords?: string[]
  name?: string
}

/** Write the one-shot wizard seed. Returns false when sessionStorage is
 * unavailable (private mode) — the consumer will never fire, the wizard
 * simply opens without prefill. */
export function writeWizardSeed(seed: RuankaoWizardSeed): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.sessionStorage.setItem(RUANKAO_WIZARD_SEED_KEY, JSON.stringify(seed))
    return true
  } catch {
    return false
  }
}

/** Read-and-remove the seed (one-shot, 即焚). Tolerant parse: a broken seed is
 * dropped, never left to re-fire on a later mount. Returns null when nothing
 * is pending or the payload shape is invalid. */
export function consumeWizardSeed(): RuankaoWizardSeed | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(RUANKAO_WIZARD_SEED_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  tryConsumeRemove()
  let parsed: Partial<RuankaoWizardSeed>
  try {
    parsed = JSON.parse(raw) as Partial<RuankaoWizardSeed>
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== 'object') return null
  const seed: RuankaoWizardSeed = {}
  if (typeof parsed.industry === 'string' && parsed.industry.trim()) {
    seed.industry = parsed.industry
  }
  if (
    Array.isArray(parsed.keywords) &&
    parsed.keywords.length > 0 &&
    parsed.keywords.every((k) => typeof k === 'string')
  ) {
    seed.keywords = parsed.keywords
  }
  if (typeof parsed.name === 'string' && parsed.name.trim()) {
    seed.name = parsed.name
  }
  // 全空载荷等价于无种子（向导不带任何预填打开没有意义）
  return seed.industry || seed.keywords || seed.name ? seed : null
}

function tryConsumeRemove(): void {
  try {
    window.sessionStorage.removeItem(RUANKAO_WIZARD_SEED_KEY)
  } catch {
    // remove 失败不致命：下次消费仍按即焚语义重写
  }
}

/** Derive the wizard seed from a bank question: the title (「论」 prefix
 * stripped) names the mock project, and the tech domain joins as the second
 * keyword when it is a concrete one. Pure + deterministic, unit-testable. */
export function wizardSeedFromQuestion(q: {
  title: string
  domain: string
}): RuankaoWizardSeed {
  const topic = q.title.replace(/^论/, '').trim()
  const keywords = [topic || q.title.trim()]
  const domain = q.domain.trim()
  if (domain && domain !== '综合') keywords.push(domain)
  return { name: q.title.trim(), keywords }
}

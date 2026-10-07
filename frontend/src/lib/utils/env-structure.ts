// 项目环境六字段密集中文散文 → 结构化视图数据（指标卡/技术栈卡/流程图/配对卡/角色头衔）。
// 全部纯函数：对任意输入（空串/超长/英文/乱码/千分位/换行）安全返回空结果，绝不抛错；
// 调用方以条数门槛决定回退纯文本。正则使用 lookbehind，需现代浏览器内核（Safari≥16.4）。

const SCAN_LIMIT = 2000
const YEAR_RE = /^(19|20)\d{2}$/
const SEPS = '，。；：、（）'
const stripComma = (s: string) => s.replace(/,/g, '')

export interface StatItem {
  /** 静态卡：数值文本（千分位已剥逗号，含万/亿前缀）；趋势卡：终点值含单位 */
  value: string
  /** 静态卡单位字符（人/条/%…）；趋势卡恒 ''（from/to 自带单位） */
  unit: string
  /** 数字所在短句的上下文窗口（前≤10 字 + 后≤6 字，已剥前缀动词） */
  label: string
  /** 趋势卡起点值含单位（如 '78%' / '360万元'）；存在即为趋势卡 */
  trendFrom?: string
  /** 趋势方向，只决定 Trending 图标形状，不编码好坏 */
  direction?: 'up' | 'down'
}

export type TechKind = 'solver' | 'model' | 'database' | 'framework' | 'cache' | 'map' | 'other'

export interface TechItem {
  /** 原文名（按首次出现排序）；英文整句残留时为通过词过滤的末词 */
  name: string
  /** '9.11' / '3' / null（无版本段，卡片显示 '—'） */
  version: string | null
  kind: TechKind
}

export interface TrendChip {
  /** 指标 token 如 'P99'；同句改善对无 token 时为 '' */
  label: string
  from: string
  to: string
  direction: 'up' | 'down'
}

export interface FlowStep {
  /** lead=语境引入 / action=编号步骤 / outcome=成果收口 */
  kind: 'lead' | 'action' | 'outcome'
  /** lead/action：派生短标题 ≤20 字（超出截断的尾巴并入 body，零丢字）；outcome 恒 '' */
  title: string
  body: string
  /** 仅 outcome：改善型成果 chips，≤3 */
  metrics?: TrendChip[]
}

export interface ProblemPair {
  /** 问题句；段内分离双失败或非空短段时为整段文本（渲染中性单卡，零丢失） */
  problem: string
  /** 解决文本；null → 只渲染问题侧 */
  solution: string | null
}

export interface ProblemPairBlock {
  /** 首个枚举标记前的总起句，可为 '' */
  intro: string
  pairs: ProblemPair[]
}

// ---------- 指标（只扫 scale + background） ----------

const UNIT = '(%|秒|小时|分钟|人|条|家|元|个|张|次|台|辆|单|字|页|核|卡)'
// 千分位分组允许（产出 value 时剥逗号）；(?<!\d,) 杀「12,00人」这类畸形组尾巴
const NUMPAT = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{1,7}(?:\\.\\d{1,3})?)'
const STATIC_RE = new RegExp(
  '(?<![A-Za-z0-9.])(?<!\\d,)(约|超过|高达|仅为|共|达|近|平均|逾)?\\s*' +
    NUMPAT +
    '(万|亿)?\\s*' +
    UNIT,
  'g'
)
const UP = '(提升到|提升至|提高到|提高至|升至|升到|增长到|增长至)'
const DOWN = '(降至|下降到|下降至|降到|压缩到|压缩至)'
// TUNIT 吃复合单位（万元/亿元/万条…）；(?!\d*年) 必须带 \d* 前缀，单 (?!年) 会被贪婪回溯绕过
const TUNIT = '((?:万|亿)?(?:元|%|秒|小时|分钟|人|条|家|个|次)?)'
const TNUM = '(\\d{1,3}(?:,\\d{3})+|\\d{1,7}(?:\\.\\d{1,3})?)(?!\\d*年)'
const TREND_RE = new RegExp(
  '(?<![A-Za-z0-9.])(?:由|从)?\\s*约?\\s*' +
    TNUM +
    '\\s*' +
    TUNIT +
    '\\s*(?:' +
    UP +
    '|' +
    DOWN +
    ')\\s*约?\\s*' +
    TNUM +
    '\\s*' +
    TUNIT,
  'g'
)

function labelOf(text: string, start: number, end: number): string {
  let pre = ''
  for (let i = start - 1; i >= 0 && i >= start - 24; i--) {
    if (SEPS.includes(text[i])) break
    pre = text[i] + pre
  }
  pre = pre.replace(/(约|超过|高达|仅为|共|达|近|平均|逾|由|从)+$/, '')
  if (pre.length > 10) pre = pre.slice(-10)
  let post = ''
  for (let i = end; i < text.length && i < end + 24; i++) {
    if (SEPS.includes(text[i])) break
    post += text[i]
  }
  if (post.length > 6) post = post.slice(0, 6)
  return pre + post
}

// 存量环境禁词兜底（README 第 4 项）：提示词禁写「合同金额/团队规模/团队人数」
// 只约束新生成，改造前生成的存量文本仍可能带禁词。含禁词的子句不再出指标卡。
// 与后端 open_notebook/domain/project_env_cleaner.py 的 FORBIDDEN_PHRASES 同集。
export const FORBIDDEN_STAT_PHRASES = ['合同金额', '团队规模', '团队人数'] as const

// 子句窗口比 labelOf 的前10后6截断宽：禁词落在 label 窗口外时仍要整卡丢弃
const CLAUSE_SEPS = SEPS + '\n,;:'

function clauseAround(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && !CLAUSE_SEPS.includes(text[from - 1])) from--
  let to = end
  while (to < text.length && !CLAUSE_SEPS.includes(text[to])) to++
  return text.slice(from, to)
}

function clauseForbidden(text: string, start: number, end: number): boolean {
  const clause = clauseAround(text, start, end)
  return FORBIDDEN_STAT_PHRASES.some((p) => clause.includes(p))
}

function scanTrends(text: string): { range: [number, number]; item: StatItem }[] {
  const out: { range: [number, number]; item: StatItem }[] = []
  for (const m of text.matchAll(TREND_RE)) {
    const from = m[1] ?? ''
    const to = m[5] ?? ''
    if (YEAR_RE.test(from) && YEAR_RE.test(to)) continue // 裸年份区间非指标
    const start = m.index ?? 0
    const end = start + m[0].length
    // 禁词子句内的趋势命中整体丢弃；同子句的静态命中也按同一规则丢弃
    if (clauseForbidden(text, start, end)) continue
    out.push({
      range: [start, end],
      item: {
        trendFrom: stripComma(from) + (m[2] ?? ''),
        value: stripComma(to) + (m[6] ?? ''),
        unit: '',
        label: labelOf(text, start, end),
        direction: m[3] ? 'up' : 'down',
      },
    })
  }
  return out
}

function scanStatics(text: string, trendRanges: [number, number][]): StatItem[] {
  const out: StatItem[] = []
  for (const m of text.matchAll(STATIC_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    // 与 trend 匹配区间重叠的静态命中跳过，避免同一数字出两张卡
    if (trendRanges.some(([a, b]) => start < b && end > a)) continue
    // 禁词子句内的静态命中整体丢弃（数字本身含禁词语义时连同子句消失）
    if (clauseForbidden(text, start, end)) continue
    out.push({
      value: stripComma(m[2] ?? '') + (m[3] ?? ''),
      unit: m[4] ?? '',
      label: labelOf(text, start, end),
    })
  }
  return out
}

export function extractEnvStats(scale: string, background: string): StatItem[] {
  const s = (scale || '').slice(0, SCAN_LIMIT)
  const b = (background || '').slice(0, SCAN_LIMIT)
  const picked: StatItem[] = []
  const seenT = new Set<string>()
  const seenV = new Set<string>()
  const trendRanges: Record<'s' | 'b', [number, number][]> = { s: [], b: [] }
  for (const [src, key] of [
    [s, 's'],
    [b, 'b'],
  ] as const) {
    for (const { range, item } of scanTrends(src)) {
      trendRanges[key].push(range)
      if (picked.filter((p) => p.trendFrom).length >= 2) continue
      const k = (item.trendFrom ?? '') + item.value
      if (seenT.has(k)) continue
      seenT.add(k)
      picked.push(item)
    }
  }
  for (const [src, key] of [
    [s, 's'],
    [b, 'b'],
  ] as const) {
    for (const item of scanStatics(src, trendRanges[key])) {
      if (picked.length >= 4) break
      const k = item.value + item.unit
      if (seenV.has(k)) continue
      seenV.add(k)
      picked.push(item)
    }
  }
  return picked
}

// ---------- 技术栈（只扫 tech_background，两轮抽取） ----------

const VER_RE =
  /([A-Za-z][A-Za-z0-9]*(?:[-._][A-Za-z0-9]+)*(?:\s+[A-Za-z][A-Za-z0-9]*(?:[-._][A-Za-z0-9]+)*)*)\s+(v?\d+(?:\.\d+){0,3})(?![A-Za-z0-9.])/g
const NAME_RE =
  /[A-Za-z][A-Za-z0-9]*(?:[-._][A-Za-z0-9]+)*(?:\s+[A-Za-z][A-Za-z0-9]*(?:[-._][A-Za-z0-9]+)*)*/g

// 词过滤：≤4 词且每词含大写字母或 -._（杀英文半句误吞）
const wordsOk = (name: string) => {
  const ws = name.split(/\s+/)
  return ws.length <= 4 && ws.every((w) => /[A-Z._-]/.test(w))
}

const KIND_MATCHERS: ReadonlyArray<readonly [TechKind, RegExp]> = [
  ['cache', /redis|memcached/],
  ['map', /osrm|postgis|arcgis|valhalla|gis/],
  ['solver', /or-tools|gurobi|cplex|optaplanner/],
  ['model', /qwen|llama|bge|mistral|glm|deepseek|bert|gpt|embed/],
  ['database', /postgres|mysql|mongo|milvus|surreal|clickhouse|sqlite|oracle|elasticsearch|faiss/],
  [
    'framework',
    /spring|vllm|fastapi|django|flask|netty|kafka|rabbitmq|rocketmq|kubernetes|k8s|docker|vue|react|next/,
  ],
]

export function extractTechs(techBackground: string): TechItem[] {
  const text = (techBackground || '').slice(0, SCAN_LIMIT)
  const byName = new Map<string, { name: string; version: string | null; index: number }>()
  const yearBlacklist = new Set<string>()
  for (const m of text.matchAll(VER_RE)) {
    let name: string = m[1] ?? ''
    const version = m[2] ?? ''
    // 版本号本身是年份 → 丢弃，且名称入假名黑名单（防「Spring 2024年度」的 Spring）
    if (/^\d{4}$/.test(version) && +version >= 1900 && +version <= 2099) {
      yearBlacklist.add(name.toLowerCase())
      continue
    }
    if (!wordsOk(name)) name = name.split(/\s+/).pop() ?? name // 半句名退化为末词
    if (!wordsOk(name)) continue
    if (yearBlacklist.has(name.toLowerCase())) continue
    const key = name.toLowerCase()
    if (!byName.has(key)) byName.set(key, { name, version, index: m.index ?? 0 })
  }
  for (const m of text.matchAll(NAME_RE)) {
    const name = m[0]
    if (/^[A-Z]+$/.test(name)) continue // 纯大写缩写（VRPTW/RAG/AI）
    const words = name.split(/\s+/)
    if (words.length > 4) continue
    if (words.some((w) => !/[A-Z._-]/.test(w))) continue
    if (name.length > 40) continue
    if (yearBlacklist.has(name.toLowerCase())) continue
    const key = name.toLowerCase()
    if ([...byName.keys()].some((k) => k.includes(key) || key.includes(k))) continue
    if (!byName.has(key)) byName.set(key, { name, version: null, index: m.index ?? 0 })
  }
  return [...byName.values()]
    .sort((a, b) => a.index - b.index)
    .slice(0, 12)
    .map(({ name, version }) => {
      const hit = KIND_MATCHERS.find(([, re]) => re.test(name.toLowerCase()))
      return { name, version, kind: hit ? hit[0] : 'other' }
    })
}

// ---------- 调优流程（枚举路径 A / 针对句路径 B） ----------

// 枚举标记边界集（含换行/半角逗号/空白）与 MAJOR 句边界集不同，勿混用：
// 标记按小停顿切，句子只按大停顿切（逗号并入句集，否则 lead 标题会被切成残句）。
const SEP_MARK = '。；：，,\\n！？!?\\s'
const SEP_MAJOR = '。；：！？!?\\n'
const ENUM_MARK = new RegExp('(?<=^|[' + SEP_MARK + '])\\s*(?:其[一二三四五六][，,]?|[一二三四五]是)', 'g')
const MAJOR_SPLIT = new RegExp('(?<=[' + SEP_MAJOR + '])')
const TAIL_MARK = /^(?:随后|最终|至此|复测|经复测)/

const sentencesOf = (t: string) => t.split(MAJOR_SPLIT).filter((x) => x.trim())

const TITLE_CAP = 20
const capTitle = (s: string) => (s.length > TITLE_CAP ? s.slice(0, TITLE_CAP) + '…' : s)
const TITLE_SPLIT = /[，。；：\n,;:]/

function splitTitle(seg: string): { title: string; body: string } {
  const first = seg.split(TITLE_SPLIT)[0] ?? ''
  const rest = seg.slice(first.length).replace(/^[，。；：\n,;:]/, '')
  return { title: capTitle(first), body: first.slice(TITLE_CAP) + rest }
}

function trendChipsSameSentence(body: string): TrendChip[] {
  const out: TrendChip[] = []
  for (const m of body.matchAll(TREND_RE)) {
    const from = m[1] ?? ''
    const to = m[5] ?? ''
    if (YEAR_RE.test(from) && YEAR_RE.test(to)) continue
    out.push({
      label: '',
      from: stripComma(from) + (m[2] ?? ''),
      to: stripComma(to) + (m[6] ?? ''),
      direction: m[3] ? 'up' : 'down',
    })
  }
  return out
}

// 跨句同指标配对：前文「X 高达 9秒」+ outcome「X 降至 2.1秒」→ 一枚 chip
function crossSentenceChips(priorText: string, outcomeBody: string): TrendChip[] {
  const chips: TrendChip[] = []
  const seenTok = new Set<string>()
  const U = '(\\d{1,7}(?:\\.\\d{1,3})?)(万|亿)?(元|%|秒|小时|分钟|人|条|家|个|次)?'
  for (const tk of outcomeBody.matchAll(/[A-Za-z][A-Za-z0-9+#-]{0,11}/g)) {
    if (seenTok.has(tk[0].toLowerCase())) continue
    seenTok.add(tk[0].toLowerCase())
    const esc = tk[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const before = new RegExp(esc + '[^，。；,\\n]{0,8}(高达|仅为|达到)约?' + U).exec(priorText)
    const after = new RegExp(esc + '[^，。；,\\n]{0,8}(降至|降到|提升到|升至)约?' + U).exec(outcomeBody)
    if (before && after) {
      chips.push({
        label: tk[0],
        from: (before[2] ?? '') + (before[3] ?? '') + (before[4] ?? ''),
        to: (after[2] ?? '') + (after[3] ?? '') + (after[4] ?? ''),
        direction: /降|压缩/.test(after[1] ?? '') ? 'down' : 'up',
      })
    }
    if (chips.length >= 2) break
  }
  return chips
}

function validMarks(text: string): RegExpMatchArray[] {
  return [...text.matchAll(ENUM_MARK)].filter((m) => {
    const after = text[(m.index ?? 0) + m[0].length]
    return after !== undefined && !'，。；：、,\n'.includes(after)
  })
}

export function splitTuningSteps(tuningProcess: string): FlowStep[] {
  const text = (tuningProcess || '').trim()
  if (!text) return []
  const scan = text.slice(0, SCAN_LIMIT)
  const marks = validMarks(scan)
  let head = ''
  const rawActions: Array<string | { title: string; body: string }> = []
  if (marks.length >= 2) {
    head = scan.slice(0, marks[0].index ?? 0)
    for (let i = 0; i < marks.length; i++) {
      const from = (marks[i].index ?? 0) + marks[i][0].length
      const to = i + 1 < marks.length ? (marks[i + 1].index ?? 0) : scan.length
      const seg = scan.slice(from, to).trim()
      if (seg) rawActions.push(seg)
    }
  } else {
    // 路径 B：必须先按 MAJOR 标点切句、再逐句前缀匹配（全文 matchAll 只命中 1 句会恒回退）
    const sents = sentencesOf(scan)
    const hitAt = sents.map((s) => /^针对([^，。]{4,40}?)(?:的)?问题[，,]/.exec(s))
    const idx = hitAt.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 2) return []
    head = sents.slice(0, idx[0]).join('')
    for (let k = 0; k < idx.length; k++) {
      const from = idx[k]
      const to = k + 1 < idx.length ? idx[k + 1] : sents.length
      const m = hitAt[from]
      const body = sents[from].slice(m?.[0].length ?? 0) + sents.slice(from + 1, to).join('')
      rawActions.push({ title: capTitle(m?.[1] ?? ''), body: body.trim() })
    }
  }
  // 收尾剥离只作用于最后一个 action 的 body（句子级），title 不参与
  let outcomeBody = ''
  const lastIdx = rawActions.length - 1
  if (lastIdx >= 0) {
    const last = rawActions[lastIdx]
    const ls = sentencesOf(typeof last === 'string' ? last : last.body)
    const tailStart = ls.findIndex((s) => TAIL_MARK.test(s))
    if (tailStart > 0) {
      outcomeBody = ls.slice(tailStart).join('')
      rawActions[lastIdx] =
        typeof last === 'string'
          ? ls.slice(0, tailStart).join('')
          : { title: last.title, body: ls.slice(0, tailStart).join('') }
    }
  }
  const nodes: FlowStep[] = []
  const hs = sentencesOf(head.trim())
  if (hs.length) {
    nodes.push({
      kind: 'lead',
      title: capTitle(hs[0].replace(/[。；：！？!?\n]$/, '')),
      body: hs.slice(1).join(''),
    })
  }
  const actions = rawActions
    .map((a) => (typeof a === 'string' ? splitTitle(a) : a))
    .map((a) => ({ title: a.title, body: a.body, kind: 'action' as const }))
    .filter((a) => (a.title + a.body).trim().length >= 2)
  if (actions.length < 2) return []
  nodes.push(...actions.slice(0, 6))
  if (outcomeBody.trim()) {
    let chips = trendChipsSameSentence(outcomeBody)
    if (!chips.length) chips = crossSentenceChips(nodes.map((n) => n.body).join(''), outcomeBody)
    if (!chips.length) chips = trendChipsSameSentence(actions[Math.min(actions.length, 6) - 1].body)
    nodes.push({ kind: 'outcome', title: '', body: outcomeBody.trim(), metrics: chips.slice(0, 3) })
  }
  return nodes
}

// ---------- 问题→解决配对 ----------

export function splitProblemPairs(problemsSolutions: string): ProblemPairBlock {
  const text = (problemsSolutions || '').trim()
  if (!text || text.length > SCAN_LIMIT) return { intro: '', pairs: [] }
  const marks = validMarks(text)
  if (marks.length < 2) return { intro: '', pairs: [] }
  const intro = text.slice(0, marks[0].index ?? 0).trim()
  const segs: string[] = []
  for (let i = 0; i < marks.length; i++) {
    const from = (marks[i].index ?? 0) + marks[i][0].length
    const to = i + 1 < marks.length ? (marks[i + 1].index ?? 0) : text.length
    const seg = text.slice(from, to).trim()
    if (seg) segs.push(seg) // 空段跳过；非空短段保留走中性单卡（零丢字）
  }
  if (segs.length < 2 || segs.length > 6) return { intro: '', pairs: [] }
  const pairs = segs.map((seg): ProblemPair => {
    const dot = seg.indexOf('。')
    if (dot > 0) {
      const p = seg.slice(0, dot)
      const s = seg.slice(dot + 1).trim()
      if (p.length >= 6 && s.length >= 6) return { problem: p, solution: s }
    }
    const cw = /(，|,|\n)\s*(我们|我)/.exec(seg)
    if (cw && seg.slice(0, cw.index).length >= 6) {
      return { problem: seg.slice(0, cw.index), solution: seg.slice(cw.index + 1).trim() }
    }
    return { problem: seg, solution: null }
  })
  return { intro, pairs }
}

// ---------- 角色头衔 ----------

const ROLE_KEYWORD_RE = /(负责人|架构师|工程师|经理|总监|组长|主管|分析师|专家|顾问|设计师|开发|测试|运维)/

export function extractRoleTitle(myRole: string): string | null {
  const text = (myRole || '').trim()
  if (!text) return null
  const scan = text.slice(0, 120)
  const clauseEnd = scan.search(/[，,。；;！？\n]/)
  const clause = clauseEnd === -1 ? scan : scan.slice(0, clauseEnd)
  const m = /作为|担任/.exec(clause)
  if (!m) return null
  const headline = clause.slice((m.index ?? 0) + m[0].length).trim() // 触发词之后的余文
  if (headline.length < 2 || headline.length > 24) return null
  if (!ROLE_KEYWORD_RE.test(headline)) return null
  if (/(我|我们|本人)/.test(headline)) return null // 切歪信号
  return headline
}

// 软考常见技术栈静态术语表：extractTechs 抽出的技术名 → glossary 词条 key（40 条）。
// 全部纯函数、零请求零 LLM；解释文案由组件层 t('projectEnvs.glossary.<key>') 读取，
// 词条由 i18n 侧静态落 14 locale，本模块不持有任何文案。
// key 只含小写字母/数字/连字符（不含点，避开 i18next keySeparator '.')；
// 未命中返回 null，调用方回退原 title=技术名 行为不变。

export const TECH_GLOSSARY_KEYS = [
  'redis',
  'memcached',
  'postgresql',
  'mysql',
  'mongodb',
  'clickhouse',
  'elasticsearch',
  'milvus',
  'kafka',
  'rabbitmq',
  'rocketmq',
  'spring-boot',
  'spring-cloud',
  'fastapi',
  'django',
  'flask',
  'vue',
  'react',
  'qwen',
  'llama',
  'deepseek',
  'glm',
  'bert',
  'bge',
  'vllm',
  'or-tools',
  'gurobi',
  'cplex',
  'osrm',
  'postgis',
  'arcgis',
  'kubernetes',
  'k8s',
  'docker',
  'nginx',
  'java',
  'python',
  'go',
  'node',
  'jmeter',
] as const

// 完整 i18n 键字面量表（字母序，40 条）：组件层动态拼 key 读取文案，
// 而 locales/index.test.ts 的 Unused Key Detection 只认源码中的完整点分键字面量，
// 故在此静态列出，与 tasks 页 STATUS_KEYS 的仓库惯例一致。仅用于守护对账，不参与运行时逻辑。
export const GLOSSARY_I18N_KEYS = [
  'projectEnvs.glossary.arcgis',
  'projectEnvs.glossary.bert',
  'projectEnvs.glossary.bge',
  'projectEnvs.glossary.clickhouse',
  'projectEnvs.glossary.cplex',
  'projectEnvs.glossary.deepseek',
  'projectEnvs.glossary.django',
  'projectEnvs.glossary.docker',
  'projectEnvs.glossary.elasticsearch',
  'projectEnvs.glossary.fastapi',
  'projectEnvs.glossary.flask',
  'projectEnvs.glossary.glm',
  'projectEnvs.glossary.go',
  'projectEnvs.glossary.gurobi',
  'projectEnvs.glossary.java',
  'projectEnvs.glossary.jmeter',
  'projectEnvs.glossary.k8s',
  'projectEnvs.glossary.kafka',
  'projectEnvs.glossary.kubernetes',
  'projectEnvs.glossary.llama',
  'projectEnvs.glossary.memcached',
  'projectEnvs.glossary.milvus',
  'projectEnvs.glossary.mongodb',
  'projectEnvs.glossary.mysql',
  'projectEnvs.glossary.nginx',
  'projectEnvs.glossary.node',
  'projectEnvs.glossary.or-tools',
  'projectEnvs.glossary.osrm',
  'projectEnvs.glossary.postgis',
  'projectEnvs.glossary.postgresql',
  'projectEnvs.glossary.python',
  'projectEnvs.glossary.qwen',
  'projectEnvs.glossary.rabbitmq',
  'projectEnvs.glossary.react',
  'projectEnvs.glossary.redis',
  'projectEnvs.glossary.rocketmq',
  'projectEnvs.glossary.spring-boot',
  'projectEnvs.glossary.spring-cloud',
  'projectEnvs.glossary.vllm',
  'projectEnvs.glossary.vue',
] as const

export type TechGlossaryKey = (typeof TECH_GLOSSARY_KEYS)[number]

// 词条 key 形状约束（测试守护）：小写字母/数字 + 连字符分段，无点无大写。
export const GLOSSARY_KEY_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// 名称规范化：trim + 小写 + 非「小写字母/数字」连续段折叠为单个连字符 + 去首尾连字符。
// 'Google OR-Tools' → 'google-or-tools'；'Qwen2.5-14B-Instruct' → 'qwen2-5-14b-instruct'。
export function normalizeTechName(name: string): string {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const KEY_SET: ReadonlySet<string> = new Set(TECH_GLOSSARY_KEYS)

// 最长优先：更长（更具体）的词条必须先于其潜在前缀词条尝试（'spring-cloud' 先于任何更短词）。
const KEYS_LONGEST_FIRST: readonly TechGlossaryKey[] = [...TECH_GLOSSARY_KEYS].sort(
  (a, b) => b.length - a.length
)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 词条边界：key 须位于串首或连字符之后，且后跟串尾/连字符/数字。
// 数字分支专吃连写版本号（qwen2.5、vue3、glm-4）；'go' 不误配 'google'，'bert' 不误配 'roberta'。
const boundaryRegex = (key: string) => new RegExp('(?:^|-)' + escapeRe(key) + '(?:$|-|\\d)')

// 匹配规则（确定性）：① 规范名精确命中词条；② 否则按 key 长度降序做边界匹配；③ 无命中 → null。
export function glossaryKeyFor(name: string): TechGlossaryKey | null {
  const normalized = normalizeTechName(name)
  if (!normalized) return null
  if (KEY_SET.has(normalized)) return normalized as TechGlossaryKey
  for (const key of KEYS_LONGEST_FIRST) {
    if (boundaryRegex(key).test(normalized)) return key
  }
  return null
}

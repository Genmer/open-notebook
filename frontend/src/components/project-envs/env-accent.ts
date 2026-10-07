// Stable per-env identity hue from the six non-status hues; class strings stay
// literal so the Tailwind scanner picks them up, gradients reference the raw
// CSS vars so light/dark themes follow automatically.
const ACCENTS = ['sage', 'gold', 'plum', 'mauve', 'slate-hue', 'violet-hue'] as const

export type EnvAccent = (typeof ACCENTS)[number]

const TILE: Record<EnvAccent, string> = {
  sage: 'bg-sage-tint text-sage',
  gold: 'bg-gold-tint text-gold',
  plum: 'bg-plum-tint text-plum',
  mauve: 'bg-mauve-tint text-mauve',
  'slate-hue': 'bg-slate-hue-tint text-slate-hue',
  'violet-hue': 'bg-violet-hue-tint text-violet-hue',
}

const DOT: Record<EnvAccent, string> = {
  sage: 'bg-sage',
  gold: 'bg-gold',
  plum: 'bg-plum',
  mauve: 'bg-mauve',
  'slate-hue': 'bg-slate-hue',
  'violet-hue': 'bg-violet-hue',
}

// 各色相只依赖 base/tint 两个变量（-deep 并非所有主题作用域都有），
// 渐变落在 var() 上的变量一旦缺失整条会失效成 none。
const VARS: Record<EnvAccent, { base: string; tint: string }> = {
  sage: { base: 'var(--sage)', tint: 'var(--sage-tint)' },
  gold: { base: 'var(--gold)', tint: 'var(--gold-tint)' },
  plum: { base: 'var(--plum)', tint: 'var(--plum-tint)' },
  mauve: { base: 'var(--mauve)', tint: 'var(--mauve-tint)' },
  'slate-hue': { base: 'var(--slate)', tint: 'var(--slate-tint)' },
  'violet-hue': { base: 'var(--violet)', tint: 'var(--violet-tint)' },
}

export function accentOf(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const v = VARS[ACCENTS[h % ACCENTS.length]]
  return {
    tile: TILE[ACCENTS[h % ACCENTS.length]],
    dot: DOT[ACCENTS[h % ACCENTS.length]],
    // 左缘流动色条与卡面淡晕的 backgroundImage 值（内联 style 用，避开类名组合的 hover 跳色）
    ribbon: `linear-gradient(180deg, ${v.base}, ${v.base} 42%, ${v.tint})`,
    wash: `linear-gradient(115deg, color-mix(in oklab, ${v.tint} 55%, transparent), transparent 48%)`,
  }
}

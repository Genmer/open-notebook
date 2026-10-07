'use client'

import { Brain, Database, Layers, Package, Route, Sigma, Zap } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import type { TechItem, TechKind } from '@/lib/utils/env-structure'
import { glossaryKeyFor } from '@/lib/utils/tech-glossary'
import type { accentOf } from './env-accent'

// 类别只靠图标形状区分（aria-hidden 装饰），省 7 个类别 key × 14 locale。
const KIND_ICON: Record<TechKind, typeof Zap> = {
  cache: Zap,
  map: Route,
  solver: Sigma,
  model: Brain,
  database: Database,
  framework: Layers,
  other: Package,
}

export interface TechStackCardsProps {
  items: TechItem[]
  accent: ReturnType<typeof accentOf>
  narrative: string
}

export function TechStackCards({ items, accent, narrative }: TechStackCardsProps) {
  const { t } = useTranslation()
  const shown = items.slice(0, 8)
  const overflow = items.slice(8)
  return (
    <section data-testid="env-detail-tech">
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">
        {t('projectEnvs.detailTechStack')}
      </h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map((tech) => {
          const Icon = KIND_ICON[tech.kind]
          // hover 解释走静态术语表：命中词条时 title = 完整名 + 换行 + 解释（t 查不到回退空串），
          // 未命中保持 title = 原技术名 行为不变（overflow 卡不参与，title 仍为纯名字列表）。
          const glossaryKey = glossaryKeyFor(tech.name)
          const hint = glossaryKey
            ? t(`projectEnvs.glossary.${glossaryKey}`, { defaultValue: '' })
            : ''
          return (
            <div
              key={tech.name}
              data-testid="env-detail-tech-card"
              className="flex items-center gap-2 rounded-lg border bg-card p-2.5"
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-md',
                  accent.tile
                )}
              >
                <Icon className="size-4" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium"
                  title={hint ? `${tech.name}\n${hint}` : tech.name}
                >
                  {tech.name}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {tech.version ?? '—'}
                </span>
              </div>
            </div>
          )
        })}
        {overflow.length > 0 && (
          <div
            className="flex items-center justify-center rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground"
            title={overflow.map((o) => o.name).join('、')}
          >
            +{overflow.length}
          </div>
        )}
      </div>
      <p
        className={cn(
          'mt-2 text-xs leading-relaxed text-muted-foreground',
          narrative.length > 480 && 'line-clamp-4'
        )}
      >
        {narrative}
      </p>
    </section>
  )
}

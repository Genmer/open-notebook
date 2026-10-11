'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/lib/hooks/use-translation'
import { filterIndustryPool, industryTitleLines } from '@/lib/ruankao/industry-pool'

// 行业池小节（R2/C1：并入项目环境 tab，不设独立 tab）：
// 名称级静态条目本地过滤，点条目经 onPickIndustry 带值打开 mock 向导
interface IndustryPoolPanelProps {
  onPickIndustry: (industry: string) => void
}

export function IndustryPoolPanel({ onPickIndustry }: IndustryPoolPanelProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterIndustryPool(query), [query])

  return (
    <section className="space-y-3" data-testid="ruankao-industry-section">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {t('ruankao.industry.sectionTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('ruankao.industry.sectionDesc')}
        </p>
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('ruankao.industry.searchPlaceholder')}
        className="max-w-sm"
        data-testid="ruankao-industry-search"
      />
      {filtered.length > 0 ? (
        <div className="flex max-w-4xl flex-wrap gap-2" data-testid="ruankao-industry-list">
          {filtered.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => onPickIndustry(entry.name)}
              data-testid={`ruankao-industry-item-${entry.name}`}
              // hover 解释走池内 hint + 画像（tech-glossary 先例：原生 title，未命中静默退化）
              title={industryTitleLines(entry, t).join('\n')}
              className="rounded-full border px-3 py-1 text-xs transition-colors hover:border-teal/60 hover:text-teal"
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="ruankao-industry-empty">
          {t('ruankao.industry.emptyHint')}
        </p>
      )}
    </section>
  )
}

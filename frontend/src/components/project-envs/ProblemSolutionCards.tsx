'use client'

import { cn } from '@/lib/utils'
import { AlertTriangle, ArrowDown, Check } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { ProblemPair } from '@/lib/utils/env-structure'
import { accentOf } from './env-accent'

export interface ProblemSolutionCardsProps {
  pairs: ProblemPair[]
  intro: string
  accent: ReturnType<typeof accentOf>
}

// Vertical problem→solution pairs over splitProblemPairs output. Pairs whose
// solution could not be separated render as a neutral plain card (zero text
// loss, no false problem labeling).
export function ProblemSolutionCards({ pairs, intro, accent }: ProblemSolutionCardsProps) {
  const { t } = useTranslation()
  if (pairs.length < 1) return null

  return (
    <section data-testid="env-detail-pairs">
      <h4 className="text-xs font-medium text-muted-foreground">
        {t('projectEnvs.fieldProblems')}
      </h4>
      {intro && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{intro}</p>
      )}
      <ul className="mt-2 space-y-2">
        {pairs.map((pair, i) => (
          <li
            key={i}
            className="relative overflow-hidden rounded-lg border bg-card p-3"
            data-testid={`env-detail-pair-${i}`}
          >
            <span
              aria-hidden
              className="env-accent-ribbon absolute inset-y-0 left-0 w-[3px]"
              style={{ backgroundImage: accent.ribbon }}
            />
            {pair.solution ? (
              <>
                <div
                  className="space-y-1 rounded-md border border-warn/50 bg-warn-tint/30 px-2.5 py-2"
                  data-testid={`env-detail-pair-problem-${i}`}
                >
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-warn">
                    <AlertTriangle className="size-3" aria-hidden />
                    {t('projectEnvs.detailProblem')}
                    <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {pair.problem}
                  </p>
                </div>
                <div className="flex justify-center py-0.5">
                  <ArrowDown className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <div
                  className="space-y-1 rounded-md border border-fern/50 bg-fern-tint/30 px-2.5 py-2"
                  data-testid={`env-detail-pair-solution-${i}`}
                >
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-fern">
                    <Check className="size-3" aria-hidden />
                    {t('projectEnvs.detailSolution')}
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {pair.solution}
                  </p>
                </div>
              </>
            ) : (
              <p
                className={cn(
                  'rounded-md border px-2.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words'
                )}
                data-testid={`env-detail-pair-problem-${i}`}
              >
                {pair.problem}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

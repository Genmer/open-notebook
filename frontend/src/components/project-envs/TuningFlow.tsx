'use client'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, Gauge, TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { FlowStep, TrendChip } from '@/lib/utils/env-structure'
import { accentOf } from './env-accent'

export interface TuningFlowProps {
  steps: FlowStep[]
  accent: ReturnType<typeof accentOf>
  original: string
}

function OutcomeChip({ chip }: { chip: TrendChip }) {
  const Icon = chip.direction === 'up' ? TrendingUp : TrendingDown
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-fern/40 bg-card px-2 py-0.5 font-mono text-xs tabular-nums text-fern"
      title={chip.context}
    >
      <Icon className="size-3" aria-hidden />
      {chip.label && <span>{chip.label}</span>}
      <span>{chip.from}</span>
      <span aria-hidden>→</span>
      <span>{chip.to}</span>
    </span>
  )
}

// Vertical step flow over splitTuningSteps output; the full source text stays
// reachable via the collapsible below (collapsed = absent from the DOM).
export function TuningFlow({ steps, accent, original }: TuningFlowProps) {
  const { t } = useTranslation()
  if (steps.length < 2) return null

  let actionNo = 0
  return (
    <section data-testid="env-detail-tuning-flow">
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">
        {t('projectEnvs.fieldTuning')}
      </h4>
      <ol>
        {steps.map((node, i) => {
          const isAction = node.kind === 'action'
          if (isAction) actionNo += 1
          const testid =
            node.kind === 'outcome'
              ? 'env-detail-tuning-outcome'
              : node.kind === 'lead'
                ? 'env-detail-tuning-lead'
                : `env-detail-step-${actionNo}`
          return (
            <li key={i} className="relative pb-3 last:pb-0" data-testid={testid}>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-0 left-[11.5px] top-7 w-px opacity-70',
                    accent.dot
                  )}
                />
              )}
              <div className="flex items-start gap-2.5">
                {node.kind === 'lead' && (
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                      accent.tile
                    )}
                  >
                    <Gauge className="size-3" strokeWidth={1.5} />
                  </span>
                )}
                {isAction && (
                  <span
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      accent.tile
                    )}
                  >
                    {actionNo}
                  </span>
                )}
                {node.kind === 'outcome' && (
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-fern/40 bg-fern-tint text-fern"
                  >
                    <Check className="size-3" />
                  </span>
                )}
                {node.kind === 'outcome' ? (
                  <div className="min-w-0 flex-1 rounded-md border border-fern/40 bg-fern-tint/30 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-fern">
                      {t('projectEnvs.detailOutcome')}
                    </p>
                    {!!node.metrics?.length && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {node.metrics.slice(0, 3).map((chip, j) => (
                          <OutcomeChip key={j} chip={chip} />
                        ))}
                      </div>
                    )}
                    {node.body && (
                      <p
                        title={node.body}
                        className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-3 break-words"
                      >
                        {node.body}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="min-w-0 flex-1 break-words">
                    {node.title && (
                      <p
                        className={cn(
                          'text-sm font-medium leading-snug',
                          node.kind === 'lead' ? 'text-muted-foreground' : 'text-foreground'
                        )}
                      >
                        {node.title}
                      </p>
                    )}
                    {node.body && (
                      <p
                        title={node.body}
                        className="mt-0.5 text-xs leading-relaxed text-muted-foreground line-clamp-3 break-words"
                      >
                        {node.body}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <Collapsible className="group mt-2">
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown
            className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
          {t('projectEnvs.detailOriginalText')}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
            {original}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

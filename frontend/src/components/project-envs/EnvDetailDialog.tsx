'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  Bot,
  Building2,
  Check,
  ChevronDown,
  Loader2,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { ProjectEnv } from '@/lib/types/api'
import { spanMonths } from '@/lib/utils/project-env-time'
import {
  extractEnvStats,
  extractRoleTitle,
  extractTechs,
  splitProblemPairs,
  splitTuningSteps,
} from '@/lib/utils/env-structure'
import { accentOf } from './env-accent'
import { EnvTimeline } from './EnvTimeline'
import { StatTiles } from './StatTiles'
import { TechStackCards } from './TechStackCards'
import { TuningFlow } from './TuningFlow'
import { ProblemSolutionCards } from './ProblemSolutionCards'
import { GenericParagraphSection } from './GenericParagraphSection'
import { VerificationPanel } from './VerificationPanel'

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// Pending mock environments keep their generated material in draft_content;
// once promoted the main fields carry it. Show whichever has text.
function materialOf(env: ProjectEnv): Record<string, string> {
  const draft = env.draft_content ?? {}
  const pick = (key: string, main: string | null): string =>
    asText(draft[key]) || (main ?? '').trim()
  return {
    background: pick('background', env.background),
    tech_background: pick('tech_background', env.tech_background),
    tuning_process: pick('tuning_process', env.tuning_process),
    problems_solutions: pick('problems_solutions', env.problems_solutions),
    my_role: pick('my_role', env.my_role),
    scale: pick('scale', env.scale),
  }
}

// Display-only status for the dialog header; the interactive badges (with
// their testids and click targets) belong to the still-mounted list below.
function StatusPill({ env }: { env: ProjectEnv }) {
  const { t } = useTranslation()
  if (env.status === 'verified') {
    return (
      <Badge className="gap-1 border-fern/40 bg-fern-tint text-fern hover:bg-fern-tint">
        <Check className="size-3" aria-hidden />
        {t('projectEnvs.statusVerified')}
      </Badge>
    )
  }
  if (env.status === 'needs_review') {
    return (
      <Badge className="border-warn/40 bg-warn-tint text-warn hover:bg-warn-tint">
        {t('projectEnvs.statusNeedsReview', { count: env.pending_claims_count })}
      </Badge>
    )
  }
  if (env.status === 'pending' || env.status === 'material_pending') {
    return (
      <Badge variant="outline" className="gap-1 border-teal/50 text-teal">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {env.status === 'pending'
          ? t('projectEnvs.statusPending')
          : t('projectEnvs.statusMaterialPending')}
      </Badge>
    )
  }
  if (env.status === 'material_ready') {
    return (
      <Badge className="border-warn/40 bg-warn-tint text-warn hover:bg-warn-tint">
        {t('projectEnvs.statusMaterialReady')}
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <X className="size-3" aria-hidden />
      {t('projectEnvs.statusFailed')}
    </Badge>
  )
}

interface EnvDetailDialogProps {
  env: ProjectEnv | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: (envId: string) => void
}

export function EnvDetailDialog({ env, open, onOpenChange }: EnvDetailDialogProps) {
  const { t } = useTranslation()
  if (!env) return null

  const material = materialOf(env)
  const empty = Object.values(material).every((text) => text.length === 0)
  const accent = accentOf(env.id)
  const span = spanMonths(env.period_start, env.period_end)
  const real = env.source_type === 'real'

  // One extraction pass feeds the visual blocks; each block falls back to the
  // plain text card whenever the structure could not be recovered.
  const stats = extractEnvStats(material.scale, material.background)
  const techs = extractTechs(material.tech_background)
  const steps = splitTuningSteps(material.tuning_process)
  const pairBlock = splitProblemPairs(material.problems_solutions)
  const roleTitle = extractRoleTitle(material.my_role)

  const openSection = (label: string, text: string) => (
    <section className="rounded-lg border bg-card p-3">
      <h4 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h4>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
    </section>
  )

  // Long process narratives stay collapsed; the ChevronDown rotation hooks
  // the data-state exposed on the Collapsible root ("group").
  const foldedSection = (label: string, text: string) => (
    <Collapsible className="group rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t p-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        data-testid="env-detail-dialog"
      >
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-5">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-base font-semibold leading-none">
            <span
              aria-hidden
              className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', accent.tile)}
            >
              <Building2 className="size-4" strokeWidth={1.5} />
            </span>
            <span className="min-w-0 flex-1 truncate">{env.name}</span>
            {real ? (
              <Badge variant="secondary">{t('projectEnvs.sourceReal')}</Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-teal/40 bg-teal-tint/40 text-teal">
                <Bot className="size-3" aria-hidden />
                {t('projectEnvs.sourceMock')}
              </Badge>
            )}
            {(env.ai_assisted?.polish_count ?? 0) > 0 && (
              <Badge variant="outline" className="gap-1 border-teal/50 text-teal">
                <Sparkles className="size-3" aria-hidden />
                {t('projectEnvs.aiPolished')}
              </Badge>
            )}
            <StatusPill env={env} />
          </DialogTitle>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <EnvTimeline
              start={(env.period_start ?? '').trim() || null}
              end={(env.period_end ?? '').trim() || null}
              months={span}
              accent={accent}
            />
            <span>{t('projectEnvs.sessionsCount', { count: env.session_ref_count })}</span>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 pt-4">
          {!!env.keywords?.length && (
            <div className="flex flex-wrap gap-1.5">
              {(env.keywords ?? []).map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1.5 rounded-sm border bg-popover px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  <span aria-hidden className={cn('size-1.5 rounded-full', accent.dot)} />
                  {kw}
                </span>
              ))}
            </div>
          )}

          {empty ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {t('projectEnvs.detailEmpty')}
            </p>
          ) : (
            <div className="space-y-3" data-testid="env-detail-sections">
              {stats.length >= 2 && <StatTiles items={stats} />}
              {openSection(t('projectEnvs.fieldBackground'), material.background)}
              {material.tech_background ? (
                techs.length >= 1 ? (
                  <TechStackCards
                    items={techs}
                    accent={accent}
                    narrative={material.tech_background}
                  />
                ) : (
                  openSection(t('projectEnvs.fieldTechBackground'), material.tech_background)
                )
              ) : null}
              {(material.my_role || material.scale) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {material.my_role ? (
                    roleTitle ? (
                      <section
                        data-testid="env-detail-role-card"
                        className="rounded-lg border bg-card p-3"
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            aria-hidden
                            className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-md',
                              accent.tile
                            )}
                          >
                            <User className="size-4" strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-medium text-muted-foreground">
                              {t('projectEnvs.fieldMyRole')}
                            </h4>
                            <p className="mt-0.5 break-words text-sm font-medium text-foreground">
                              {roleTitle}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                          {material.my_role}
                        </p>
                      </section>
                    ) : (
                      openSection(t('projectEnvs.fieldMyRole'), material.my_role)
                    )
                  ) : null}
                  {material.scale ? (
                    <section
                      data-testid="env-detail-scale-card"
                      className="rounded-lg border bg-card p-3"
                    >
                      <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                        {t('projectEnvs.fieldScale')}
                      </h4>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                        {material.scale}
                      </p>
                    </section>
                  ) : null}
                </div>
              )}
              {material.tuning_process ? (
                steps.length >= 2 ? (
                  <TuningFlow steps={steps} accent={accent} original={material.tuning_process} />
                ) : (
                  foldedSection(t('projectEnvs.fieldTuning'), material.tuning_process)
                )
              ) : null}
              {material.problems_solutions ? (
                pairBlock.pairs.length >= 1 ? (
                  <ProblemSolutionCards
                    pairs={pairBlock.pairs}
                    intro={pairBlock.intro}
                    accent={accent}
                  />
                ) : (
                  foldedSection(t('projectEnvs.fieldProblems'), material.problems_solutions)
                )
              ) : null}
            </div>
          )}

          <Collapsible defaultOpen={env.status !== 'verified'} className="group rounded-lg border bg-card">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />
                {t('projectEnvs.verificationDetails')}
              </span>
              <ChevronDown
                className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t p-3">
                {/* onCancel wires the panel's stop button: it cancels the active
                    verification job, then this dialog closes (the self-healing
                    status read turns the env into an actionable failed state). */}
                <VerificationPanel envId={env.id} onCancel={() => onOpenChange(false)} />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <GenericParagraphSection env={env} />
        </div>

        <div className="flex shrink-0 justify-end border-t px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-3.5 w-3.5" />
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

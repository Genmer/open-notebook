'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Building2, X } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { ProjectEnv } from '@/lib/types/api'
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
  const sections: Array<{ label: string; text: string }> = [
    { label: t('projectEnvs.fieldBackground'), text: material.background },
    { label: t('projectEnvs.fieldTechBackground'), text: material.tech_background },
    { label: t('projectEnvs.fieldTuning'), text: material.tuning_process },
    { label: t('projectEnvs.fieldProblems'), text: material.problems_solutions },
    { label: t('projectEnvs.fieldMyRole'), text: material.my_role },
    { label: t('projectEnvs.fieldScale'), text: material.scale },
  ].filter((s) => s.text.length > 0)

  const empty = sections.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl" data-testid="env-detail-dialog">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="truncate">{env.name}</span>
            {env.source_type === 'real' ? (
              <Badge variant="secondary">{t('projectEnvs.sourceReal')}</Badge>
            ) : (
              <Badge variant="outline" className="gap-1">🤖 {t('projectEnvs.sourceMock')}</Badge>
            )}
            {(env.period_start || env.period_end) && (
              <span className="text-xs font-normal text-muted-foreground">
                {env.period_start}–{env.period_end}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(90vh-7rem)] space-y-4 overflow-y-auto p-6 pt-4">
          {!!env.keywords?.length && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(env.keywords ?? []).map((kw) => (
                <Badge key={kw} variant="secondary" className="font-normal">
                  {kw}
                </Badge>
              ))}
            </div>
          )}

          {empty ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {t('projectEnvs.detailEmpty')}
            </p>
          ) : (
            <div className="space-y-3" data-testid="env-detail-sections">
              {sections.map((s) => (
                <section key={s.label} className="rounded-lg border bg-card p-3">
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                    {s.label}
                  </h4>
                  <p className={cn('text-sm leading-relaxed whitespace-pre-wrap')}>{s.text}</p>
                </section>
              ))}
            </div>
          )}

          <VerificationPanel envId={env.id} />
        </div>

        <div className="flex justify-end border-t px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-3.5 w-3.5" />
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

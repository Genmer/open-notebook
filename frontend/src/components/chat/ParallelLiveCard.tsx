'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ParallelRunState } from '@/lib/hooks/use-parallel-chat'
import { cn } from '@/lib/utils'

interface ParallelLiveCardProps {
  runs: ParallelRunState[]
  isSynthesizing: boolean
  synthesis: { content: string; model_name: string | null; agent_name: string | null } | null
  onSynthesize: (participant: { agent?: string; model?: string }) => void
}

/** Live comparison card while a parallel run is in flight (PDR-004).
 * The authoritative archived copy renders from the message history once the
 * `archived` event lands; this card covers the streaming moment. */
export function ParallelLiveCard({
  runs,
  isSynthesizing,
  synthesis,
  onSynthesize,
}: ParallelLiveCardProps) {
  const { t } = useTranslation()
  const [synthesizer, setSynthesizer] = useState<{ agent?: string; model?: string }>({})

  const doneCount = runs.filter((r) => r.status === 'done').length
  const allSettled = runs.length > 0 && runs.every((r) => r.status !== 'pending')

  return (
    <div className="space-y-2" data-testid="parallel-live-card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t('chat.parallelProgress', { done: doneCount, total: runs.length })}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {runs.map((run) => (
          <Card key={run.key} className="overflow-hidden" data-testid={`parallel-run-${run.key}`}>
            <CardHeader className="p-3 pb-2 space-y-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{run.name}</span>
                {run.status === 'pending' && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
                )}
                {run.status === 'done' && (
                  <CheckCircle2 className="h-4 w-4 text-fern flex-shrink-0" />
                )}
                {run.status === 'error' && (
                  <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                )}
              </div>
              {(run.agent_name || run.model_name) && run.status !== 'pending' && (
                <span className="text-xs text-muted-foreground">
                  {run.agent_name || run.model_name}
                </span>
              )}
            </CardHeader>
            <CardContent className="p-3 pt-0 text-sm">
              {run.status === 'pending' && (
                <p className="text-muted-foreground text-xs">{t('chat.parallelWaiting')}</p>
              )}
              {run.status === 'error' && (
                <p className="text-destructive text-xs break-words">{run.error}</p>
              )}
              {run.status === 'done' && run.content && (
                <div className="max-h-64 overflow-y-auto text-sm">
                  <MarkdownRenderer>{run.content}</MarkdownRenderer>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {allSettled && !synthesis && (
        <div
          className="rounded-lg border border-dashed p-3 flex flex-wrap items-center gap-2"
          data-testid="parallel-synthesis-bar"
        >
          <Sparkles className="h-4 w-4 text-gold" />
          <span className="text-sm">{t('chat.synthesisPickLabel')}</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm max-w-[220px]"
            value={synthesizer.agent ?? synthesizer.model ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setSynthesizer(
                value.startsWith('agent:')
                  ? { agent: value }
                  : value.startsWith('model:')
                    ? { model: value }
                    : {}
              )
            }}
            aria-label={t('chat.synthesisPickLabel')}
            data-testid="parallel-synthesis-select"
          >
            <option value="">{t('chat.synthesisDefaultPicker')}</option>
            <optgroup label={t('chat.groupAgents')}>
              {runs
                .filter((r) => r.kind === 'agent' && r.status === 'done')
                .map((r) => (
                  <option key={r.key} value={`agent:${r.key.slice('agent:'.length)}`}>
                    {r.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label={t('chat.groupModels')}>
              {runs
                .filter((r) => r.kind === 'model' && r.status === 'done')
                .map((r) => (
                  <option key={r.key} value={`model:${r.key.slice('model:'.length)}`}>
                    {r.name}
                  </option>
                ))}
            </optgroup>
          </select>
          <Button
            size="sm"
            disabled={isSynthesizing}
            onClick={() => onSynthesize(synthesizer)}
            data-testid="parallel-synthesis-run"
          >
            {isSynthesizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {t('chat.synthesisRun')}
          </Button>
        </div>
      )}

      {synthesis && (
        <Card
          className={cn('border-gold/40')}
          data-testid="parallel-synthesis-result"
        >
          <CardHeader className="p-3 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gold" />
              <span className="text-sm font-medium">{t('chat.synthesisResultTitle')}</span>
              <Badge variant="secondary">
                {synthesis.agent_name || synthesis.model_name || ''}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 text-sm">
            <MarkdownRenderer>{synthesis.content}</MarkdownRenderer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

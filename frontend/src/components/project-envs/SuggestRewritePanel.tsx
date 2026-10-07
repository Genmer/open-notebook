'use client'

import { AlertTriangle, ArrowDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SuggestRewritePanelProps {
  original: string
  suggestion?: string
  explanation?: string
  loading: boolean
  failed: boolean
  onAdopt: () => void
  onDiscard: () => void
  onRetry: () => void
}

// Stacked before/after view for the AI rewrite suggestion: the original
// paragraph on top, the proposed replacement below, adopt feeds the rewrite
// box (nothing is saved until the user submits the rewrite).
export function SuggestRewritePanel({
  original,
  suggestion,
  explanation,
  loading,
  failed,
  onAdopt,
  onDiscard,
  onRetry,
}: SuggestRewritePanelProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-teal/40 bg-teal-tint/30 p-3 text-sm text-teal"
        data-testid="suggest-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  if (failed || !suggestion) {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        <p className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {t('projectEnvs.suggestFailed')}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="suggest-panel">
      <p className="text-xs font-medium text-muted-foreground">
        {t('projectEnvs.suggestTitle')}
      </p>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('projectEnvs.suggestOriginal')}
        </p>
        <p className="whitespace-pre-wrap break-all rounded bg-muted px-2 py-1.5 text-sm text-muted-foreground">
          {original}
        </p>
      </div>
      <div className="flex justify-center text-muted-foreground">
        <ArrowDown className="h-4 w-4" />
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-teal">
          {t('projectEnvs.suggestSuggestion')}
        </p>
        <p className="whitespace-pre-wrap break-all rounded border border-teal/50 bg-teal-tint/30 px-2 py-1.5 text-sm">
          {suggestion}
        </p>
      </div>
      {explanation && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{t('projectEnvs.suggestExplanation')}</span>
          {explanation}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDiscard} data-testid="suggest-discard">
          {t('projectEnvs.suggestDiscard')}
        </Button>
        <Button size="sm" onClick={onAdopt} data-testid="suggest-adopt">
          {t('projectEnvs.suggestAdopt')}
        </Button>
      </div>
    </div>
  )
}

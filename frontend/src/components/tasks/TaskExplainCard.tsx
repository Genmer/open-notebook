'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { CheckCircle2, ChevronDown, Copy, ExternalLink, RotateCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { TaskEntry, TaskRetryResponse } from '@/lib/api/tasks'
import { useExplain } from '@/lib/hooks/use-explain'

// Literals for the unused-key grep: these keys reach t() dynamically via
// backend-provided label_key/classification values.
const CLASS_BADGES: Record<string, { key: string; className: string }> = {
  transient: { key: 'tasks.explain.classRetryable', className: 'bg-teal-tint text-teal' },
  user_fixable: { key: 'tasks.explain.classNeedsConfig', className: 'bg-gold-tint text-gold-deep' },
  known_issue: { key: 'tasks.explain.classKnownIssue', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  likely_bug: { key: 'tasks.explain.classLikelyBug', className: '' },
  unknown: { key: 'tasks.explain.classUnknown', className: '' },
}

// Backend anchors arrive inline — `**What happened** — text…` (both the prompt
// template and the degraded path use the em-dash form) — or alone on a line.
const ANCHOR_LINE =
  /^\s*\*\*(What happened|Likely root cause|How to fix|Next actions)\*\*(.*)$/
const ANCHOR_KEYS: Record<string, string> = {
  'What happened': 'tasks.explain.sectionWhat',
  'Likely root cause': 'tasks.explain.sectionCause',
  'How to fix': 'tasks.explain.sectionFix',
  'Next actions': 'tasks.explain.sectionNext',
}

// Only backend-whitelisted actions/facts get rendered; unknown ones are skipped
// rather than passed to t() blindly.
const ACTION_LABEL_KEYS: Record<string, string> = {
  retry: 'tasks.explain.actionRetry',
  open_models_settings: 'tasks.explain.actionOpenModelsSettings',
  open_credentials: 'tasks.explain.actionOpenCredentials',
  copy_diagnostics: 'tasks.explain.actionCopyDiagnostics',
  report_issue: 'tasks.explain.actionReportIssue',
}

const FACT_LABEL_KEYS = new Set([
  'tasks.explain.factCommand',
  'tasks.explain.factType',
  'tasks.explain.factStatus',
  'tasks.explain.factError',
])

function factLabel(labelKey: string): string {
  return FACT_LABEL_KEYS.has(labelKey) ? labelKey : ''
}

function looksLikeJson(text: string): boolean {
  if (!text.startsWith('{') || !text.endsWith('}')) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

// The trailing classification JSON may arrive bare or fenced (```json … ```);
// either form is metadata, never content to render.
function stripTrailingJson(lines: string[]): string[] {
  if (!lines.length) return lines
  const last = lines[lines.length - 1].trim()
  if (last === '```') {
    for (let i = lines.length - 2; i >= 0; i--) {
      if (lines[i].trim().startsWith('```')) {
        const inner = lines.slice(i + 1, -1).join('\n').trim()
        return looksLikeJson(inner) ? lines.slice(0, i) : lines
      }
    }
    return lines
  }
  if (!last.endsWith('}')) return lines
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim().startsWith('{')) continue
    if (looksLikeJson(lines.slice(i).join('\n').trim())) return lines.slice(0, i)
  }
  return lines
}

interface ExplainSection {
  titleKey: string | null
  body: string
}

// Explain-mode markdown carries English anchor headings and a trailing JSON
// metadata line — both must be stripped before rendering (section titles come
// from i18n instead). When no anchor is found the text renders as one block,
// with any stray anchor/JSON line still removed.
function parseExplainSections(markdown: string): ExplainSection[] {
  let lines = markdown.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  lines = stripTrailingJson(lines)
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()

  const sections: { titleKey: string | null; lines: string[] }[] = [
    { titleKey: null, lines: [] },
  ]
  let foundAnchor = false
  for (const line of lines) {
    const match = ANCHOR_LINE.exec(line)
    if (match && ANCHOR_KEYS[match[1]]) {
      foundAnchor = true
      sections.push({ titleKey: ANCHOR_KEYS[match[1]], lines: [] })
      const inline = match[2].replace(/^\s*[—–:-]\s*/, '').trim()
      if (inline) sections[sections.length - 1].lines.push(inline)
    } else {
      sections[sections.length - 1].lines.push(line)
    }
  }

  const rendered = sections
    .filter((s, i) => (foundAnchor ? i > 0 || s.lines.some((l) => l.trim()) : true))
    .map((s) => ({ titleKey: s.titleKey, body: s.lines.join('\n').trim() }))
    .filter((s) => s.body)
  // Fully-empty input still yields one block, but stripped of anchors/JSON.
  return rendered.length
    ? rendered
    : [{ titleKey: null, body: lines.join('\n').trim() }]
}

interface TaskExplainCardProps {
  task: TaskEntry
  onRetry: (
    task: TaskEntry,
    opts?: { checkRecovery?: boolean },
  ) => Promise<TaskRetryResponse | undefined> | void
  retrying?: boolean
}

export function TaskExplainCard({ task, onRetry, retrying }: TaskExplainCardProps) {
  const { t } = useTranslation()
  const [factsOpen, setFactsOpen] = useState(false)
  const { data, isError, isPending, mutate } = useExplain(task.id)
  const requested = useRef(false)

  // The card only mounts when expanded, so mount == first request.
  useEffect(() => {
    if (!requested.current) {
      requested.current = true
      mutate({ refresh: false })
    }
  }, [mutate])

  const badge = data ? CLASS_BADGES[data.classification ?? 'unknown'] : undefined

  const handleCopyDiagnostics = async () => {
    if (!data) return
    // Raw task.error_message is unredacted; only backend-redacted facts are
    // safe to copy (this text is meant for pasting into a public issue).
    const lines = [`Task ID: ${task.id}`]
    for (const fact of data.facts) {
      const labelKey = factLabel(fact.label_key)
      lines.push(`${labelKey ? t(labelKey) : fact.label_key}: ${fact.value}`)
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success(t('tasks.explain.copyDone'))
    } catch {
      // Clipboard can be denied (permissions/insecure context); nothing to do.
    }
  }

  // skipped_recovered means the recovery verdict flipped since this
  // explanation was generated — re-ask the backend so the card switches to
  // its recovered state. Manual retry submits a new job; no refresh needed.
  const handleAiRetry = async () => {
    const result = await onRetry(task, { checkRecovery: true })
    if (result?.status === 'skipped_recovered') mutate({ refresh: true })
  }

  const renderSuggestion = (index: number, action: string) => {
    const labelKey = ACTION_LABEL_KEYS[action]
    if (!labelKey) return null
    const label = t(labelKey)
    switch (action) {
      case 'retry': {
        // Backend pre-filters retry for recovered failures; the frontend check
        // is a second line of defense so a stale response can't offer a
        // pointless replay.
        const recovery = data?.recovery
        if (recovery?.recovered) return null
        if (recovery) {
          return (
            <Fragment key={index}>
              <Button
                size="sm"
                onClick={() => void handleAiRetry()}
                disabled={retrying}
              >
                <Sparkles className={retrying ? 'animate-pulse' : ''} aria-hidden="true" />
                {t('tasks.explain.aiRetry')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onRetry(task)}
                disabled={retrying}
              >
                <RotateCcw className={retrying ? 'animate-spin' : ''} aria-hidden="true" />
                {t('tasks.explain.manualRetry')}
              </Button>
            </Fragment>
          )
        }
        return (
          <Button key={index} size="sm" onClick={() => void onRetry(task)} disabled={retrying}>
            <RotateCcw className={retrying ? 'animate-spin' : ''} aria-hidden="true" />
            {label}
          </Button>
        )
      }
      case 'open_models_settings':
        return (
          <Button key={index} variant="outline" size="sm" asChild>
            <Link href="/settings/models#default-models">{label}</Link>
          </Button>
        )
      case 'open_credentials':
        return (
          <Button key={index} variant="outline" size="sm" asChild>
            <Link href="/settings/models#provider-credentials">{label}</Link>
          </Button>
        )
      case 'copy_diagnostics':
        return (
          <Button key={index} variant="outline" size="sm" onClick={() => void handleCopyDiagnostics()}>
            <Copy />
            {label}
          </Button>
        )
      case 'report_issue':
        return (
          <Button key={index} variant="outline" size="sm" asChild>
            <a href="https://github.com/lfnovo/open-notebook/issues" target="_blank" rel="noreferrer">
              <ExternalLink />
              {label}
            </a>
          </Button>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 px-3 py-3 text-sm">
      {isPending && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-teal">
            <Sparkles className="size-3.5 animate-pulse" aria-hidden="true" />
            <span>{t('tasks.explain.thinking')}</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="size-1.5 animate-bounce rounded-full bg-teal" />
              <span className="size-1.5 animate-bounce rounded-full bg-teal [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-teal [animation-delay:300ms]" />
            </span>
          </div>
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive">{t('tasks.explain.loadFailed')}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => mutate({ refresh: true })}
            title={t('tasks.explain.refresh')}
            aria-label={t('tasks.explain.refresh')}
          >
            <RotateCcw />
          </Button>
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {/* Multicolor gradient is a deliberate user-requested exception to
                the flat design system — it marks the card as AI-generated. */}
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-teal-500 via-sky-500 to-violet-500 px-2.5 py-0.5 text-xs font-semibold text-white">
              <Sparkles className="size-3" aria-hidden="true" />
              {t('tasks.explain.aiLabel')}
            </span>
            <Badge
              variant={data.classification === 'likely_bug' ? 'destructive' : 'secondary'}
              className={badge?.className}
            >
              {t(badge?.key ?? 'tasks.explain.classUnknown')}
            </Badge>
            {data.recovery?.recovered && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-sage">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                {t('tasks.explain.recoveredNotice')}
              </span>
            )}
            {data.degraded && (
              <span className="text-xs text-muted-foreground">{t('tasks.explain.degradedNotice')}</span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-muted-foreground"
              onClick={() => mutate({ refresh: true })}
              disabled={isPending}
              title={t('tasks.explain.refresh')}
              aria-label={t('tasks.explain.refresh')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {data.mode === 'explain'
            ? parseExplainSections(data.explanation_markdown).map((section, i) => (
                <div key={i} className="space-y-1">
                  {section.titleKey && (
                    <p className="text-xs font-semibold text-foreground">{t(section.titleKey)}</p>
                  )}
                  <div className="text-sm">
                    <MarkdownRenderer>{section.body}</MarkdownRenderer>
                  </div>
                </div>
              ))
            : (
                <div className="text-sm">
                  <MarkdownRenderer>{data.explanation_markdown}</MarkdownRenderer>
                </div>
              )}

          <Collapsible open={factsOpen} onOpenChange={setFactsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${factsOpen ? '' : '-rotate-90'}`}
                />
                {t('tasks.explain.factsTitle')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="mt-1 space-y-1 rounded-md bg-muted/50 px-2.5 py-2">
                {data.facts.map((fact, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <dt className="shrink-0 text-muted-foreground">
                      {factLabel(fact.label_key)
                        ? t(factLabel(fact.label_key))
                        : fact.label_key}
                    </dt>
                    <dd className="min-w-0 break-words">{fact.value}</dd>
                  </div>
                ))}
                {task.error_message && (
                  <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                    {task.error_message}
                  </p>
                )}
              </dl>
            </CollapsibleContent>
          </Collapsible>

          {data.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {data.suggestions.map((suggestion, i) =>
                renderSuggestion(i, suggestion.action),
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

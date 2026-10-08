'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Pencil, Sparkles } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useGenerateGenericParagraph } from '@/lib/hooks/use-project-envs'
import { projectEnvsApi } from '@/lib/api/project-envs'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import type { ProjectEnv } from '@/lib/types/api'

const GENERIC_PARAGRAPH_MAX_CHARS = 5000

interface GenericParagraphSectionProps {
  env: ProjectEnv
}

// User-owned reusable paragraph (generic paragraph): edits save straight to the
// env (no re-verification), AI generate only fills the edit box — nothing is
// persisted until the user saves.
export function GenericParagraphSection({ env }: GenericParagraphSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoGenerating, setAutoGenerating] = useState(false)
  // One silent auto-generate attempt per env.id: invalidate refreshes must not
  // retrigger it, and a failed attempt is never retried. Only converged envs
  // qualify — a pending env would race the running verification.
  const autoAttemptedRef = useRef<Set<string>>(new Set())
  const generateMutation = useGenerateGenericParagraph()
  const paragraph = (env.generic_paragraph ?? '').trim()

  useEffect(() => {
    if ((env.generic_paragraph ?? '').trim()) return
    if (env.status !== 'verified' && env.status !== 'needs_review') return
    if (autoAttemptedRef.current.has(env.id)) return
    autoAttemptedRef.current.add(env.id)
    setAutoGenerating(true)
    projectEnvsApi
      .generateGenericParagraph(env.id)
      .then((data) => {
        // A user save during the in-flight generate must win over the AI
        // text: re-check the freshest cached copy before any write.
        const userFilled = queryClient
          .getQueriesData({ queryKey: ['project-envs'] })
          .some(([, cached]) => {
            const rows = Array.isArray(cached) ? cached : [cached]
            return rows.some(
              (row) =>
                row &&
                typeof row === 'object' &&
                (row as ProjectEnv).id === env.id &&
                !!((row as ProjectEnv).generic_paragraph ?? '').trim()
            )
          })
        if (userFilled) return
        return projectEnvsApi
          .update(env.id, {
            generic_paragraph: data.paragraph.slice(0, GENERIC_PARAGRAPH_MAX_CHARS),
          })
          .then(() =>
            queryClient.invalidateQueries({ queryKey: ['project-envs'] })
          )
      })
      // Silent by design: the hint stays and manual generate still works.
      .catch(() => undefined)
      .finally(() => setAutoGenerating(false))
  }, [env.id, env.status, env.generic_paragraph, queryClient])

  const save = () => {
    setSaving(true)
    projectEnvsApi
      .update(env.id, { generic_paragraph: draft.trim() || null })
      .then(() => {
        toast.success(t('projectEnvs.genericParagraphSaved'))
        setEditing(false)
        queryClient.invalidateQueries({ queryKey: ['project-envs'] })
      })
      .catch((error: unknown) => {
        toast.error(
          getApiErrorMessage(error, (k) => t(k)) ||
            t('projectEnvs.genericParagraphSaveFailed')
        )
      })
      .finally(() => setSaving(false))
  }

  const startEdit = () => {
    setDraft(env.generic_paragraph ?? '')
    setEditing(true)
  }

  const generate = () => {
    generateMutation.mutate(env.id, {
      onSuccess: (data) => {
        // Fill the edit box only; saving stays an explicit user action.
        setDraft(data.paragraph.slice(0, GENERIC_PARAGRAPH_MAX_CHARS))
        setEditing(true)
      },
    })
  }

  return (
    <section
      className="rounded-lg border border-l-2 border-l-teal bg-card p-3"
      data-testid="generic-paragraph-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          {t('projectEnvs.genericParagraph')}
        </h4>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={generateMutation.isPending || autoGenerating}
            onClick={generate}
            data-testid="generic-paragraph-generate"
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            {t('projectEnvs.genericParagraphGenerate')}
          </Button>
          {!editing && (
            <Button
              size="sm"
              variant="outline"
              disabled={autoGenerating}
              onClick={startEdit}
              data-testid="generic-paragraph-edit"
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t('projectEnvs.genericParagraphEdit')}
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-1.5">
          <Textarea
            value={draft}
            onChange={(event) =>
              setDraft(event.target.value.slice(0, GENERIC_PARAGRAPH_MAX_CHARS))
            }
            maxLength={GENERIC_PARAGRAPH_MAX_CHARS}
            rows={8}
            placeholder={t('projectEnvs.genericParagraphHint')}
            data-testid="generic-paragraph-input"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground" data-testid="generic-paragraph-count">
              {t('projectEnvs.genericParagraphCount', { count: draft.length })}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                {t('projectEnvs.genericParagraphCancel')}
              </Button>
              <Button
                size="sm"
                disabled={saving || draft === (env.generic_paragraph ?? '')}
                onClick={save}
                data-testid="generic-paragraph-save"
              >
                {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {t('projectEnvs.genericParagraphSave')}
              </Button>
            </div>
          </div>
        </div>
      ) : paragraph ? (
        <p
          className="mt-2 whitespace-pre-wrap break-all text-sm leading-relaxed"
          data-testid="generic-paragraph-text"
        >
          {paragraph}
        </p>
      ) : autoGenerating ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="generic-paragraph-auto-pending"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('projectEnvs.genericParagraphAutoPending')}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('projectEnvs.genericParagraphHint')}
        </p>
      )}
    </section>
  )
}

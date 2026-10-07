'use client'

import { useState } from 'react'
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
  const generateMutation = useGenerateGenericParagraph()
  const paragraph = (env.generic_paragraph ?? '').trim()

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
            disabled={generateMutation.isPending}
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
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('projectEnvs.genericParagraphHint')}
        </p>
      )}
    </section>
  )
}

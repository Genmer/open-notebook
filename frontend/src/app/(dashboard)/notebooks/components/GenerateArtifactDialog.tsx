'use client'

import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { FileText, GraduationCap, HelpCircle, Layers } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useGenerateArtifact } from '@/lib/hooks/use-artifacts'
import {
  buildArtifactContextConfig,
  hasIncludedContext,
  type ArtifactType,
} from '@/lib/utils/artifact-context'
import type { ContextSelections } from '../[id]/page'
import type { NoteResponse, SourceListResponse } from '@/lib/types/api'

interface GenerateArtifactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  contextSelections: ContextSelections
  sources: SourceListResponse[]
  notes: NoteResponse[]
}

const ARTIFACT_OPTIONS: Array<{
  type: ArtifactType
  icon: typeof GraduationCap
  titleKey: string
  descKey: string
}> = [
  {
    type: 'study_guide',
    icon: GraduationCap,
    titleKey: 'artifacts.type.studyGuide',
    descKey: 'artifacts.type.studyGuideDesc',
  },
  {
    type: 'faq',
    icon: HelpCircle,
    titleKey: 'artifacts.type.faq',
    descKey: 'artifacts.type.faqDesc',
  },
  {
    type: 'flashcards',
    icon: Layers,
    titleKey: 'artifacts.type.flashcards',
    descKey: 'artifacts.type.flashcardsDesc',
  },
  {
    type: 'essay_draft',
    icon: FileText,
    titleKey: 'artifacts.type.essayDraft',
    descKey: 'artifacts.type.essayDraftDesc',
  },
]

/**
 * Dialog to generate a notebook-level study artifact (study guide / FAQ /
 * flashcards / essay draft) from the current context selection. Runs asynchronously on the
 * backend; the result is added to the notebook as a note.
 */
export function GenerateArtifactDialog({
  open,
  onOpenChange,
  notebookId,
  contextSelections,
  sources,
  notes,
}: GenerateArtifactDialogProps) {
  const { t } = useTranslation()
  const [artifactType, setArtifactType] = useState<ArtifactType>('study_guide')
  const [instruction, setInstruction] = useState('')

  const generate = useGenerateArtifact(notebookId)

  const contextConfig = useMemo(
    () => buildArtifactContextConfig(contextSelections, sources, notes),
    [contextSelections, sources, notes]
  )
  const hasContext = hasIncludedContext(contextConfig)

  const includedSources = Object.values(contextConfig.sources).filter(s => s !== 'not in').length
  const includedNotes = Object.values(contextConfig.notes).filter(s => s !== 'not in').length

  const handleSubmit = async () => {
    try {
      await generate.mutateAsync({
        artifact_type: artifactType,
        instruction: instruction.trim() || undefined,
        context_config: contextConfig,
      })
      onOpenChange(false)
      setInstruction('')
    } catch {
      // Error toast is handled by the hook.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{t('artifacts.title')}</DialogTitle>
        <DialogDescription>{t('artifacts.description')}</DialogDescription>

        <div className="grid grid-cols-2 gap-2">
          {ARTIFACT_OPTIONS.map(({ type, icon: Icon, titleKey, descKey }) => (
            <button
              key={type}
              type="button"
              onClick={() => setArtifactType(type)}
              aria-pressed={artifactType === type}
              data-testid={`artifact-type-${type}`}
              className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${
                artifactType === type
                  ? 'border-teal bg-teal/5'
                  : 'hover:bg-accent/40'
              }`}
            >
              <Icon className="h-5 w-5 mt-0.5 text-teal" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(titleKey)}</span>
                <span className="block text-xs text-muted-foreground line-clamp-2">
                  {t(descKey)}
                </span>
              </span>
            </button>
          ))}
        </div>

        <Textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={t(
            artifactType === 'essay_draft'
              ? 'artifacts.essayDraftPlaceholder'
              : 'artifacts.instructionPlaceholder'
          )}
          rows={3}
          data-testid="artifact-instruction"
        />

        <p className="text-xs text-muted-foreground">
          {hasContext
            ? t('artifacts.contextSummary', { sources: includedSources, notes: includedNotes })
            : t('artifacts.emptyContext')}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generate.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!hasContext || generate.isPending} data-testid="artifact-generate">
            {generate.isPending ? (
              <>
                <LoadingSpinner size="sm" className="mr-2" />
                {t('artifacts.generating')}
              </>
            ) : (
              t('artifacts.generate')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

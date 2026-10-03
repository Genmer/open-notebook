'use client'

import { useState } from 'react'
import { NotebookResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { InlineEdit } from '@/components/common/InlineEdit'
import { useTranslation } from '@/lib/hooks/use-translation'

interface NotebookHeaderProps {
  notebook: NotebookResponse
}

// Compact single-line header: name + inline description + meta + icon actions.
// The workspace columns below need the vertical space far more than this bar
// needs to announce itself — it shrinks from the old ~150px block to ~44px.
export function NotebookHeader({ notebook }: NotebookHeaderProps) {
  const { t, language } = useTranslation()
  const dfLocale = getDateLocale(language)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const updateNotebook = useUpdateNotebook()

  const handleUpdateName = async (name: string) => {
    if (!name || name === notebook.name) return

    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { name }
    })
  }

  const handleUpdateDescription = async (description: string) => {
    if (description === notebook.description) return

    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { description: description || undefined }
    })
  }

  const handleArchiveToggle = () => {
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived }
    })
  }

  const updatedText = formatDistanceToNow(new Date(notebook.updated), {
    addSuffix: true,
    locale: dfLocale
  })
  const createdText = formatDistanceToNow(new Date(notebook.created), {
    addSuffix: true,
    locale: dfLocale
  })

  return (
    <>
      <div className="border-b px-6 py-2">
        <div className="flex min-h-8 items-center gap-2.5">
          <InlineEdit
            id="notebook-name"
            name="notebook-name"
            value={notebook.name}
            onSave={handleUpdateName}
            className="font-display text-lg font-bold leading-tight tracking-tight"
            inputClassName="font-display text-lg font-bold leading-tight tracking-tight"
            placeholder={t('notebooks.namePlaceholder')}
          />
          {notebook.archived && (
            <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px] font-normal">
              {t('notebooks.archived')}
            </Badge>
          )}
          <span aria-hidden className="hidden shrink-0 text-muted-foreground/40 md:inline">
            |
          </span>
          <InlineEdit
            id="notebook-description"
            name="notebook-description"
            value={notebook.description || ''}
            onSave={handleUpdateDescription}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            inputClassName="text-xs text-muted-foreground"
            placeholder={t('notebooks.addDescription')}
            emptyText={t('notebooks.addDescription')}
          />
          <span
            className="hidden shrink-0 text-[11px] text-muted-foreground/70 lg:inline"
            title={`${t('common.created', { time: createdText })} · ${t('common.updated', { time: updatedText })}`}
          >
            {t('common.updated', { time: updatedText })}
          </span>
          <div className="flex shrink-0 gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={handleArchiveToggle}
              aria-label={notebook.archived ? t('notebooks.unarchive') : t('notebooks.archive')}
              title={notebook.archived ? t('notebooks.unarchive') : t('notebooks.archive')}
            >
              {notebook.archived ? (
                <ArchiveRestore className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => setShowDeleteDialog(true)}
              aria-label={t('common.delete')}
              title={t('common.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
        redirectAfterDelete
      />
    </>
  )
}

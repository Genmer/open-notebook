'use client'

import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SourceDetailContent } from './SourceDetailContent'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceId: string | null
  /** Notebook context from the ?nb= URL param (AI save chains); optional. */
  notebookId?: string
  /** Citation quote from the ?cite= URL param — the reader locates and
   * highlights this passage (deep citation jumps). */
  citeQuote?: string
}

/**
 * Source Dialog Component
 *
 * Displays source details in a modal dialog.
 * Includes a "Chat with source" button that navigates to the full source page in-app.
 */
export function SourceDialog({ open, onOpenChange, sourceId, notebookId, citeQuote }: SourceDialogProps) {
  const { t } = useTranslation()
  const router = useRouter()
  // Ensure source ID has 'source:' prefix for API calls and routing
  const sourceIdWithPrefix = sourceId
    ? (sourceId.includes(':') ? sourceId : `source:${sourceId}`)
    : null

  const handleChatClick = () => {
    if (sourceIdWithPrefix) {
      onOpenChange(false)
      router.push(`/sources/${sourceIdWithPrefix}`)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  if (!sourceIdWithPrefix) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col p-0">
        {/* Accessibility title (hidden visually but read by screen readers) */}
        <DialogTitle className="sr-only">{t('sources.detailsTitle')}</DialogTitle>

        {/* Source detail content */}
        <div className="flex-1 overflow-y-auto min-h-0 p-6">
          <SourceDetailContent
            sourceId={sourceIdWithPrefix}
            showChatButton={true}
            onChatClick={handleChatClick}
            onClose={handleClose}
            notebookId={notebookId}
            citeQuote={citeQuote}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { NoteEditorDialog } from '@/app/(dashboard)/notebooks/components/NoteEditorDialog'
import { SourceInsightDialog } from '@/components/sources/SourceInsightDialog'
import { SourceDialog } from '@/components/sources/SourceDialog'

/**
 * Modal Provider Component
 *
 * Renders modals based on URL query parameters (?modal=type&id=xxx)
 * Manages modal state through the useModalManager hook
 *
 * Supported modal types:
 * - source: Source detail modal
 * - note: Note editor modal
 * - insight: Source insight modal
 */
export function ModalProvider() {
  const { modalType, modalId, closeModal, notebookId, citeQuote } = useModalManager()

  return (
    <>
      {/* Source Modal */}
      <SourceDialog
        open={modalType === 'source'}
        onOpenChange={(open) => {
          if (!open) closeModal()
        }}
        sourceId={modalId}
        // Notebook context carried by the ?nb= param (set by openModal's
        // third argument); undefined keeps classic two-arg behavior.
        notebookId={notebookId}
        citeQuote={citeQuote}
      />

      {/* Note Modal */}
      <NoteEditorDialog
        open={modalType === 'note'}
        onOpenChange={(open) => {
          if (!open) closeModal()
        }}
        notebookId="" // Will need to be fetched or handled in Phase 9
        note={modalId ? { id: modalId, title: null, content: null } : undefined}
      />

      {/* Source Insight Modal */}
      <SourceInsightDialog
        open={modalType === 'insight'}
        onOpenChange={(open) => {
          if (!open) closeModal()
        }}
        insight={modalId ? { id: modalId, insight_type: '', content: '' } : undefined}
      />
    </>
  )
}

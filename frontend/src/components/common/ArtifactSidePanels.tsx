'use client'

import type { ReactNode } from 'react'
import { FileText, Link2, X, Bot, User, StickyNote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useSources } from '@/lib/hooks/use-sources'
import type { NoteResponse } from '@/lib/types/api'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { cn } from '@/lib/utils'

interface ArtifactSidePanelsProps {
  /** Notebook whose sources/notes fill the panels; without it sources stay empty. */
  notebookId?: string
  /** Notes shown in the right panel; rendered only when rightOpen. */
  notes?: NoteResponse[]
  /** Note currently open in the reading dialog (highlighted in the list). */
  activeNoteId?: string | null
  leftOpen: boolean
  rightOpen: boolean
  onLeftOpenChange: (open: boolean) => void
  onRightOpenChange: (open: boolean) => void
  /** Exit fullscreen entirely (header shortcut in each panel). */
  onExitFullscreen: () => void
  /** Open a source's detail modal. */
  onOpenSource?: (sourceId: string) => void
  /** Switch the reading dialog to another note. */
  onNoteSelect?: (note: NoteResponse) => void
  /** Custom left/right panel content. When provided, the default lite list is
   *  replaced by this node (e.g. the real workspace column component, which
   *  renders its own header) above a slim close/exit toolbar. */
  leftPanel?: ReactNode
  rightPanel?: ReactNode
}

/**
 * Fullscreen reading slide-overs for ArtifactViewDialog: a sources list on
 * the left, a notes list on the right — or the real workspace columns when
 * `leftPanel`/`rightPanel` slots are used (same look as the notebook page).
 *
 * These are hand-rolled `absolute` panels (NOT a Radix Sheet/Dialog): they
 * must render INSIDE the fullscreen Card/DialogContent so the reading area
 * stays interactive — a modal portal would lock it behind an overlay, and
 * `fixed` positioning breaks under the Dialog's transform ancestor. Inner
 * scrolling is a plain div (no Radix ScrollArea — its display:table wrapper
 * has a history of overflowing column widths).
 */
export function ArtifactSidePanels({
  notebookId,
  notes = [],
  activeNoteId,
  leftOpen,
  rightOpen,
  onLeftOpenChange,
  onRightOpenChange,
  onExitFullscreen,
  onOpenSource,
  onNoteSelect,
  leftPanel,
  rightPanel,
}: ArtifactSidePanelsProps) {
  const { t, language } = useTranslation()
  // Direct connection to the notebook's sources cache (same key/queryFn as
  // the rest of the app — no new cache entries).
  const { data: sources = [] } = useSources(notebookId)

  // Slim toolbar above slotted content: exit fullscreen + close only (the
  // embedded column carries its own title header).
  const slotToolbar = (onClose: () => void) => (
    <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b bg-card/95 px-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground"
        onClick={onExitFullscreen}
        aria-label={t('artifacts.exitFullscreen')}
        title={t('artifacts.exitFullscreen')}
      >
        <X className="h-3.5 w-3.5 rotate-45" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground"
        onClick={onClose}
        aria-label={t('artifacts.closePanel')}
        title={t('artifacts.closePanel')}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  return (
    <>
      {/* Left: sources of the notebook (or a slotted workspace column) */}
      {leftOpen && (
        <aside
          className="absolute inset-y-0 left-0 z-20 flex w-96 max-w-[85vw] flex-col border-r bg-card shadow-overlay duration-300 animate-in slide-in-from-left"
          data-testid="artifact-panel-sources"
        >
          {leftPanel ? (
            <>
              {slotToolbar(() => onLeftOpenChange(false))}
              <div className="min-h-0 flex-1 overflow-hidden">{leftPanel}</div>
            </>
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between gap-1 border-b px-3">
                <span className="truncate text-xs font-semibold">{t('artifacts.sourcesPanelTitle')}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={onExitFullscreen}
                  >
                    {t('artifacts.exitFullscreen')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => onLeftOpenChange(false)}
                    aria-label={t('artifacts.closePanel')}
                    title={t('artifacts.closePanel')}
                    data-testid="artifact-panel-sources-close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {sources.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {t('artifacts.panelEmptySources')}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {sources.map((source) => {
                      const isLink = !!source.asset?.url
                      const Icon = isLink ? Link2 : FileText
                      return (
                        <li key={source.id}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[10px] leading-tight hover:bg-accent/50"
                            onClick={() => onOpenSource?.(source.id)}
                            title={source.title ?? undefined}
                            data-testid={`artifact-panel-source-${source.id}`}
                          >
                            <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">
                              {source.title || t('sources.untitledSource')}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </aside>
      )}

      {/* Right: notes of the notebook (or a slotted workspace column) */}
      {rightOpen && (
        <aside
          className="absolute inset-y-0 right-0 z-20 flex w-96 max-w-[85vw] flex-col border-l bg-card shadow-overlay duration-300 animate-in slide-in-from-right"
          data-testid="artifact-panel-notes"
        >
          {rightPanel ? (
            <>
              {slotToolbar(() => onRightOpenChange(false))}
              <div className="min-h-0 flex-1 overflow-hidden">{rightPanel}</div>
            </>
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between gap-1 border-b px-3">
                <span className="truncate text-sm font-semibold">{t('artifacts.notesPanelTitle')}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={onExitFullscreen}
                  >
                    {t('artifacts.exitFullscreen')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => onRightOpenChange(false)}
                    aria-label={t('artifacts.closePanel')}
                    title={t('artifacts.closePanel')}
                    data-testid="artifact-panel-notes-close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {notes.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {t('artifacts.panelEmptyNotes')}
                  </p>
                ) : (
                  notes.map((note) => {
                    const Icon = note.note_type === 'ai' ? Bot : note.note_type === 'human' ? User : StickyNote
                    return (
                      <button
                        key={note.id}
                        type="button"
                        className={cn(
                          'block w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                          note.id === activeNoteId
                            ? 'border-primary/50 bg-primary/5'
                            : 'border-transparent hover:bg-accent/50'
                        )}
                        onClick={() => onNoteSelect?.(note)}
                        data-testid={`artifact-panel-note-${note.id}`}
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs font-semibold">
                            {note.title || t('notes.untitledNote')}
                          </span>
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">
                          {note.content || ''}
                        </span>
                        <span className="mt-1 block text-[10px] text-muted-foreground/70">
                          {formatDistanceToNow(new Date(note.updated), {
                            addSuffix: true,
                            locale: getDateLocale(language),
                          })}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          )}
        </aside>
      )}
    </>
  )
}

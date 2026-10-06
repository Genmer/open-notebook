'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Lock, Trash2, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { segmentStyle } from '@/components/common/ContextBreakdownBar'
import type {
  ContextBreakdown,
  ContextBreakdownHistoryItem,
  ContextBreakdownSegment,
  ContextBreakdownSourceItem,
  ContextBreakdownNoteItem,
  ContextSegmentKey,
  NotebookChatMessage,
} from '@/lib/types/api'
import type { ContextMode, NoteContextMode } from '@/lib/types/notebook-context'

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested alongside the component)
// ---------------------------------------------------------------------------

/** The segment with the given key, or undefined. */
export function findSegment(
  breakdown: ContextBreakdown | null,
  key: ContextSegmentKey,
): ContextBreakdownSegment | undefined {
  return breakdown?.segments?.find(segment => segment.key === key)
}

/** Front-of-string excerpt used by history rows and the delete confirmation. */
export function excerpt(text: string, max = 80): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** Locale badge key for a backend mode string; null → no badge rendered. */
export function modeBadgeKey(mode?: string | null): string | null {
  if (mode === 'full content') return 'common.contextModes.full'
  if (mode === 'insights') return 'common.contextModes.insights'
  return null
}

function isHistoryItem(
  item: ContextBreakdownHistoryItem | ContextBreakdownSourceItem | ContextBreakdownNoteItem,
): item is ContextBreakdownHistoryItem {
  return 'message_id' in item
}

/** Thousands-separated char count for the detail rows. */
export function formatChars(value: number): string {
  return value.toLocaleString()
}

/**
 * Content lookup for a history item. The breakdown contract carries only
 * message_id/role/chars/percent, so the excerpt comes from the current
 * session's message list (matched by id); ids the list does not know (e.g.
 * deleted out-of-band) fall back to the id itself.
 */
export function historyItemExcerpt(
  item: ContextBreakdownHistoryItem,
  messages: NotebookChatMessage[],
  max = 80,
): string {
  const content = messages.find(message => message.id === item.message_id)?.content
  return excerpt(content ?? item.message_id, max)
}

// ---------------------------------------------------------------------------

interface ContextBreakdownDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  breakdown: ContextBreakdown | null
  /** Current session messages — excerpt source for history rows. */
  messages?: NotebookChatMessage[]
  /** Streaming / parallel-answers running: every destructive entry disables. */
  editLocked?: boolean
  /** Mutation in flight — drives the confirm dialogs' spinner state. */
  isMutating?: boolean
  onRemoveMessages?: (messageIds: string[]) => void
  onClearMessages?: () => void
  onSourceModeChange?: (sourceId: string, mode: ContextMode) => void
  onNoteModeChange?: (noteId: string, mode: NoteContextMode) => void
  /** Opens the existing context picker ("manage sources & notes"). */
  onOpenContextPicker?: () => void
}

/**
 * Detail dialog behind the composition bar: the four segments with per-item
 * chars/percent, and the per-segment editing entries — delete a history
 * message, clear the history, drop a source/note from the context (delegating
 * to the same mode-change handlers the sources/notes columns use), and jump
 * to the existing context picker.
 */
export function ContextBreakdownDialog({
  open,
  onOpenChange,
  breakdown,
  messages = [],
  editLocked = false,
  isMutating = false,
  onRemoveMessages,
  onClearMessages,
  onSourceModeChange,
  onNoteModeChange,
  onOpenContextPicker,
}: ContextBreakdownDialogProps) {
  const { t } = useTranslation()
  // One pending item at a time backs both the row button and its confirm.
  const [pendingMessage, setPendingMessage] = useState<ContextBreakdownHistoryItem | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const system = findSegment(breakdown, 'system_prompt')
  const history = findSegment(breakdown, 'history')
  const sources = findSegment(breakdown, 'sources')
  const notes = findSegment(breakdown, 'notes')

  const historyItems = (history?.items ?? []).filter(isHistoryItem)
  const sourceItems = (sources?.items ?? []) as ContextBreakdownSourceItem[]
  const noteItems = (notes?.items ?? []) as ContextBreakdownNoteItem[]
  const noContent = sourceItems.length === 0 && noteItems.length === 0
  const historyCount = history?.message_count ?? historyItems.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl h-[85vh] flex flex-col overflow-hidden"
        data-testid="context-breakdown-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('context.breakdownTitle')}</DialogTitle>
          <DialogDescription>
            {breakdown
              ? t('context.totalLine', {
                  chars: formatChars(breakdown.total_chars),
                  tokens: formatChars(breakdown.estimated_tokens),
                })
              : ''}
            <span className="mt-0.5 block text-xs font-normal">{t('context.estimateHint')}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Scroll constraint chain (AgentTemplatePickerDialog precedent):
            fixed dialog height + min-h-0 flex-1 + h-full ScrollArea, so the
            viewport height never depends on the content. */}
        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full pr-3">
            <div className="space-y-5 pr-1 pb-2">
              {noContent && (
                <p className="text-xs text-muted-foreground" data-testid="breakdown-empty-content">
                  {t('context.emptyBreakdown')}
                </p>
              )}

              {/* Fixed instructions — no editing entry by design */}
              {system && (
                <section data-testid="breakdown-section-system_prompt">
                  <SegmentHeader segment={system} icon={<Lock className="h-3.5 w-3.5" />} />
                  <p className="mt-1 text-xs text-muted-foreground">{t('context.segmentSystemHint')}</p>
                </section>
              )}

              {/* History messages */}
              <section data-testid="breakdown-section-history">
                <div className="flex items-center justify-between gap-2">
                  <SegmentHeader segment={history ?? { key: 'history', chars: 0, percent: 0 }} />
                  {historyItems.length > 0 && onClearMessages && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                      disabled={editLocked || isMutating}
                      onClick={() => setClearConfirmOpen(true)}
                      data-testid="breakdown-clear-history"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('context.clearHistory')}
                    </Button>
                  )}
                </div>
                {historyItems.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t('context.historyEmpty')}</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {historyItems.map(item => {
                      const rowExcerpt = historyItemExcerpt(item, messages)
                      return (
                        <li
                          key={item.message_id}
                          className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs"
                          data-testid={`breakdown-message-${item.message_id}`}
                        >
                          <Badge variant="outline" className="flex-shrink-0 px-1.5 py-0 text-[10px]">
                            {item.role === 'human' ? t('context.roleUser') : t('context.roleAssistant')}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={rowExcerpt}>
                            {rowExcerpt}
                          </span>
                          <span className="flex-shrink-0 text-muted-foreground">
                            {t('context.itemChars', { chars: formatChars(item.chars) })}
                            {' · '}
                            {t('context.itemPercent', { percent: item.percent })}
                          </span>
                          {onRemoveMessages && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
                              disabled={editLocked || isMutating}
                              onClick={() => setPendingMessage(item)}
                              aria-label={t('context.deleteMessage')}
                              title={t('context.deleteMessage')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {/* Sources */}
              <section data-testid="breakdown-section-sources">
                <SegmentHeader segment={sources ?? { key: 'sources', chars: 0, percent: 0 }} />
                {sourceItems.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t('context.sourcesEmpty')}</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {sourceItems.map(item => (
                      <ContextItemRow
                        key={item.id}
                        title={item.title}
                        chars={item.chars}
                        percent={item.percent}
                        modeBadge={modeBadgeKey(item.mode)}
                        actionLabel={t('context.removeItem')}
                        onRemove={onSourceModeChange ? () => onSourceModeChange(item.id, 'off') : undefined}
                        disabled={editLocked || isMutating}
                      />
                    ))}
                  </ul>
                )}
                {/* Entry always present when the picker is wired up — the
                    empty state is exactly when users re-include sources. */}
                {onOpenContextPicker && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full gap-1.5 text-xs"
                    onClick={onOpenContextPicker}
                    data-testid="breakdown-manage-sources"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {t('context.manageSources')}
                  </Button>
                )}
              </section>

              {/* Notes */}
              <section data-testid="breakdown-section-notes">
                <SegmentHeader segment={notes ?? { key: 'notes', chars: 0, percent: 0 }} />
                {noteItems.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t('context.notesEmpty')}</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {noteItems.map(item => (
                      <ContextItemRow
                        key={item.id}
                        title={item.title}
                        chars={item.chars}
                        percent={item.percent}
                        actionLabel={t('context.removeItem')}
                        onRemove={onNoteModeChange ? () => onNoteModeChange(item.id, 'off') : undefined}
                        disabled={editLocked || isMutating}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </ScrollArea>
        </div>

        {/* Clear the whole history (destructive) */}
        <ConfirmDialog
          open={clearConfirmOpen}
          onOpenChange={setClearConfirmOpen}
          title={t('context.clearHistory')}
          description={t('context.clearHistoryDesc', { count: historyCount })}
          confirmVariant="destructive"
          isLoading={isMutating}
          onConfirm={() => {
            onClearMessages?.()
            setClearConfirmOpen(false)
          }}
        />

        {/* Delete one history message (destructive, excerpt in the copy) */}
        <ConfirmDialog
          open={!!pendingMessage}
          onOpenChange={(next) => { if (!next) setPendingMessage(null) }}
          title={t('context.deleteMessage')}
          description={t('context.deleteMessageDesc', {
            excerpt: pendingMessage ? historyItemExcerpt(pendingMessage, messages, 30) : '',
          })}
          confirmVariant="destructive"
          isLoading={isMutating}
          onConfirm={() => {
            if (pendingMessage) onRemoveMessages?.([pendingMessage.message_id])
            setPendingMessage(null)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Segment title + chars/percent share line. */
function SegmentHeader({ segment, icon }: { segment: ContextBreakdownSegment; icon?: React.ReactNode }) {
  const { t } = useTranslation()
  const style = segmentStyle(segment.key)
  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', style.barClass)} />
      <span className="flex items-center gap-1 text-foreground">
        {icon}
        {t(style.labelKey)}
      </span>
      <span className="text-muted-foreground">
        {t('context.itemChars', { chars: formatChars(segment.chars) })}
        {' · '}
        {t('context.itemPercent', { percent: segment.percent })}
      </span>
    </div>
  )
}

/** One source/note row: title, optional mode badge, share, remove entry. */
function ContextItemRow({
  title,
  chars,
  percent,
  modeBadge,
  actionLabel,
  onRemove,
  disabled,
}: {
  title: string
  chars: number
  percent: number
  modeBadge?: string | null
  actionLabel: string
  onRemove?: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title || '—'}
      </span>
      {modeBadge && (
        <Badge variant="outline" className="flex-shrink-0 px-1.5 py-0 text-[10px]">
          {t(modeBadge)}
        </Badge>
      )}
      <span className="flex-shrink-0 text-muted-foreground">
        {t('context.itemChars', { chars: formatChars(chars) })}
        {' · '}
        {t('context.itemPercent', { percent })}
      </span>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
          disabled={disabled}
          onClick={onRemove}
          aria-label={actionLabel}
          title={actionLabel}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  )
}

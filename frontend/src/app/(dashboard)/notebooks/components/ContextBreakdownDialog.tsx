'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { isSameDay, isSameWeek, subDays } from 'date-fns'
import type { Locale } from 'date-fns'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Lock, Trash2, SlidersHorizontal, Loader2, FoldVertical, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { segmentStyle } from '@/components/common/ContextBreakdownBar'
import type {
  ContextBreakdown,
  ContextBreakdownHistoryItem,
  ContextBreakdownSegment,
  ContextBreakdownSourceItem,
  ContextBreakdownNoteItem,
  ContextSegmentKey,
  NotebookChatMessage,
  ChatTopicClassification,
  ChatTopicGroup,
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

/** Calendar buckets of the "by time" history view, in fixed render order. */
export type HistoryTimeBucket = 'today' | 'yesterday' | 'thisWeek' | 'earlier' | 'unknown'

/** One non-empty bucket of the "by time" view; items keep their order. */
export interface HistoryTimeGroup {
  bucket: HistoryTimeBucket
  items: ContextBreakdownHistoryItem[]
}

/** Fixed bucket order; unknown is always last so legacy rows sink to the end. */
const TIME_BUCKET_ORDER: HistoryTimeBucket[] = [
  'today',
  'yesterday',
  'thisWeek',
  'earlier',
  'unknown',
]

/** i18n keys for the bucket headers (referenced from source, so the unused
 * key gate stays green). */
export const HISTORY_TIME_BUCKET_LABEL_KEYS: Record<HistoryTimeBucket, string> = {
  today: 'context.timeToday',
  yesterday: 'context.timeYesterday',
  thisWeek: 'context.timeThisWeek',
  earlier: 'context.timeEarlier',
  unknown: 'context.timeUnknown',
}

/**
 * Timestamp of the session message a breakdown item points at. The breakdown
 * contract carries no time field, so it is matched by id from the current
 * session's messages (same lookup as historyItemExcerpt). Missing or
 * non-string timestamps (legacy checkpoints) yield null.
 */
export function messageTimestampById(
  item: ContextBreakdownHistoryItem,
  messages: NotebookChatMessage[],
): string | null {
  const timestamp = messages.find(message => message.id === item.message_id)?.timestamp
  return typeof timestamp === 'string' && timestamp.trim() ? timestamp : null
}

/**
 * Calendar bucket for one timestamp, computed in viewer-local time. "This
 * week" is the natural week containing now, with the week start taken from
 * the date-fns locale (matching the app's date rendering). Unparseable input
 * lands in the unknown bucket instead of throwing.
 */
export function historyTimeBucket(
  timestamp: string | null,
  now: Date,
  locale?: Locale,
): HistoryTimeBucket {
  if (!timestamp) return 'unknown'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'unknown'
  if (isSameDay(date, now)) return 'today'
  if (isSameDay(date, subDays(now, 1))) return 'yesterday'
  if (isSameWeek(date, now, locale ? { locale } : undefined)) return 'thisWeek'
  return 'earlier'
}

/**
 * Group history items into calendar buckets for the "by time" view. Buckets
 * render in fixed order (unknown last) and empty buckets are dropped, so a
 * group header only appears when it has rows.
 */
export function groupHistoryByTime(
  items: ContextBreakdownHistoryItem[],
  messages: NotebookChatMessage[],
  now: Date = new Date(),
  locale?: Locale,
): HistoryTimeGroup[] {
  const byBucket = new Map<HistoryTimeBucket, ContextBreakdownHistoryItem[]>()
  for (const item of items) {
    const bucket = historyTimeBucket(messageTimestampById(item, messages), now, locale)
    const bucketItems = byBucket.get(bucket)
    if (bucketItems) bucketItems.push(item)
    else byBucket.set(bucket, [item])
  }
  return TIME_BUCKET_ORDER.flatMap(bucket => {
    const bucketItems = byBucket.get(bucket)
    return bucketItems && bucketItems.length > 0 ? [{ bucket, items: bucketItems }] : []
  })
}

/** One rendered topic group of the "by topic" view. */
export interface TopicViewGroup {
  name: string
  items: ContextBreakdownHistoryItem[]
}

/** Grouped + leftover items of the "by topic" view for one classification. */
export interface TopicView {
  groups: TopicViewGroup[]
  ungrouped: ContextBreakdownHistoryItem[]
}

/**
 * Fit a stored classification onto the current history items: ids that are
 * gone (deleted, compressed away, never existed) disappear, an id claimed by
 * two groups stays in the first one, and everything the groups do not cover
 * comes back as `ungrouped` (rendered as the trailing group).
 */
export function assignTopicGroups(
  groups: ChatTopicGroup[] | null | undefined,
  items: ContextBreakdownHistoryItem[],
): TopicView {
  if (!groups || groups.length === 0) return { groups: [], ungrouped: items }
  const byId = new Map(items.map(item => [item.message_id, item]))
  const assigned = new Set<string>()
  const rendered: TopicViewGroup[] = []
  for (const group of groups) {
    const groupItems: ContextBreakdownHistoryItem[] = []
    for (const id of group.message_ids) {
      const item = byId.get(id)
      if (!item || assigned.has(id)) continue
      assigned.add(id)
      groupItems.push(item)
    }
    // The backend never emits empty groups; the guard keeps arbitrary
    // payloads from rendering a header without rows.
    if (groupItems.length > 0) rendered.push({ name: group.name, items: groupItems })
  }
  return { groups: rendered, ungrouped: items.filter(item => !assigned.has(item.message_id)) }
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
  /** Submits the async compression job for the selected ids. The caller's
   * hook owns submit, polling and the post-completion cache refreshes. */
  onCompressMessages?: (messageIds: string[]) => void
  /** Runs the AI topic classification; resolves with the result, or null on
   * failure (the error toast happens in the caller's mutation). */
  onClassifyTopics?: () => Promise<ChatTopicClassification | null>
  /** Compression job in flight — locks every destructive entry and spins the
   * compress buttons. */
  isCompressing?: boolean
  /** Topic classification request in flight. */
  isClassifying?: boolean
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
  onCompressMessages,
  onClassifyTopics,
  isCompressing = false,
  isClassifying = false,
  onClearMessages,
  onSourceModeChange,
  onNoteModeChange,
  onOpenContextPicker,
}: ContextBreakdownDialogProps) {
  const { t, language } = useTranslation()
  // One pending item at a time backs both the row button and its confirm.
  const [pendingMessage, setPendingMessage] = useState<ContextBreakdownHistoryItem | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  // History view: flat list, calendar-time groups or AI topic groups.
  const [historyView, setHistoryView] = useState<'flat' | 'time' | 'topic'>('flat')
  // Batch selection, keyed by message_id so it survives view switches.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false)
  const [compressConfirmOpen, setCompressConfirmOpen] = useState(false)
  // Cached classification for this dialog open; null = not run yet, which is
  // what keeps the "classify with AI" entry visible (no accidental spend).
  const [topicClassification, setTopicClassification] = useState<ChatTopicClassification | null>(null)

  const system = findSegment(breakdown, 'system_prompt')
  const history = findSegment(breakdown, 'history')
  const sources = findSegment(breakdown, 'sources')
  const notes = findSegment(breakdown, 'notes')

  // Memoized so the selection-pruning effect only reruns when the breakdown
  // actually changes, not on every render.
  const historyItems = useMemo(() => (history?.items ?? []).filter(isHistoryItem), [history])

  // Closing the dialog resets the per-open state (selection + cached topic
  // groups), while the view choice persists so a re-open does not jump the
  // user back to flat.
  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set())
      setTopicClassification(null)
    }
  }, [open])

  // Prune ids that vanished from the authoritative history list (failed batch
  // delete refetch, out-of-band clear) so the action bar never targets ids the
  // backend no longer knows.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev
      const live = new Set(historyItems.map(item => item.message_id))
      const next = new Set([...prev].filter(id => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [historyItems])

  // Compression in flight locks the dialog's destructive surface too (the
  // originals are about to be rewritten worker-side).
  const destructiveLocked = editLocked || isMutating || isCompressing
  const selectionDisabled = destructiveLocked
  const selectedCount = selectedIds.size
  const selectedChars = useMemo(
    () => historyItems.reduce((sum, item) => (selectedIds.has(item.message_id) ? sum + item.chars : sum), 0),
    [historyItems, selectedIds]
  )

  const timeGroups = useMemo(
    () =>
      historyView === 'time'
        ? groupHistoryByTime(historyItems, messages, new Date(), getDateLocale(language))
        : [],
    [historyView, historyItems, messages, language]
  )

  // Classification fitted onto the *current* items, so ids that vanished
  // (deletion, compression) drop out of their groups without invalidating
  // the cached classification itself.
  const topicView = useMemo(
    () => assignTopicGroups(topicClassification?.groups ?? null, historyItems),
    [topicClassification, historyItems]
  )

  const handleClassify = async () => {
    if (!onClassifyTopics) return
    const result = await onClassifyTopics()
    if (result) setTopicClassification(result)
  }

  const toggleMessageSelected = (messageId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(messageId)
      else next.delete(messageId)
      return next
    })
  }

  const toggleGroupSelected = (messageIds: string[], checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of messageIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  /** Tri-state for a group header checkbox: all / none / partial. */
  const groupCheckedState = (groupItems: ContextBreakdownHistoryItem[]): boolean | 'indeterminate' => {
    const selected = groupItems.filter(item => selectedIds.has(item.message_id)).length
    if (selected === 0) return false
    if (selected === groupItems.length) return true
    return 'indeterminate'
  }
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
                      disabled={destructiveLocked}
                      onClick={() => setClearConfirmOpen(true)}
                      data-testid="breakdown-clear-history"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('context.clearHistory')}
                    </Button>
                  )}
                </div>
                {historyItems.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {/* Flat / grouped-by-time / grouped-by-topic switch
                        (view-toggle precedent: notebooks page tile/list
                        buttons). */}
                    <div
                      className="flex items-center rounded-md border p-0.5"
                      data-testid="breakdown-history-view-toggle"
                    >
                      <Button
                        variant={historyView === 'flat' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setHistoryView('flat')}
                        aria-pressed={historyView === 'flat'}
                        data-testid="breakdown-history-view-flat"
                      >
                        {t('context.historyViewFlat')}
                      </Button>
                      <Button
                        variant={historyView === 'time' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setHistoryView('time')}
                        aria-pressed={historyView === 'time'}
                        data-testid="breakdown-history-view-time"
                      >
                        {t('context.historyViewTime')}
                      </Button>
                      {/* Topic grouping needs its handler; without one the
                          entry would only ever dead-end. */}
                      {onClassifyTopics && (
                        <Button
                          variant={historyView === 'topic' ? 'secondary' : 'ghost'}
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => setHistoryView('topic')}
                          aria-pressed={historyView === 'topic'}
                          data-testid="breakdown-history-view-topic"
                        >
                          {t('context.historyViewTopic')}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {selectedCount > 0 && (
                  <div
                    className="mt-1.5 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5"
                    data-testid="breakdown-selected-bar"
                  >
                    <span className="text-xs text-muted-foreground">
                      {t('context.selectedCount', { count: selectedCount })}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {/* Merging needs at least two messages; the whole bar
                          locks while anything destructive is in flight. */}
                      {onCompressMessages && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={selectionDisabled || selectedCount < 2}
                          onClick={() => setCompressConfirmOpen(true)}
                          data-testid="breakdown-compress-selected"
                        >
                          {isCompressing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FoldVertical className="h-3 w-3" />
                          )}
                          {t('context.compressSelected')}
                        </Button>
                      )}
                      {onRemoveMessages && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={selectionDisabled}
                          onClick={() => setDeleteSelectedConfirmOpen(true)}
                          data-testid="breakdown-delete-selected"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('context.deleteSelected')}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {historyItems.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t('context.historyEmpty')}</p>
                ) : historyView === 'time' ? (
                  <ul className="mt-2 space-y-1.5">
                    {timeGroups.map(group => (
                      <Fragment key={group.bucket}>
                        <li
                          className="flex items-center gap-2 pt-2 text-xs"
                          data-testid={`breakdown-time-group-${group.bucket}`}
                        >
                          <Checkbox
                            checked={groupCheckedState(group.items)}
                            disabled={selectionDisabled}
                            onCheckedChange={next =>
                              toggleGroupSelected(
                                group.items.map(item => item.message_id),
                                next === true
                              )
                            }
                            aria-label={t('context.selectGroup')}
                            data-testid={`breakdown-check-group-${group.bucket}`}
                            className="h-3.5 w-3.5 flex-shrink-0"
                          />
                          <span className="font-medium text-foreground">
                            {t(HISTORY_TIME_BUCKET_LABEL_KEYS[group.bucket])}
                          </span>
                          <span className="text-muted-foreground">({group.items.length})</span>
                        </li>
                        {group.items.map(item => (
                          <HistoryMessageRow
                            key={item.message_id}
                            item={item}
                            messages={messages}
                            checked={selectedIds.has(item.message_id)}
                            checkDisabled={selectionDisabled}
                            onToggleCheck={toggleMessageSelected}
                            deleteDisabled={destructiveLocked}
                            onDelete={onRemoveMessages ? () => setPendingMessage(item) : undefined}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </ul>
                ) : historyView === 'topic' ? (
                  topicClassification ? (
                    <div className="mt-2">
                      {/* Only the earliest N messages were classified */}
                      {topicClassification.truncated && (
                        <p
                          className="mb-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
                          data-testid="breakdown-topic-truncated"
                        >
                          {t('context.classifyTruncated', {
                            count: topicClassification.classified_messages,
                          })}
                        </p>
                      )}
                      <ul className="space-y-1.5">
                        {topicView.groups.map((group, index) => (
                          <Fragment key={`${group.name}-${index}`}>
                            <li
                              className="flex items-center gap-2 pt-2 text-xs"
                              data-testid={`breakdown-topic-group-${index}`}
                            >
                              <Checkbox
                                checked={groupCheckedState(group.items)}
                                disabled={selectionDisabled}
                                onCheckedChange={next =>
                                  toggleGroupSelected(
                                    group.items.map(item => item.message_id),
                                    next === true
                                  )
                                }
                                aria-label={t('context.selectGroup')}
                                data-testid={`breakdown-check-group-topic-${index}`}
                                className="h-3.5 w-3.5 flex-shrink-0"
                              />
                              <span className="font-medium text-foreground">{group.name}</span>
                              <span className="text-muted-foreground">({group.items.length})</span>
                            </li>
                            {group.items.map(item => (
                              <HistoryMessageRow
                                key={item.message_id}
                                item={item}
                                messages={messages}
                                checked={selectedIds.has(item.message_id)}
                                checkDisabled={selectionDisabled}
                                onToggleCheck={toggleMessageSelected}
                                deleteDisabled={destructiveLocked}
                                onDelete={onRemoveMessages ? () => setPendingMessage(item) : undefined}
                              />
                            ))}
                          </Fragment>
                        ))}
                        {topicView.ungrouped.length > 0 && (
                          <Fragment>
                            <li
                              className="flex items-center gap-2 pt-2 text-xs"
                              data-testid="breakdown-topic-group-ungrouped"
                            >
                              <Checkbox
                                checked={groupCheckedState(topicView.ungrouped)}
                                disabled={selectionDisabled}
                                onCheckedChange={next =>
                                  toggleGroupSelected(
                                    topicView.ungrouped.map(item => item.message_id),
                                    next === true
                                  )
                                }
                                aria-label={t('context.selectGroup')}
                                data-testid="breakdown-check-group-topic-ungrouped"
                                className="h-3.5 w-3.5 flex-shrink-0"
                              />
                              <span className="font-medium text-foreground">
                                {t('context.ungrouped')}
                              </span>
                              <span className="text-muted-foreground">
                                ({topicView.ungrouped.length})
                              </span>
                            </li>
                            {topicView.ungrouped.map(item => (
                              <HistoryMessageRow
                                key={item.message_id}
                                item={item}
                                messages={messages}
                                checked={selectedIds.has(item.message_id)}
                                checkDisabled={selectionDisabled}
                                onToggleCheck={toggleMessageSelected}
                                deleteDisabled={destructiveLocked}
                                onDelete={onRemoveMessages ? () => setPendingMessage(item) : undefined}
                              />
                            ))}
                          </Fragment>
                        )}
                      </ul>
                    </div>
                  ) : (
                    /* First entry, nothing classified yet: explain + explicit
                       button so no LLM call fires by accident. */
                    <div
                      className="mt-2 rounded-md border bg-muted/30 px-3 py-3"
                      data-testid="breakdown-topic-empty"
                    >
                      <p className="text-xs text-muted-foreground">
                        {t('context.topicClassifyHint')}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-1.5 text-xs"
                        disabled={selectionDisabled || isClassifying}
                        onClick={handleClassify}
                        data-testid="breakdown-classify-topics"
                      >
                        {isClassifying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {t('context.classifyTopics')}
                      </Button>
                    </div>
                  )
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {historyItems.map(item => (
                      <HistoryMessageRow
                        key={item.message_id}
                        item={item}
                        messages={messages}
                        checked={selectedIds.has(item.message_id)}
                        checkDisabled={selectionDisabled}
                        onToggleCheck={toggleMessageSelected}
                        deleteDisabled={destructiveLocked}
                        onDelete={onRemoveMessages ? () => setPendingMessage(item) : undefined}
                      />
                    ))}
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

        {/* Delete the batch selection (destructive, count + approx chars in
            the copy). The ids go through the same bulk endpoint the single
            delete uses; the mutation already reconciles the checkpoint,
            invalidates the session caches and refreshes the breakdown. */}
        <ConfirmDialog
          open={deleteSelectedConfirmOpen}
          onOpenChange={setDeleteSelectedConfirmOpen}
          title={t('context.deleteSelected')}
          description={t('context.deleteSelectedDesc', {
            count: selectedCount,
            chars: formatChars(selectedChars),
          })}
          confirmVariant="destructive"
          isLoading={isMutating}
          onConfirm={() => {
            onRemoveMessages?.(Array.from(selectedIds))
            setSelectedIds(new Set())
            setDeleteSelectedConfirmOpen(false)
          }}
        />

        {/* Compress the batch selection into one summary message (destructive:
            once the worker-side job succeeds the originals are gone). The
            submit itself is cheap and irreversible only after the job lands;
            the hook polls and refreshes the caches either way. */}
        <ConfirmDialog
          open={compressConfirmOpen}
          onOpenChange={setCompressConfirmOpen}
          title={t('context.compressTitle')}
          description={t('context.compressDesc', { count: selectedCount })}
          confirmVariant="destructive"
          isLoading={isMutating || isCompressing}
          onConfirm={() => {
            onCompressMessages?.(Array.from(selectedIds))
            setSelectedIds(new Set())
            setCompressConfirmOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** One history message row: selection checkbox, role badge, excerpt, share,
 * single-delete entry. Shared by the flat view and every grouped view. */
function HistoryMessageRow({
  item,
  messages,
  checked,
  checkDisabled = false,
  onToggleCheck,
  deleteDisabled = false,
  onDelete,
}: {
  item: ContextBreakdownHistoryItem
  messages: NotebookChatMessage[]
  checked: boolean
  checkDisabled?: boolean
  onToggleCheck?: (messageId: string, checked: boolean) => void
  deleteDisabled?: boolean
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const rowExcerpt = historyItemExcerpt(item, messages)
  // A compression job's output message replaces the Assistant badge.
  const isSummary =
    messages.find(message => message.id === item.message_id)?.message_kind === 'summary'
  return (
    <li
      className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs"
      data-testid={`breakdown-message-${item.message_id}`}
    >
      {onToggleCheck && (
        <Checkbox
          checked={checked}
          disabled={checkDisabled}
          onCheckedChange={next => onToggleCheck(item.message_id, next === true)}
          aria-label={t('context.checkMessage')}
          data-testid={`breakdown-check-${item.message_id}`}
          className="h-3.5 w-3.5 flex-shrink-0"
        />
      )}
      <Badge variant="outline" className="flex-shrink-0 px-1.5 py-0 text-[10px]">
        {isSummary
          ? t('context.summaryBadge')
          : item.role === 'human'
            ? t('context.roleUser')
            : t('context.roleAssistant')}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={rowExcerpt}>
        {rowExcerpt}
      </span>
      <span className="flex-shrink-0 text-muted-foreground">
        {t('context.itemChars', { chars: formatChars(item.chars) })}
        {' · '}
        {t('context.itemPercent', { percent: item.percent })}
      </span>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
          disabled={deleteDisabled}
          onClick={onDelete}
          aria-label={t('context.deleteMessage')}
          title={t('context.deleteMessage')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
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

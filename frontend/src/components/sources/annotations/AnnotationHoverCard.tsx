'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Pencil, Trash2, Waves } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getDateLocale } from '@/lib/utils/date-locale'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  ANNOTATION_COLORS,
  sourceAnnotationsApi,
  type AnnotationColor,
  type SourceAnnotation,
  type SourceAnnotationPatch,
} from '@/lib/api/source-annotations'

/**
 * Controlled hover card for one annotation (plan §3.2 / §4.4), built on the
 * existing Radix Popover in controlled mode (PDR-003 ruling 10 — no new
 * hover-card dependency).
 *
 * ## Visibility protocol (parent-owned)
 *
 * `open` / `onOpenChange` are fully controlled. The open/close *delays* live
 * in the parent because both the underline and the card participate in the
 * hover choreography; use the exported `ANNOTATION_HOVER_TIMING` constants so
 * both sides agree:
 *
 *   underline onHover(id, rect)   → clear close timer; if closed, start
 *                                   `openDelayMs` timer → setOpen(true)
 *   underline onLeave(id)         → clear open timer; start `closeGraceMs`
 *                                   timer → setOpen(false)
 *   card onCardPointerEnter()     → clear close timer (grace: pointer is
 *                                   inside the card, don't dismiss)
 *   card onCardPointerLeave()     → start `closeGraceMs` timer → setOpen(false)
 *
 * Esc / outside click close the card directly through onOpenChange (Radix),
 * no delay. `defaultPinned` opens straight into the edit state for the
 * "underline click → pin" entry.
 *
 * ## Mutations
 *
 * The card performs its own API calls (update color/line style immediately,
 * commit the body on unpin, delete with an undo toast that re-creates the
 * annotation) and reports outcomes via `onUpdated` / `onDeleted` /
 * `onRestored` so the parent can refresh the per-page annotation list.
 */

/** Anchor rectangle in viewport (fixed) coordinates — e.g. `quadToDomRect()`
 * offset by the page wrapper's client rect. Only read at layout time. */
export interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

// Literal label-key map instead of a `colors.${color}` template literal so the
// locales unused-key gate sees every leaf key (cf. transformation-display.ts).
const COLOR_LABEL_KEYS: Record<AnnotationColor, string> = {
  gold: 'sources.annotations.colors.gold',
  fern: 'sources.annotations.colors.fern',
  plum: 'sources.annotations.colors.plum',
  slate: 'sources.annotations.colors.slate',
  clay: 'sources.annotations.colors.clay',
}

/** Hover-card timing protocol constants (plan §3.2, PDR-003 ruling 10).
 * Tunable range agreed as 100–400ms per the ruling. */
export const ANNOTATION_HOVER_TIMING = {
  /** Hovering the underline this long opens the card. */
  openDelayMs: 150,
  /** Grace period after leaving the underline/card before closing. */
  closeGraceMs: 300,
  /** How long the delete-undo toast stays on screen. */
  undoToastMs: 8000,
} as const

/** Body length cap (backend validates the same limit, plan §3.5). */
export const ANNOTATION_BODY_MAX_LENGTH = 4000

/** localStorage cache for annotation_settings color names (cache-only — the
 * server is the source of truth; key named independently to avoid collisions,
 * following the `auth-storage` / `theme-storage` convention). */
export const ANNOTATION_COLOR_NAMES_CACHE_KEY = 'annotation-color-names-storage'

function toDomRect(rect: AnchorRect): DOMRect {
  const { left, top, width, height } = rect
  return {
    x: left,
    y: top,
    top,
    left,
    bottom: top + height,
    right: left + width,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

function readCachedColorNames(): Partial<Record<AnnotationColor, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(ANNOTATION_COLOR_NAMES_CACHE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Partial<Record<AnnotationColor, string>>
  } catch {
    return {}
  }
}

export interface AnnotationHoverCardProps {
  /** The annotation shown — and edited while pinned. */
  annotation: SourceAnnotation
  /** Viewport-coordinate rect of the underline this card points at. */
  anchorRect: AnchorRect
  /** Controlled visibility (Radix Popover controlled pattern). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open directly in the pinned edit state (underline click → pin). */
  defaultPinned?: boolean
  /** Mirrors the internal pinned flag so the parent can exempt the pinned
   * card from the pointer-leave close grace (plan §3.7: a pinned card stays
   * up until Esc / outside click, not until the pointer wanders off). */
  onPinnedChange?: (pinned: boolean) => void
  /** Any successful update (color, line style, body). */
  onUpdated?: (annotation: SourceAnnotation) => void
  /** A successful delete. */
  onDeleted?: (annotation: SourceAnnotation) => void
  /** A successful undo-restore after delete (new record id). */
  onRestored?: (annotation: SourceAnnotation) => void
  /** Grace-protocol hooks — see the visibility protocol above. */
  onCardPointerEnter?: () => void
  onCardPointerLeave?: () => void
}

export default function AnnotationHoverCard({
  annotation,
  anchorRect,
  open,
  onOpenChange,
  defaultPinned = false,
  onPinnedChange,
  onUpdated,
  onDeleted,
  onRestored,
  onCardPointerEnter,
  onCardPointerLeave,
}: AnnotationHoverCardProps) {
  const { t, language } = useTranslation()
  const [pinned, setPinned] = useState(defaultPinned)
  const updatePinned = (next: boolean) => {
    setPinned(next)
    onPinnedChange?.(next)
  }
  const [bodyDraft, setBodyDraft] = useState(annotation.body ?? '')
  /** Optimistic overrides so the card reflects edits even before the parent
   * feeds the updated annotation back in; reset when the row changes. */
  const [overrides, setOverrides] = useState<{
    color?: AnnotationColor
    line_style?: SourceAnnotation['line_style']
  }>({})
  const [colorNames, setColorNames] = useState<Partial<Record<AnnotationColor, string>>>(() =>
    readCachedColorNames()
  )

  const currentColor = overrides.color ?? annotation.color
  const currentLineStyle = overrides.line_style ?? annotation.line_style
  const quote = annotation.quote ?? annotation.text_anchor?.quote ?? null

  // Re-seed edit state on reopen / annotation switch.
  useEffect(() => {
    // annotation.body intentionally absent: mid-edit refetches must not
    // clobber the textarea; the seed only runs per open/annotation switch.
    // No onPinnedChange here: the parent already set its mirror to
    // defaultPinned when it opened the card.
    if (open) {
      setPinned(defaultPinned)
      setBodyDraft(annotation.body ?? '')
      setOverrides({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, annotation.id, defaultPinned])

  // Drop optimistic overrides once the server state lands via props.
  useEffect(() => {
    setOverrides({})
  }, [annotation.id, annotation.updated])

  // Color semantics: cache-first paint, then refresh from annotation_settings.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setColorNames(readCachedColorNames())
    void (async () => {
      try {
        const settings = await sourceAnnotationsApi.getSettings()
        if (cancelled) return
        setColorNames(settings.color_names)
        try {
          window.localStorage.setItem(
            ANNOTATION_COLOR_NAMES_CACHE_KEY,
            JSON.stringify(settings.color_names)
          )
        } catch {
          // Quota/private-mode failures only cost the next paint a fetch.
        }
      } catch {
        // Offline or erroring API: keep the cache; names fall back to t().
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const colorName = (color: AnnotationColor) =>
    colorNames[color] || t(COLOR_LABEL_KEYS[color])

  const relativeTime = useMemo(() => {
    const date = new Date(annotation.created)
    if (Number.isNaN(date.getTime())) return ''
    return formatDistanceToNow(date, { addSuffix: true, locale: getDateLocale(language) })
  }, [annotation.created, language])

  // Virtual anchor: Radix measures on layout, so it always reads the latest
  // rect through the ref without re-creating the measurable object.
  const anchorRectRef = useRef(anchorRect)
  anchorRectRef.current = anchorRect
  const virtualAnchorRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => toDomRect(anchorRectRef.current),
  })

  const commitBody = async () => {
    // Unchanged draft (exact string match) → no write. A whitespace-only
    // draft persists as null, matching the backend's blank→None semantics.
    if (bodyDraft === (annotation.body ?? '')) return
    const next = bodyDraft.trim() ? bodyDraft : null
    try {
      const updated = await sourceAnnotationsApi.update(annotation.id, { body: next })
      onUpdated?.(updated)
    } catch {
      toast.error(t('sources.annotations.toast.updateFailed'))
    }
  }

  const patchAnnotation = async (patch: SourceAnnotationPatch) => {
    try {
      const updated = await sourceAnnotationsApi.update(annotation.id, patch)
      setOverrides((prev) => ({ ...prev, color: updated.color, line_style: updated.line_style }))
      onUpdated?.(updated)
    } catch {
      toast.error(t('sources.annotations.toast.updateFailed'))
    }
  }

  const handleDelete = async () => {
    try {
      await sourceAnnotationsApi.remove(annotation.id)
      onDeleted?.(annotation)
      onOpenChange(false)
      toast(t('sources.annotations.hover.deleted'), {
        duration: ANNOTATION_HOVER_TIMING.undoToastMs,
        action: {
          label: t('sources.annotations.hover.undo'),
          onClick: () => {
            void (async () => {
              try {
                const restored = await sourceAnnotationsApi.create({
                  source_id: annotation.source,
                  color: annotation.color,
                  line_style: annotation.line_style,
                  body: annotation.body,
                  quote: annotation.quote,
                  text_anchor: annotation.text_anchor,
                  pdf_anchor: annotation.pdf_anchor,
                })
                onRestored?.(restored)
              } catch {
                toast.error(t('sources.annotations.toast.restoreFailed'))
              }
            })()
          },
        },
      })
    } catch {
      toast.error(t('sources.annotations.toast.deleteFailed'))
    }
  }

  const handleOpenChange = (next: boolean) => {
    // Dismissed while editing: flush the body draft, then close.
    if (!next && pinned) {
      void commitBody()
      updatePinned(false)
    }
    onOpenChange(next)
  }

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (!pinned) return // preview: let Radix close via onOpenChange
    // Pinned: Esc collapses the edit state back to preview first (layered
    // exit, plan §3.7), saving the draft when it changed (plan §3.4-B).
    event.preventDefault()
    void commitBody()
    updatePinned(false)
  }

  // Entrance motion per §4.4: 150ms (--motion-base) fade + 2px rise. Set as
  // inline custom properties so they deterministically override the default
  // zoom/slide utilities baked into ui/popover.tsx.
  const enterMotionStyle = {
    '--tw-duration': 'var(--motion-base)',
    '--tw-enter-opacity': '0',
    '--tw-enter-translate-y': '2px',
    '--tw-enter-scale': '1',
  } as React.CSSProperties

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
        data-testid="annotation-hover-card"
        align="center"
        sideOffset={6}
        collisionPadding={8}
        aria-modal={false}
        className="relative w-80 p-3"
        style={enterMotionStyle}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={handleEscapeKeyDown}
        onPointerEnter={onCardPointerEnter}
        onPointerLeave={onCardPointerLeave}
      >
        {/* 3px full-height ink spine (annotation color) */}
        <span
          aria-hidden
          data-testid="annotation-hover-card-spine"
          className="absolute inset-y-0 left-0 w-[3px] rounded-l-md"
          style={{ backgroundColor: `var(--anno-${currentColor})` }}
        />

        <div className="pl-1">
          <div className="flex items-start justify-between gap-2">
            {!annotation.body && !pinned ? (
              // Pure highlight preview: enlarged color dot (Glasp-style
              // restraint, plan §3.2) — no body area is rendered at all.
              <span
                aria-hidden
                data-testid="annotation-hover-color-dot"
                className="mt-0.5 inline-block h-3.5 w-3.5 rounded-full"
                style={{ backgroundColor: `var(--anno-${currentColor})` }}
              />
            ) : (
              <span aria-hidden className="flex-1" />
            )}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                data-testid="annotation-hover-edit"
                aria-label={t('sources.annotations.hover.edit')}
                onClick={() => updatePinned(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                data-testid="annotation-hover-delete"
                aria-label={t('sources.annotations.hover.delete')}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {quote && (
            <blockquote
              data-testid="annotation-hover-quote"
              className="mt-1 line-clamp-2 rounded-sm bg-muted/50 p-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              {quote}
            </blockquote>
          )}

          {pinned ? (
            <>
              <Textarea
                data-testid="annotation-hover-body-input"
                className="mt-2 min-h-16 text-[13px]"
                maxLength={ANNOTATION_BODY_MAX_LENGTH}
                aria-label={t('sources.annotations.hover.edit')}
                value={bodyDraft}
                onChange={(event) => setBodyDraft(event.target.value)}
              />
              <div className="mt-2 flex items-center gap-1.5">
                {ANNOTATION_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    data-testid={`annotation-hover-color-${color}`}
                    aria-label={t('sources.annotations.toolbar.colorAria', {
                      name: colorName(color),
                    })}
                    aria-pressed={currentColor === color}
                    onClick={() => void patchAnnotation({ color })}
                    className={cn(
                      'h-4 w-4 rounded-full border border-black/10 transition-transform dark:border-white/10',
                      currentColor === color &&
                        'scale-125 ring-2 ring-ring ring-offset-2 ring-offset-popover'
                    )}
                    style={{ backgroundColor: `var(--anno-${color})` }}
                  />
                ))}
                <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  data-testid="annotation-hover-line-wavy"
                  aria-label={t('sources.annotations.toolbar.wavy')}
                  aria-pressed={currentLineStyle === 'wavy'}
                  onClick={() => void patchAnnotation({ line_style: 'wavy' })}
                >
                  <Waves className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  data-testid="annotation-hover-line-straight"
                  aria-label={t('sources.annotations.toolbar.straight')}
                  aria-pressed={currentLineStyle === 'straight'}
                  onClick={() => void patchAnnotation({ line_style: 'straight' })}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          ) : (
            annotation.body && (
              <p
                data-testid="annotation-hover-body"
                className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed"
              >
                {annotation.body}
              </p>
            )
          )}

          <div
            data-testid="annotation-hover-meta"
            className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground"
          >
            <span className="truncate">
              {t('sources.annotations.hover.colorLabel', {
                name: colorName(currentColor),
                time: relativeTime,
              })}
            </span>
            {annotation.page != null && (
              <span className="shrink-0">
                {t('sources.annotations.hover.pageMeta', { page: annotation.page })}
              </span>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

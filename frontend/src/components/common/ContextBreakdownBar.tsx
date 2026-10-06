'use client'

import { BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { ContextBreakdown, ContextBreakdownSegment, ContextSegmentKey } from '@/lib/types/api'

/** Segments that carry user-adjustable content (everything but the fixed prompt). */
const CONTENT_SEGMENT_KEYS: ContextSegmentKey[] = ['history', 'sources', 'notes']

/**
 * The content segments of a breakdown, in bar order (system → history →
 * sources → notes). Unknown keys are ignored so an older/newer backend cannot
 * crash the bar.
 */
export function getRenderableSegments(breakdown: ContextBreakdown): ContextBreakdownSegment[] {
  const order: ContextSegmentKey[] = ['system_prompt', ...CONTENT_SEGMENT_KEYS]
  return order
    .map(key => breakdown.segments?.find(segment => segment.key === key))
    .filter((segment): segment is ContextBreakdownSegment => !!segment)
}

/**
 * Render gate: the bar appears only once some adjustable content exists — an
 * empty notebook must not show a "100% fixed instructions" full bar.
 */
export function hasContentSegments(breakdown: ContextBreakdown): boolean {
  return CONTENT_SEGMENT_KEYS.some(
    key => (breakdown.segments?.find(segment => segment.key === key)?.chars ?? 0) > 0
  )
}

interface SegmentStyle {
  labelKey: string
  barClass: string
}

/** Per-segment label + color; the classes mirror the design palette. */
export function segmentStyle(key: ContextSegmentKey): SegmentStyle {
  switch (key) {
    case 'system_prompt':
      return { labelKey: 'context.segmentSystem', barClass: 'bg-muted-foreground/40' }
    case 'history':
      return { labelKey: 'context.segmentHistory', barClass: 'bg-teal' }
    case 'sources':
      return { labelKey: 'context.segmentSources', barClass: 'bg-ctx-insights' }
    case 'notes':
      return { labelKey: 'context.segmentNotes', barClass: 'bg-gold' }
  }
}

interface ContextBreakdownBarProps {
  breakdown: ContextBreakdown
  /** Open the detail dialog (bar and legend are one big click target). */
  onOpen: () => void
  className?: string
}

/**
 * Stacked composition bar between the context indicator and the composer:
 * one track split by the four segment percentages, plus a legend row. The
 * whole element is a button opening the breakdown dialog.
 */
export function ContextBreakdownBar({ breakdown, onOpen, className }: ContextBreakdownBarProps) {
  const { t } = useTranslation()

  // Gate here (not in the caller) so the render rule lives next to the markup.
  if (!hasContentSegments(breakdown)) return null

  const segments = getRenderableSegments(breakdown)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('context.breakdownAria')}
      title={t('context.breakdownAria')}
      data-testid="context-breakdown-bar"
      className={cn(
        'group flex w-full flex-shrink-0 flex-col gap-1.5 border-t bg-muted/30 py-2 px-4 text-left transition-colors hover:bg-muted/60',
        className
      )}
    >
      {/* Stacked track: each segment sized by its percentage; the muted track
          shows through any rounding slack so it never overflows 100%. */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {segments.map(segment => (
          <span
            key={segment.key}
            data-testid={`breakdown-segment-${segment.key}`}
            className={cn('h-full', segmentStyle(segment.key).barClass)}
            style={{ flexBasis: `${Math.max(segment.percent, 0)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-medium">
          <BarChart3 className="h-3 w-3" />
          {t('context.breakdownTitle')}
        </span>
        {segments.map(segment => (
          <span key={segment.key} className="flex items-center gap-1" data-testid={`breakdown-legend-${segment.key}`}>
            <span aria-hidden className={cn('h-2 w-2 rounded-full', segmentStyle(segment.key).barClass)} />
            <span>{t(segmentStyle(segment.key).labelKey)}</span>
            <span>{t('context.itemPercent', { percent: segment.percent })}</span>
          </span>
        ))}
      </div>
    </button>
  )
}

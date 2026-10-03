'use client'

import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EdgePanelHandleProps {
  /** Which screen edge the handle hugs. */
  side: 'left' | 'right'
  /** Accessibility/tooltip text (aria-label + title). */
  ariaLabel: string
  /** Short vertical label inside the card (e.g. 来源 / 笔记). */
  label: string
  onClick: () => void
  testid?: string
}

/**
 * Card-style edge handle for fullscreen slide-out panels: an icon plus a
 * vertical label on a bordered card hugging the screen edge, vertically
 * centered. Replaces the old 4px hairline that was too easy to miss.
 */
export function EdgePanelHandle({ side, ariaLabel, label, onClick, testid }: EdgePanelHandleProps) {
  const Icon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  return (
    <button
      type="button"
      className={cn(
        'group absolute top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1.5',
        'border-border bg-card/95 py-3 shadow-lg backdrop-blur transition-colors',
        'hover:border-primary/40 hover:bg-accent',
        side === 'left'
          ? 'left-0 rounded-r-lg border border-l-0 pl-2 pr-2.5'
          : 'right-0 rounded-l-lg border border-r-0 pl-2.5 pr-2'
      )}
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-testid={testid}
    >
      <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground transition-colors group-hover:text-primary [writing-mode:vertical-rl]">
        {label}
      </span>
    </button>
  )
}

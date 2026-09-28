'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Flashcard } from '@/lib/utils/artifact-context'

interface FlashcardViewerProps {
  cards: Flashcard[]
  className?: string
}

/**
 * Read-only flip-card viewer for generated flashcard notes. Click (or press
 * Enter/Space) a card to flip between front and back.
 */
export function FlashcardViewer({ cards, className }: FlashcardViewerProps) {
  const [flipped, setFlipped] = useState<Record<number, boolean>>({})

  const toggle = (index: number) => {
    setFlipped(prev => ({ ...prev, [index]: !prev[index] }))
  }

  return (
    <div className={cn('space-y-2', className)}>
      {cards.map((card, index) => {
        const isFlipped = !!flipped[index]
        return (
          <button
            key={`${index}-${card.front.slice(0, 16)}`}
            type="button"
            onClick={() => toggle(index)}
            aria-pressed={isFlipped}
            data-testid={`flashcard-${index}`}
            className={cn(
              'w-full text-left rounded-md border p-3 transition-colors',
              isFlipped
                ? 'border-teal bg-teal/10'
                : 'bg-card hover:bg-accent/40'
            )}
          >
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {isFlipped ? 'A' : 'Q'}
            </p>
            <p className="text-sm whitespace-pre-wrap break-words">
              {isFlipped ? card.back : card.front}
            </p>
          </button>
        )
      })}
    </div>
  )
}

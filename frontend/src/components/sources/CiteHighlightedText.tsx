'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Highlighter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { useTranslation } from '@/lib/hooks/use-translation'
import { buildNormMap, findParagraphIndex } from '@/lib/utils/text-locate'
import { cn } from '@/lib/utils'

interface CiteHighlightedTextProps {
  fullText: string
  quote: string
  /** Removes the banner and the paragraph highlight, keeping the text. */
  onDismiss: () => void
}

/**
 * Plain-text reader for citation jumps: full_text split into paragraphs, the
 * one containing the cited quote gets a persistent highlight and receives the
 * initial scroll. Paragraphs render through MarkdownRenderer so inline
 * formatting survives; the banner explains why the view looks different.
 */
export function CiteHighlightedText({ fullText, quote, onDismiss }: CiteHighlightedTextProps) {
  const { t } = useTranslation()
  const hitRef = useRef<HTMLDivElement | null>(null)

  const paragraphs = useMemo(() => fullText.split(/\n{2,}/), [fullText])
  const hitIndex = useMemo(() => findParagraphIndex(paragraphs, quote), [paragraphs, quote])
  const located = hitIndex >= 0

  useEffect(() => {
    if (!located) return
    // Defer one frame so the layout (and the modal's own scroll settle) is
    // done before scrolling the hit paragraph into view.
    const id = requestAnimationFrame(() => {
      hitRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [located])

  // Cheap containment check reused by both the fallback message and the
  // highlight itself: an unlocatable quote still shows the plain text.
  return (
    <div className="space-y-4">
      <div
        className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
        data-testid="citation-highlight-banner"
      >
        <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <Highlighter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {located
            ? t('sources.citation.highlightBanner')
            : t('sources.citation.notFoundBanner')}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onDismiss}
          aria-label={t('sources.citation.exitHighlight')}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      {paragraphs.map((paragraph, i) => (
        <div
          key={i}
          ref={i === hitIndex ? hitRef : undefined}
          className={cn(
            'rounded-sm transition-colors',
            i === hitIndex && 'bg-amber-500/20 -mx-2 px-2 py-1'
          )}
          data-testid={i === hitIndex ? 'citation-paragraph-hit' : undefined}
        >
          <MarkdownRenderer>{paragraph}</MarkdownRenderer>
        </div>
      ))}
    </div>
  )
}

// Re-exported for tests of the shared normalization behavior.
export { buildNormMap }

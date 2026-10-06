import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CiteHighlightedText } from './CiteHighlightedText'

// useTranslation is mocked globally in setup.ts (t returns the key string).
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: { children: string }) => <div>{children}</div>,
}))

const FULL_TEXT = [
  'First paragraph introduces the topic of distributed consensus.',
  'In the Raft algorithm a leader is elected by majority vote and log entries replicate to followers.',
  'Third paragraph concludes the discussion.',
].join('\n\n')

describe('CiteHighlightedText', () => {
  it('highlights the paragraph containing the quote and shows the banner', () => {
    render(<CiteHighlightedText fullText={FULL_TEXT} quote="elected by majority vote" onDismiss={vi.fn()} />)

    expect(screen.getByTestId('citation-highlight-banner')).toBeInTheDocument()
    expect(screen.getByTestId('citation-paragraph-hit').textContent).toContain('Raft algorithm')
    // Non-hit paragraphs render unhighlighted
    expect(screen.getAllByText(/First paragraph/).length).toBe(1)
  })

  it('shows the not-found banner when the quote matches nothing', () => {
    render(<CiteHighlightedText fullText={FULL_TEXT} quote="quantum entanglement" onDismiss={vi.fn()} />)

    expect(screen.getByText('sources.citation.notFoundBanner')).toBeInTheDocument()
    expect(screen.queryByTestId('citation-paragraph-hit')).not.toBeInTheDocument()
  })

  it('dismiss clears the highlight via the callback', () => {
    const onDismiss = vi.fn()
    render(<CiteHighlightedText fullText={FULL_TEXT} quote="majority vote" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'sources.citation.exitHighlight' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

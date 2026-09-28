import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FlashcardViewer } from './FlashcardViewer'

const cards = [
  { front: 'What is photosynthesis?', back: 'Conversion of light into chemical energy.' },
  { front: 'What is an API?', back: 'Application Programming Interface.' },
]

describe('FlashcardViewer', () => {
  it('renders card fronts initially', () => {
    render(<FlashcardViewer cards={cards} />)

    expect(screen.getByText('What is photosynthesis?')).toBeInTheDocument()
    expect(screen.getByText('What is an API?')).toBeInTheDocument()
    expect(screen.queryByText('Conversion of light into chemical energy.')).not.toBeInTheDocument()
  })

  it('flips a card to its back on click and back on second click', () => {
    render(<FlashcardViewer cards={cards} />)

    const firstCard = screen.getByTestId('flashcard-0')
    fireEvent.click(firstCard)

    expect(screen.getByText('Conversion of light into chemical energy.')).toBeInTheDocument()
    expect(screen.queryByText('What is photosynthesis?')).not.toBeInTheDocument()
    expect(firstCard.getAttribute('aria-pressed')).toBe('true')

    // The other card stays on its front.
    expect(screen.getByText('What is an API?')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('flashcard-0'))
    expect(screen.getByText('What is photosynthesis?')).toBeInTheDocument()
    expect(screen.queryByText('Conversion of light into chemical energy.')).not.toBeInTheDocument()
  })
})

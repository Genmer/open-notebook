import { describe, expect, it } from 'vitest'
import {
  buildArtifactContextConfig,
  hasIncludedContext,
  parseFlashcards,
} from './artifact-context'
import type { ContextSelections } from '@/lib/types/notebook-context'

const selections: ContextSelections = {
  sources: {
    'source:a': 'insights',
    'source:b': 'full',
    'source:c': 'off',
  },
  notes: {
    'note:1': 'full',
    'note:2': 'off',
  },
}

describe('buildArtifactContextConfig', () => {
  it('maps source modes to the chat context_config protocol', () => {
    const config = buildArtifactContextConfig(
      selections,
      [{ id: 'source:a' }, { id: 'source:b' }, { id: 'source:c' }],
      [{ id: 'note:1' }, { id: 'note:2' }],
    )

    expect(config).toEqual({
      sources: {
        'source:a': 'insights',
        'source:b': 'full content',
        'source:c': 'not in',
      },
      notes: {
        'note:1': 'full content',
        'note:2': 'not in',
      },
    })
  })

  it('treats missing selections as not in', () => {
    const config = buildArtifactContextConfig(
      { sources: {}, notes: {} },
      [{ id: 'source:x' }],
      [{ id: 'note:x' }],
    )

    expect(config.sources['source:x']).toBe('not in')
    expect(config.notes['note:x']).toBe('not in')
    expect(hasIncludedContext(config)).toBe(false)
  })

  it('detects when at least one item is included', () => {
    const config = buildArtifactContextConfig(
      selections,
      [{ id: 'source:b' }],
      [{ id: 'note:1' }],
    )
    expect(hasIncludedContext(config)).toBe(true)
  })
})

describe('parseFlashcards', () => {
  it('parses a plain JSON array', () => {
    const cards = parseFlashcards('[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]')
    expect(cards).toEqual([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ])
  })

  it('parses a fenced array with surrounding prose', () => {
    const content = 'Sure!\n```json\n[{"front":"Q","back":"A"}]\n```\nHope that helps.'
    expect(parseFlashcards(content)).toEqual([{ front: 'Q', back: 'A' }])
  })

  it('drops cards missing front or back', () => {
    const content = '[{"front":"Q","back":"A"},{"front":"","back":"x"},{"back":"only"}]'
    expect(parseFlashcards(content)).toEqual([{ front: 'Q', back: 'A' }])
  })

  it('returns null for regular markdown notes', () => {
    expect(parseFlashcards('# Study Guide\n\nSome prose')).toBeNull()
    expect(parseFlashcards(null)).toBeNull()
    expect(parseFlashcards('')).toBeNull()
  })

  it('returns null for invalid JSON or empty arrays', () => {
    expect(parseFlashcards('[{"front":"Q",}')).toBeNull()
    expect(parseFlashcards('[]')).toBeNull()
    expect(parseFlashcards('[{"front":"","back":""}]')).toBeNull()
  })
})

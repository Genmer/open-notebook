import { describe, it, expect } from 'vitest'
import { convertReferencesToCompactMarkdown } from './source-references'

describe('convertReferencesToCompactMarkdown titleLookup', () => {
  const lookup = new Map([
    ['abc', 'Quarterly Report'],
    ['brackets', 'Title [with] (parens)'],
    ['long', 'A'.repeat(45)],
  ])

  it('shows resolved titles for source references', () => {
    const result = convertReferencesToCompactMarkdown(
      'See [source:abc] for details.',
      'References',
      lookup
    )
    expect(result).toContain('References:\n[1] - [Quarterly Report](#ref-source-abc)')
  })

  it('keeps inline numbered citations unchanged', () => {
    const result = convertReferencesToCompactMarkdown(
      'See [source:abc] for details.',
      'References',
      lookup
    )
    expect(result.startsWith('See [1](#ref-source-abc) for details.')).toBe(true)
    expect(result).not.toContain('See [Quarterly Report]')
  })

  it('escapes markdown link-text specials in titles', () => {
    const result = convertReferencesToCompactMarkdown('[source:brackets]', 'References', lookup)
    expect(result).toContain(
      '[1] - [Title \\[with\\] \\(parens\\)](#ref-source-brackets)'
    )
  })

  it('truncates long titles to 40 characters plus ellipsis', () => {
    const result = convertReferencesToCompactMarkdown('[source:long]', 'References', lookup)
    expect(result).toContain(`[1] - [${'A'.repeat(40)}...](#ref-source-long)`)
  })

  it('falls back to source:id when the lookup has no entry', () => {
    const result = convertReferencesToCompactMarkdown(
      'See [source:unknown] and [note:x].',
      'References',
      lookup
    )
    expect(result).toContain('[1] - [source:unknown](#ref-source-unknown)')
    expect(result).toContain('[2] - [note:x](#ref-note-x)')
  })

  it('never applies titles to note or source_insight references', () => {
    const mixed = new Map([['x', 'A Note Title']])
    const result = convertReferencesToCompactMarkdown(
      '[note:x] and [source_insight:x]',
      'References',
      mixed
    )
    expect(result).toContain('[1] - [note:x](#ref-note-x)')
    expect(result).toContain('[2] - [source_insight:x](#ref-source_insight-x)')
    expect(result).not.toContain('A Note Title')
  })

  it('behaves the same as before when the third parameter is omitted', () => {
    const text = 'See [source:abc] and [note:xyz]. Also [source:abc] again.'
    const result = convertReferencesToCompactMarkdown(text)
    expect(result).toBe(
      'See [1](#ref-source-abc) and [2](#ref-note-xyz). Also [1](#ref-source-abc) again.' +
        '\n\nReferences:\n[1] - [source:abc](#ref-source-abc)\n[2] - [note:xyz](#ref-note-xyz)'
    )
  })

  it('returns text without references untouched even with a lookup', () => {
    expect(convertReferencesToCompactMarkdown('no refs here', 'References', lookup)).toBe(
      'no refs here'
    )
  })
})

describe('convertReferencesToCompactMarkdown title edge cases', () => {
  // A lone surrogate (unpaired high or low code unit) renders as U+FFFD garbage.
  const hasLoneSurrogate = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        if (!(s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff)) return true
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        if (!(s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff)) return true
      }
    }
    return false
  }

  it('keeps the link intact when the title contains backslash and the "]( combo', () => {
    const lookup = new Map([['x', 'C:\\docs "](" v2']])
    const result = convertReferencesToCompactMarkdown('[source:x]', 'References', lookup)
    expect(result).toContain('[1] - [C:\\\\docs "\\]\\(" v2](#ref-source-x)')
    expect(hasLoneSurrogate(result)).toBe(false)
  })

  it('lets a backtick pass through without breaking the link', () => {
    const lookup = new Map([['bt', 'Code `tick` title']])
    const result = convertReferencesToCompactMarkdown('[source:bt]', 'References', lookup)
    expect(result.endsWith('](#ref-source-bt)')).toBe(true)
    expect(result).toContain('Code `tick` title')
  })

  it('escapes after measuring the raw length for truncation', () => {
    // Exactly 40 raw chars: no truncation, but the trailing paren is escaped.
    const exact = convertReferencesToCompactMarkdown(
      '[source:exact]',
      'References',
      new Map([['exact', 'a'.repeat(39) + '(']])
    )
    expect(exact).toContain(`[1] - [${'a'.repeat(39)}\\(](#ref-source-exact)`)

    // 41 raw chars: truncation wins and the 41st char (unescaped) is dropped.
    const over = convertReferencesToCompactMarkdown(
      '[source:over]',
      'References',
      new Map([['over', 'a'.repeat(40) + '(']])
    )
    expect(over).toContain(`[1] - [${'a'.repeat(40)}...](#ref-source-over)`)
  })

  it('truncates long Chinese titles to 40 characters plus ellipsis', () => {
    const result = convertReferencesToCompactMarkdown(
      '[source:zh]',
      'References',
      new Map([['zh', '摘'.repeat(45)]])
    )
    expect(result).toContain(`[1] - [${'摘'.repeat(40)}...](#ref-source-zh)`)
    expect(!hasLoneSurrogate(result)).toBe(true)
  })

  it('never splits an emoji surrogate pair when truncating', () => {
    const result = convertReferencesToCompactMarkdown(
      '[source:emoji]',
      'References',
      new Map([['emoji', 'a' + '🎉'.repeat(30)]])
    )
    expect(hasLoneSurrogate(result)).toBe(false)
  })
})

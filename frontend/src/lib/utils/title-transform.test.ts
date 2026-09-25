import { describe, it, expect } from 'vitest'
import { transformTitle, hasTitleChanged } from './title-transform'

describe('transformTitle', () => {
  it('applies find/replace first, then prefix, then suffix', () => {
    expect(
      transformTitle('a-b', { find: 'a', replace: 'x', prefix: 'P', suffix: 'S' })
    ).toBe('Px-bS')
  })

  it('replaces every occurrence', () => {
    expect(transformTitle('banana', { find: 'an', replace: 'AN' })).toBe('bANANa')
  })

  it('skips the replace rule when find is empty', () => {
    expect(transformTitle('banana', { find: '', replace: 'AN' })).toBe('banana')
    expect(transformTitle('banana', { find: undefined, replace: 'AN' })).toBe('banana')
  })

  it('prepends and appends when only affixes are given', () => {
    expect(transformTitle('doc', { prefix: 'P-', suffix: '.md' })).toBe('P-doc.md')
  })

  it('skips empty prefix and suffix', () => {
    expect(transformTitle('doc', { prefix: '', suffix: '' })).toBe('doc')
    expect(transformTitle('doc', {})).toBe('doc')
  })

  it('wraps an empty title with affixes', () => {
    expect(transformTitle('', { prefix: 'P', suffix: 'S' })).toBe('PS')
  })

  it('supports replace removing text (empty replacement)', () => {
    expect(transformTitle('v1 draft', { find: 'v1 ' })).toBe('draft')
  })
})

describe('hasTitleChanged', () => {
  it('is true only when the strings differ', () => {
    expect(hasTitleChanged('a', 'b')).toBe(true)
    expect(hasTitleChanged('a', 'a')).toBe(false)
    expect(hasTitleChanged('', '')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { filterStreamingContent } from './stream-text'

describe('filterStreamingContent', () => {
  it('returns text unchanged when no think tag is present', () => {
    expect(filterStreamingContent('hello world')).toBe('hello world')
    expect(filterStreamingContent('')).toBe('')
  })

  it('strips closed think blocks', () => {
    expect(filterStreamingContent('a<think>secret</think>b')).toBe('ab')
  })

  it('strips multiple closed think blocks', () => {
    expect(
      filterStreamingContent('a<think>x</think>b<think>y</think>c')
    ).toBe('abc')
  })

  it('hides everything after an unclosed think tag', () => {
    expect(filterStreamingContent('a<think>hidden and still coming')).toBe('a')
  })

  it('holds back a partial opening-tag prefix at the end', () => {
    expect(filterStreamingContent('answer<thi')).toBe('answer')
    expect(filterStreamingContent('answer<thin')).toBe('answer')
    expect(filterStreamingContent('answer<')).toBe('answer')
  })

  it('keeps a partial closing-tag prefix visible (only opening is held back)', () => {
    // '</thi' is not a prefix of '<think>' — the streaming text stays
    expect(filterStreamingContent('a<think>x</thi')).toBe('a')
  })
})

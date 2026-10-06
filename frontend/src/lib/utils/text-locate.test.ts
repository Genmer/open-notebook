import { describe, expect, it } from 'vitest'
import { buildNormMap, findCiteMatch, findNormalized, findParagraphIndex } from './text-locate'

describe('buildNormMap', () => {
  it('collapses whitespace runs and lowercases, keeping original offsets', () => {
    const { norm, map } = buildNormMap('Hello   World\n\nnext')
    expect(norm).toBe('hello world next')
    // 'h' came from offset 0; 'w' from offset 8 (after the collapsed spaces)
    expect(map[norm.indexOf('world')]).toBe(8)
  })
})

describe('findNormalized', () => {
  const haystack = 'The  QUICK brown fox\n\njumps over the lazy dog.'

  it('matches across whitespace and case differences', () => {
    const span = findNormalized(haystack, 'quick brown FOX jumps')
    expect(span).not.toBeNull()
    expect(haystack.slice(span!.start, span!.end).replace(/\s+/g, ' ').toLowerCase()).toBe(
      'quick brown fox jumps'
    )
  })

  it('returns null when the needle is absent', () => {
    expect(findNormalized(haystack, 'purple elephant')).toBeNull()
  })
})

describe('findParagraphIndex', () => {
  const paragraphs = [
    'First paragraph about consensus protocols.',
    'Second paragraph: Raft elects a leader by majority vote.',
    'Third paragraph about garbage collection.',
  ]

  it('finds the paragraph containing the quote', () => {
    expect(findParagraphIndex(paragraphs, 'elects a leader by MAJORITY vote')).toBe(1)
  })

  it('still lands on the right paragraph for a slightly truncated quote', () => {
    expect(findParagraphIndex(paragraphs, 'Raft elects a leader')).toBe(1)
  })

  it('returns -1 when nothing matches', () => {
    expect(findParagraphIndex(paragraphs, 'quantum qubits everywhere')).toBe(-1)
  })
})

describe('findCiteMatch', () => {
  const pageNorm = buildNormMap(
    '第50题\n系统可靠性\nC选项平均失效间隔时间：两次相邻失效之间的平均时间（常与MTBF混用）'
  ).norm

  it('matches the full quote directly and reports its range', () => {
    const hit = findCiteMatch(pageNorm, '平均失效间隔时间：两次相邻失效之间的平均时间')
    expect(hit).not.toBeNull()
    expect(pageNorm.slice(hit!.index, hit!.index + hit!.length)).toBe(
      '平均失效间隔时间:两次相邻失效之间的平均时间'
    )
  })

  it('falls back to the longest line when line-break artifacts break the full match', () => {
    // The locate-passage quote carries extraction artifacts that never appear
    // in the viewer's text layer as one contiguous run.
    const hit = findCiteMatch(
      pageNorm,
      '故障概率\n。\n来\nC选项平均失效间隔时间:两次相邻失效之间的平均时'
    )
    expect(hit).not.toBeNull()
    expect(pageNorm.slice(hit!.index, hit!.index + hit!.length)).toContain(
      'c选项平均失效间隔时间:两次相邻失效之间的平均时'
    )
  })

  it('returns null when neither the quote nor its lines are present', () => {
    expect(findCiteMatch(pageNorm, '完全无关的引用文字不存在于页面之中')).toBeNull()
  })
})

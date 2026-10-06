import { describe, expect, it } from 'vitest'
import {
  activeSentenceIndex,
  spanStartProgress,
  splitTranscriptSentences,
} from './transcript-sync'

describe('splitTranscriptSentences', () => {
  const text = '第一句结束。第二句结束！疑问吗？\n\nNew paragraph here. Another one! Mr. Smith paid 3.5 dollars.\n没有标点的长句尾巴'

  it('splits CJK sentences without following spaces', () => {
    const spans = splitTranscriptSentences(text)
    expect(text.slice(spans[0].start, spans[0].end)).toBe('第一句结束。')
    expect(text.slice(spans[1].start, spans[1].end)).toBe('第二句结束！')
    expect(text.slice(spans[2].start, spans[2].end)).toBe('疑问吗？')
  })

  it('splits latin sentences on whitespace-terminated punctuation only', () => {
    const spans = splitTranscriptSentences(text)
    const latin = spans
      .slice(3, 5)
      .map(span => text.slice(span.start, span.end))
    expect(latin).toEqual(['New paragraph here.', 'Another one!'])
    // The trailing sentence keeps the decimal and abbreviation intact.
    const tail = text.slice(spans[5].start, spans[5].end)
    expect(tail).toContain('Mr. Smith paid 3.5 dollars.')
  })

  it('keeps unterminated tails as their own sentence and spans stay in order', () => {
    const spans = splitTranscriptSentences(text)
    expect(text.slice(spans[spans.length - 1].start, spans[spans.length - 1].end))
      .toBe('没有标点的长句尾巴')
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].start).toBeGreaterThan(spans[i - 1].start)
    }
  })
})

describe('activeSentenceIndex', () => {
  const text = '十个字的第一句。十个字的第二句。十个字的第三句。'
  const spans = splitTranscriptSentences(text)

  it('returns -1 for no spans', () => {
    expect(activeSentenceIndex('', [], 0.5)).toBe(-1)
  })

  it('maps playback share onto cumulative character share', () => {
    expect(activeSentenceIndex(text, spans, 0)).toBe(0)
    expect(activeSentenceIndex(text, spans, 0.3)).toBe(0)
    expect(activeSentenceIndex(text, spans, 0.4)).toBe(1)
    expect(activeSentenceIndex(text, spans, 0.9)).toBe(2)
    expect(activeSentenceIndex(text, spans, 1)).toBe(2)
  })

  it('clamps out-of-range progress', () => {
    expect(activeSentenceIndex(text, spans, -3)).toBe(0)
    expect(activeSentenceIndex(text, spans, 7)).toBe(2)
  })
})

describe('spanStartProgress', () => {
  const text = '十个字的第一句。十个字的第二句。十个字的第三句。'
  const spans = splitTranscriptSentences(text)

  it('returns the character share before a span', () => {
    expect(spanStartProgress(text, spans, 0)).toBeCloseTo(0, 5)
    expect(spanStartProgress(text, spans, 1)).toBeCloseTo(1 / 3, 5)
    expect(spanStartProgress(text, spans, 2)).toBeCloseTo(2 / 3, 5)
  })

  it('is consistent with activeSentenceIndex seeking', () => {
    for (let i = 0; i < spans.length; i += 1) {
      const progress = spanStartProgress(text, spans, i)
      expect(activeSentenceIndex(text, spans, progress)).toBe(i)
    }
  })
})

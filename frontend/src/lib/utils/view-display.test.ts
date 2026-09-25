import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { displayViewName } from './view-display'

const t = ((key: string) => key) as unknown as TFunction

describe('displayViewName', () => {
  it('translates untouched default views by fixed id', () => {
    expect(displayViewName({ id: 'source_view:ai_content', name: 'AI Content' }, t)).toBe(
      'sources.grouping.aiContentViewName'
    )
    expect(displayViewName({ id: 'source_view:ai_title', name: 'AI Filename' }, t)).toBe(
      'sources.grouping.aiTitleViewName'
    )
  })

  it('respects user renames on default views', () => {
    expect(displayViewName({ id: 'source_view:ai_content', name: '我的分类' }, t)).toBe('我的分类')
  })

  it('passes custom views through unchanged', () => {
    expect(displayViewName({ id: 'source_view:abc', name: '论文' }, t)).toBe('论文')
  })
})

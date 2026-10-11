import { beforeEach, describe, expect, it } from 'vitest'
import {
  DRAFTS_LIMIT,
  createDraft,
  emptySections,
  loadDrafts,
  saveDrafts,
  type RuankaoEssayDraft,
} from './essay-drafts'

function draft(id: string, updatedAt: string, title = `draft-${id}`): RuankaoEssayDraft {
  return {
    id,
    title,
    projectEnvId: null,
    sections: emptySections(),
    createdAt: updatedAt,
    updatedAt,
  }
}

describe('essay-drafts store', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips drafts through localStorage', () => {
    const first = createDraft('我的缓存论文')
    first.sections.abstract = '摘要草稿'
    first.projectEnvId = 'project_env:e1'
    saveDrafts([first])

    const loaded = loadDrafts()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(first.id)
    expect(loaded[0].title).toBe('我的缓存论文')
    expect(loaded[0].sections.abstract).toBe('摘要草稿')
    expect(loaded[0].projectEnvId).toBe('project_env:e1')
  })

  it('caps storage at 20 drafts, dropping the oldest by updatedAt', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      draft(`d${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString())
    )
    saveDrafts(many)

    const loaded = loadDrafts()
    expect(loaded).toHaveLength(DRAFTS_LIMIT)
    // 最旧 5 条（d0-d4）被丢弃，d5 起保留
    expect(loaded.map((d) => d.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `d${i + 5}`)
    )
  })

  it('falls back to an empty list on unparseable storage', () => {
    window.localStorage.setItem('ruankao.essayDrafts.v1', '{not json')
    expect(loadDrafts()).toEqual([])

    window.localStorage.setItem('ruankao.essayDrafts.v1', '"just a string"')
    expect(loadDrafts()).toEqual([])
  })

  it('drops malformed entries instead of failing the whole list', () => {
    const good = createDraft('good')
    const raw = JSON.stringify([{ id: 1, nope: true }, good, null])
    window.localStorage.setItem('ruankao.essayDrafts.v1', raw)

    const loaded = loadDrafts()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(good.id)
  })

  it('creates drafts with empty sections and fresh timestamps', () => {
    const d = createDraft()
    expect(d.sections).toEqual(emptySections())
    expect(d.projectEnvId).toBeNull()
    expect(d.createdAt).toBe(d.updatedAt)
    expect(d.id).not.toBe('')
  })
})

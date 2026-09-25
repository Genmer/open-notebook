import { describe, it, expect } from 'vitest'
import { SourceGroupResponse } from '@/lib/types/api'
import { resolveDragIds, canDropGroup } from './dnd-helpers'

function group(id: string, parentId: string | null = null): SourceGroupResponse {
  return {
    id: `source_group:${id}`,
    view_id: 'source_view:v1',
    name: id,
    parent_id: parentId,
    source_count: 0,
    created: null,
    updated: null,
  }
}

describe('resolveDragIds', () => {
  it('drags the whole selection when the dragged row is selected with others', () => {
    const selection = new Set(['a', 'b', 'c'])
    expect(resolveDragIds('b', selection).sort()).toEqual(['a', 'b', 'c'])
  })

  it('drags only the dragged row when it is not part of the selection', () => {
    const selection = new Set(['a', 'b'])
    expect(resolveDragIds('c', selection)).toEqual(['c'])
  })

  it('drags a single id when the selection only contains the dragged row', () => {
    expect(resolveDragIds('a', new Set(['a']))).toEqual(['a'])
  })

  it('falls back to the dragged id with an empty selection', () => {
    expect(resolveDragIds('a', new Set())).toEqual(['a'])
  })
})

describe('canDropGroup', () => {
  const groups = [group('root'), group('mid', 'source_group:root'), group('leaf', 'source_group:mid'), group('other')]

  it('rejects dropping a folder onto itself', () => {
    expect(canDropGroup(groups, 'source_group:mid', 'source_group:mid')).toBe(false)
  })

  it('rejects dropping a folder onto its own descendant (cycle)', () => {
    expect(canDropGroup(groups, 'source_group:root', 'source_group:leaf')).toBe(false)
    expect(canDropGroup(groups, 'source_group:mid', 'source_group:leaf')).toBe(false)
  })

  it('allows dropping onto an ancestor or an unrelated branch', () => {
    expect(canDropGroup(groups, 'source_group:leaf', 'source_group:root')).toBe(true)
    expect(canDropGroup(groups, 'source_group:root', 'source_group:other')).toBe(true)
  })
})

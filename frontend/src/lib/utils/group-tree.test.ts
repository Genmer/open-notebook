import { describe, it, expect } from 'vitest'
import { SourceGroupResponse } from '@/lib/types/api'
import { buildGroupTree, collectDescendantIds, flattenGroupTree, getAncestorChain } from './group-tree'

function group(id: string, parentId?: string): SourceGroupResponse {
  return {
    id: `source_group:${id}`,
    view_id: 'source_view:v1',
    name: id,
    parent_id: parentId ? `source_group:${parentId}` : null,
    source_count: 1,
    created: null,
    updated: null,
  }
}

describe('buildGroupTree', () => {
  it('nests children under parents and computes depth', () => {
    const tree = buildGroupTree([group('b', 'a'), group('a'), group('c', 'b')])

    expect(tree).toHaveLength(1)
    expect(tree[0].group.name).toBe('a')
    expect(tree[0].depth).toBe(1)
    expect(tree[0].children[0].group.name).toBe('b')
    expect(tree[0].children[0].depth).toBe(2)
    expect(tree[0].children[0].children[0].group.name).toBe('c')
    expect(tree[0].children[0].children[0].depth).toBe(3)
  })

  it('keeps multiple roots and preserves them', () => {
    const tree = buildGroupTree([group('x'), group('y')])
    expect(tree.map((n) => n.group.name)).toEqual(['x', 'y'])
  })

  it('promotes orphans with a missing parent to roots', () => {
    const tree = buildGroupTree([group('a'), group('ghost', 'missing')])
    expect(tree).toHaveLength(2)
    expect(tree.map((n) => n.group.name)).toEqual(['a', 'ghost'])
  })

  it('promotes a self-referencing group to root instead of nesting it into itself', () => {
    const tree = buildGroupTree([group('a'), group('loop', 'loop')])
    expect(tree.map((n) => n.group.name).sort()).toEqual(['a', 'loop'])
    expect(tree.find((n) => n.group.name === 'loop')?.children).toHaveLength(0)
    expect(tree.find((n) => n.group.name === 'loop')?.depth).toBe(1)
  })

  it('recomputes depths for the subtree of a promoted orphan', () => {
    const tree = buildGroupTree([group('b', 'ghost'), group('c', 'b')])
    expect(tree.map((n) => n.group.name)).toEqual(['b'])
    expect(tree[0].depth).toBe(1)
    expect(tree[0].children[0].group.name).toBe('c')
    expect(tree[0].children[0].depth).toBe(2)
  })
})

describe('flattenGroupTree', () => {
  it('walks depth-first pre-order with depths', () => {
    const flat = flattenGroupTree([group('a'), group('b', 'a'), group('c', 'b')])
    expect(flat.map((n) => n.group.name)).toEqual(['a', 'b', 'c'])
    expect(flat.map((n) => n.depth)).toEqual([1, 2, 3])
  })
})

describe('collectDescendantIds', () => {
  it('returns all descendants excluding the root itself', () => {
    const groups = [group('a'), group('b', 'a'), group('c', 'b'), group('d')]
    expect(collectDescendantIds(groups, 'source_group:a')).toEqual([
      'source_group:b',
      'source_group:c',
    ])
    expect(collectDescendantIds(groups, 'source_group:d')).toEqual([])
  })
})

describe('getAncestorChain', () => {
  it('returns the chain root-first, excluding the group itself', () => {
    const groups = [group('root'), group('mid', 'root'), group('leaf', 'mid')]
    const chain = getAncestorChain(groups, 'source_group:leaf')
    expect(chain.map((g) => g.name)).toEqual(['root', 'mid'])
  })

  it('returns [] for a root group', () => {
    const groups = [group('root'), group('mid', 'root')]
    expect(getAncestorChain(groups, 'source_group:root')).toEqual([])
  })

  it('returns [] for an id missing from the list (stale persisted selection)', () => {
    const groups = [group('root')]
    expect(getAncestorChain(groups, 'source_group:ghost')).toEqual([])
  })

  it('stops at a broken parent link without throwing', () => {
    // mid points at a deleted parent; chain ends at mid's known ancestors
    const groups = [group('mid', 'ghost'), group('leaf', 'mid')]
    const chain = getAncestorChain(groups, 'source_group:leaf')
    expect(chain.map((g) => g.name)).toEqual(['mid'])
  })
})

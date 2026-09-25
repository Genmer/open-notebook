import { SourceGroupResponse } from '@/lib/types/api'

// Mirrors MAX_GROUP_DEPTH in open_notebook/domain/source_grouping.py — the
// backend rejects anything deeper, so UI guards must use the same number.
export const MAX_GROUP_DEPTH = 5

export interface GroupNode {
  group: SourceGroupResponse
  children: GroupNode[]
  depth: number
}

// Flat groups (any order) -> ordered tree; orphans whose parent is gone are
// promoted to roots so a broken chain can't make groups disappear.
export function buildGroupTree(groups: SourceGroupResponse[]): GroupNode[] {
  const byId = new Map<string, GroupNode>()
  for (const group of groups) {
    byId.set(group.id, { group, children: [], depth: 1 })
  }

  const roots: GroupNode[] = []
  for (const node of byId.values()) {
    const parentId = node.group.parent_id
    const parentNode = parentId ? byId.get(parentId) : undefined
    if (parentNode && parentNode !== node) {
      node.depth = 0 // provisional; recomputed below from the roots
      parentNode.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const assignDepth = (node: GroupNode, depth: number) => {
    node.depth = depth
    node.children.forEach((child) => assignDepth(child, depth + 1))
  }
  roots.forEach((root) => assignDepth(root, 1))
  return roots
}

// Depth-aware pre-order flattening of a flat group list (e.g. the notebook Select).
export function flattenGroupTree(groups: SourceGroupResponse[]): GroupNode[] {
  const out: GroupNode[] = []
  const walk = (list: GroupNode[]) => {
    for (const node of list) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(buildGroupTree(groups))
  return out
}

// Ancestor chain of a group, ordered root-first and excluding the group itself.
// Unknown ids (e.g. a persisted selection whose group was deleted) yield [].
export function getAncestorChain(groups: SourceGroupResponse[], groupId: string): SourceGroupResponse[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const chain: SourceGroupResponse[] = []
  const seen = new Set<string>([groupId])
  let current = byId.get(groupId)
  while (current?.parent_id && !seen.has(current.parent_id)) {
    const parent = byId.get(current.parent_id)
    if (!parent) break
    chain.unshift(parent)
    seen.add(parent.id)
    current = parent
  }
  return chain
}

// Depth of a group counting from 1 at the root; 0 when the id is unknown.
export function getGroupDepth(groups: SourceGroupResponse[], groupId: string): number {
  return getAncestorChain(groups, groupId).length + (groups.some((g) => g.id === groupId) ? 1 : 0)
}

// Node height in tree levels (a leaf is 1) — moving a subtree of height h
// under a target of depth d stays legal only while d + h <= MAX_GROUP_DEPTH.
export function subtreeHeight(groups: SourceGroupResponse[], groupId: string): number {
  const childrenOf = new Map<string, SourceGroupResponse[]>()
  for (const group of groups) {
    if (!group.parent_id) continue
    const list = childrenOf.get(group.parent_id) ?? []
    list.push(group)
    childrenOf.set(group.parent_id, list)
  }
  const walk = (id: string): number => {
    const children = childrenOf.get(id) ?? []
    return children.length === 0 ? 1 : 1 + Math.max(...children.map((c) => walk(c.id)))
  }
  return walk(groupId)
}

export function findTreeNode(nodes: GroupNode[], id: string): GroupNode | undefined {
  for (const node of nodes) {
    if (node.group.id === id) return node
    const hit = findTreeNode(node.children, id)
    if (hit) return hit
  }
  return undefined
}

export function collectDescendantIds(groups: SourceGroupResponse[], groupId: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const group of groups) {
    if (!group.parent_id) continue
    const list = childrenOf.get(group.parent_id) ?? []
    list.push(group.id)
    childrenOf.set(group.parent_id, list)
  }
  const out: string[] = []
  const stack = [...(childrenOf.get(groupId) ?? [])]
  while (stack.length) {
    const id = stack.pop() as string
    out.push(id)
    stack.push(...(childrenOf.get(id) ?? []))
  }
  return out
}

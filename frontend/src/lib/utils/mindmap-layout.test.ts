import { describe, expect, it } from 'vitest'
import type { MindmapNode } from './artifact-context'
import {
  MINDMAP_CHILD_GAP,
  MINDMAP_COL_WIDTH,
  MINDMAP_PAD,
  MINDMAP_ROW_HEIGHT,
  layoutMindmap,
} from './mindmap-layout'

const tree: MindmapNode = {
  label: 'Root',
  children: [
    {
      label: 'Left A',
      children: [
        { label: 'A1' },
        { label: 'A2' },
      ],
    },
    {
      label: 'Left B',
      children: [{ label: 'B1' }],
    },
    {
      label: 'Right C',
      children: [
        { label: 'C1' },
        { label: 'C2' },
        { label: 'C3' },
      ],
    },
  ],
}

describe('layoutMindmap', () => {
  it('places the root at the horizontal center of the canvas', () => {
    const layout = layoutMindmap(tree, new Set())
    const root = layout.nodes.find(n => n.id === '0')
    expect(root).toBeDefined()
    expect(root!.x + root!.width / 2).toBeCloseTo(layout.width / 2, 5)
    expect(root!.y).toBeCloseTo(layout.height / 2, 5)
  })

  it('splits branches left and right of the root column', () => {
    const layout = layoutMindmap(tree, new Set())
    const rootCenter = layout.nodes.find(n => n.id === '0')!.x
      + layout.nodes.find(n => n.id === '0')!.width / 2
    const left = layout.nodes.find(n => n.id === '0.0')!
    const right = layout.nodes.find(n => n.id === '0.2')!
    expect(left.x + left.width).toBeLessThanOrEqual(rootCenter)
    expect(right.x).toBeGreaterThanOrEqual(rootCenter)
    // A branch box hugs its side of the root column, one gutter apart.
    expect(left.x + left.width).toBeCloseTo(
      rootCenter - MINDMAP_COL_WIDTH / 2 - MINDMAP_CHILD_GAP,
      5
    )
    expect(right.x).toBeCloseTo(
      rootCenter + MINDMAP_COL_WIDTH / 2 + MINDMAP_CHILD_GAP,
      5
    )
  })

  it('stacks siblings without overlap and centers parents on children', () => {
    const layout = layoutMindmap(tree, new Set())
    const a1 = layout.nodes.find(n => n.id === '0.0.0')!
    const a2 = layout.nodes.find(n => n.id === '0.0.1')!
    expect(a2.y - a1.y).toBe(MINDMAP_ROW_HEIGHT + MINDMAP_CHILD_GAP)
    const branch = layout.nodes.find(n => n.id === '0.0')!
    expect(branch.y).toBeCloseTo((a1.y + a2.y) / 2, 5)
  })

  it('produces one link per visible parent-child pair', () => {
    const layout = layoutMindmap(tree, new Set())
    // 3 branches + 6 leaves
    expect(layout.links).toHaveLength(9)
  })

  it('collapses a branch into a single node with no descendant links', () => {
    const layout = layoutMindmap(tree, new Set(['0.2']))
    expect(layout.nodes.find(n => n.id === '0.2.1')).toBeUndefined()
    // 3 branches + leaves of A and B only
    expect(layout.links).toHaveLength(6)
    const collapsed = layout.nodes.find(n => n.id === '0.2')!
    expect(collapsed.collapsed).toBe(true)
    expect(collapsed.childCount).toBe(3)
  })

  it('keeps every node inside the padded canvas', () => {
    const layout = layoutMindmap(tree, new Set())
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y - node.height / 2).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width)
      expect(node.y + node.height / 2).toBeLessThanOrEqual(layout.height)
    }
    expect(layout.width).toBeGreaterThan(MINDMAP_PAD)
  })
})

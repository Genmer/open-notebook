import type { MindmapNode } from './artifact-context'

/**
 * Deterministic left/right mindmap layout for the generated mindmap trees.
 *
 * Nodes are laid out without DOM measurement. The canvas is a symmetric column
 * system centered on the root: column 0 holds the root box, column d (d ≥ 1)
 * holds depth-d nodes on their branch's side, and every box is centered in its
 * column with a fixed gutter. Rows reserve a fixed height slot per leaf and
 * parents center on their children's span. Click-to-collapse is applied by
 * passing the set of collapsed node ids (DFS paths like "0.1.2").
 */

export const MINDMAP_COL_WIDTH = 190
export const MINDMAP_ROW_HEIGHT = 36
export const MINDMAP_CHILD_GAP = 10
export const MINDMAP_PAD = 24

/** Box width inside a column (column minus symmetric gutters). */
const BOX_WIDTH = MINDMAP_COL_WIDTH - MINDMAP_CHILD_GAP * 2

/** Left edge of a depth-d box relative to the root center, per side. */
function boxX(depth: number, side: 'left' | 'right'): number {
  const inner = MINDMAP_COL_WIDTH / 2 + MINDMAP_CHILD_GAP
  const columnOffset = MINDMAP_COL_WIDTH * (depth - 1)
  const total = inner + columnOffset
  return side === 'left' ? -(total + BOX_WIDTH) : total
}

export interface LaidOutNode {
  /** DFS path id, stable for a given tree + collapse state. */
  id: string
  label: string
  /** Left edge of the node box, relative to the SVG viewport. */
  x: number
  /** Vertical center of the node box. */
  y: number
  width: number
  height: number
  depth: number
  childCount: number
  collapsed: boolean
}

export interface MindmapLink {
  /** Cubic bezier path between a parent edge and a child edge. */
  d: string
}

export interface MindmapLayout {
  nodes: LaidOutNode[]
  links: MindmapLink[]
  width: number
  height: number
  /** Where the viewport should scroll to keep the root centered. */
  center: { x: number; y: number }
}

function subtreeHeight(node: MindmapNode, id: string, collapsed: Set<string>): number {
  const children = !collapsed.has(id) ? node.children ?? [] : []
  if (children.length === 0) return MINDMAP_ROW_HEIGHT
  let total = 0
  children.forEach((child, i) => {
    if (i > 0) total += MINDMAP_CHILD_GAP
    total += subtreeHeight(child, `${id}.${i}`, collapsed)
  })
  return Math.max(MINDMAP_ROW_HEIGHT, total)
}

function maxDepth(node: MindmapNode, id: string, collapsed: Set<string>): number {
  if (collapsed.has(id)) return 1
  const children = node.children ?? []
  if (children.length === 0) return 1
  return 1 + Math.max(...children.map((c, i) => maxDepth(c, `${id}.${i}`, collapsed)))
}

/** Distance from the root center to the outer edge of the deepest column. */
function sideExtent(depth: number): number {
  return MINDMAP_COL_WIDTH / 2 + MINDMAP_CHILD_GAP + MINDMAP_COL_WIDTH * (depth - 1) + BOX_WIDTH
}

export function layoutMindmap(root: MindmapNode, collapsed: Set<string>): MindmapLayout {
  const branches = root.children ?? []
  const leftCount = Math.ceil(branches.length / 2)

  // Pass 1: measure — per-branch heights and per-side deepest columns.
  const branchHeights = branches.map((branch, i) =>
    subtreeHeight(branch, `0.${i}`, collapsed)
  )
  const totalBranchHeight = branchHeights.reduce((a, b) => a + b + MINDMAP_CHILD_GAP, 0)
  let leftExtent = 0
  let rightExtent = 0
  branches.forEach((branch, i) => {
    const depth = maxDepth(branch, `0.${i}`, collapsed)
    if (i < leftCount) leftExtent = Math.max(leftExtent, sideExtent(depth))
    else rightExtent = Math.max(rightExtent, sideExtent(depth))
  })

  const width = leftExtent + rightExtent + MINDMAP_PAD * 2
  const contentHeight = Math.max(
    totalBranchHeight - MINDMAP_CHILD_GAP,
    MINDMAP_ROW_HEIGHT
  )
  const height = contentHeight + MINDMAP_PAD * 2
  // Horizontal shift: root center sits leftExtent + PAD from the left edge.
  const rootX = leftExtent + MINDMAP_PAD

  const nodes: LaidOutNode[] = []
  const links: MindmapLink[] = []
  const rootBoxWidth = MINDMAP_COL_WIDTH - MINDMAP_CHILD_GAP * 2
  const rootY = MINDMAP_PAD + contentHeight / 2

  // Root node first so the SVG paints it under the branches.
  nodes.push({
    id: '0',
    label: root.label,
    x: rootX - rootBoxWidth / 2,
    y: rootY,
    width: rootBoxWidth,
    height: MINDMAP_ROW_HEIGHT + 8,
    depth: 0,
    childCount: branches.length,
    collapsed: collapsed.has('0'),
  })

  let branchTop = MINDMAP_PAD
  branches.forEach((branch, i) => {
    const side: 'left' | 'right' = i < leftCount ? 'left' : 'right'
    const height_ = branchHeights[i]

    const place = (node: MindmapNode, id: string, depth: number, center: number): void => {
      const isCollapsed = collapsed.has(id)
      const visibleChildren = !isCollapsed ? node.children ?? [] : []
      const x = rootX + boxX(depth, side)
      const y = branchTop + center
      nodes.push({
        id,
        label: node.label,
        x,
        y,
        width: BOX_WIDTH,
        height: MINDMAP_ROW_HEIGHT - 6,
        depth,
        childCount: (node.children ?? []).length,
        collapsed: isCollapsed,
      })
      // Edge of the parent box facing its children.
      const parentEdge = side === 'left' ? x : x + BOX_WIDTH
      let childCenter = center - subtreeHeight(node, id, collapsed) / 2
      visibleChildren.forEach((child, ci) => {
        const childId = `${id}.${ci}`
        const childHeight = subtreeHeight(child, childId, collapsed)
        const childMiddle = childCenter + childHeight / 2
        const childX = rootX + boxX(depth + 1, side)
        const childEdge = side === 'left' ? childX + BOX_WIDTH : childX
        const dx = childEdge - parentEdge
        links.push({
          d:
            `M ${parentEdge} ${y} ` +
            `C ${parentEdge + dx / 2} ${y} ${childEdge - dx / 2} ${childMiddle} ` +
            `${childEdge} ${childMiddle}`,
        })
        place(child, childId, depth + 1, childMiddle)
        childCenter += childHeight + MINDMAP_CHILD_GAP
      })
    }

    // Root-to-branch link.
    const branchX = rootX + boxX(1, side)
    const rootEdge = side === 'left' ? rootX - rootBoxWidth / 2 : rootX + rootBoxWidth / 2
    const branchEdge = side === 'left' ? branchX + BOX_WIDTH : branchX
    const dx = branchEdge - rootEdge
    links.push({
      d:
        `M ${rootEdge} ${rootY} ` +
        `C ${rootEdge + dx / 2} ${rootY} ${branchEdge - dx / 2} ${branchTop + height_ / 2} ` +
        `${branchEdge} ${branchTop + height_ / 2}`,
    })
    place(branch, `0.${i}`, 1, height_ / 2)
    branchTop += height_ + MINDMAP_CHILD_GAP
  })

  return {
    nodes,
    links,
    width,
    height,
    center: { x: rootX, y: rootY },
  }
}

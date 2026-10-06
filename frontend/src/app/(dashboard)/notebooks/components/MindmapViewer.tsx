'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { MindmapNode } from '@/lib/utils/artifact-context'
import { layoutMindmap } from '@/lib/utils/mindmap-layout'

interface MindmapViewerProps {
  /** Root of the parsed mindmap tree (see parseMindmap). */
  root: MindmapNode
}

/**
 * Interactive left/right mindmap rendering for "mindmap" artifacts stored as
 * notes. Nodes with children collapse on click; the badge shows how many
 * descendants are hidden. Layout is computed offline in mindmap-layout.ts
 * (fixed columns/rows, no DOM measurement), so jsdom renders it fine.
 */
export function MindmapViewer({ root }: MindmapViewerProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const layout = useMemo(() => layoutMindmap(root, collapsed), [root, collapsed])

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className="overflow-auto rounded-md border bg-background"
      data-testid="mindmap-viewer"
    >
      <svg
        width={Math.max(layout.width, 200)}
        height={layout.height}
        role="img"
        aria-label={root.label}
        className="block"
      >
        {layout.links.map((link, i) => (
          <path
            key={i}
            d={link.d}
            fill="none"
            stroke="currentColor"
            className="text-border"
            strokeWidth={1.5}
          />
        ))}
        {layout.nodes.map(node => {
          const isRoot = node.depth === 0
          const collapsible = node.childCount > 0
          const hiddenCount = node.collapsed
            ? countDescendants(root, node.id)
            : 0
          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <foreignObject
                width={node.width}
                height={node.height + 14}
                x={0}
                y={-((node.height + 14) / 2)}
              >
                <button
                  type="button"
                  onClick={collapsible ? () => toggle(node.id) : undefined}
                  aria-expanded={collapsible ? !node.collapsed : undefined}
                  data-testid={`mindmap-node-${node.id}`}
                  className={cn(
                    'flex h-full w-full items-center gap-1 rounded-md border px-2 py-1 text-left text-xs leading-tight transition-colors',
                    isRoot
                      ? 'border-teal/60 bg-teal/10 font-semibold text-teal'
                      : 'bg-background text-foreground',
                    collapsible && 'cursor-pointer hover:border-teal/50 hover:bg-accent/40'
                  )}
                >
                  {collapsible && (
                    <span className="shrink-0 text-muted-foreground" aria-hidden>
                      {node.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}
                  <span className="min-w-0 break-words line-clamp-2">{node.label}</span>
                  {hiddenCount > 0 && (
                    <span
                      className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-[10px] text-muted-foreground"
                      title={t('artifacts.mindmap.hiddenCount', { count: hiddenCount })}
                    >
                      +{hiddenCount}
                    </span>
                  )}
                </button>
              </foreignObject>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Number of descendants under a DFS path id ("0.1.2"), for the +N badge. */
function countDescendants(root: MindmapNode, id: string): number {
  let node: MindmapNode = root
  for (const part of id.split('.').slice(1)) {
    const next = node.children?.[Number(part)]
    if (!next) return 0
    node = next
  }
  let count = 0
  const walk = (current: MindmapNode): void => {
    for (const child of current.children ?? []) {
      count += 1
      walk(child)
    }
  }
  walk(node)
  return count
}

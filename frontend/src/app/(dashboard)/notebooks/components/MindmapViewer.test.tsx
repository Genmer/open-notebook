import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MindmapViewer } from './MindmapViewer'
import type { MindmapNode } from '@/lib/utils/artifact-context'

const tree: MindmapNode = {
  label: '可靠性',
  children: [
    {
      label: '基本概念',
      children: [
        { label: 'MTBF 定义' },
        { label: '计算公式' },
      ],
    },
    {
      label: '冗余设计',
      children: [{ label: '并行冗余' }],
    },
  ],
}

describe('MindmapViewer', () => {
  it('renders the root, branches and leaves as nodes', () => {
    render(<MindmapViewer root={tree} />)

    expect(screen.getByTestId('mindmap-viewer')).toBeInTheDocument()
    expect(screen.getByTestId('mindmap-node-0')).toHaveTextContent('可靠性')
    expect(screen.getByTestId('mindmap-node-0.0')).toHaveTextContent('基本概念')
    expect(screen.getByTestId('mindmap-node-0.0.0')).toHaveTextContent('MTBF 定义')
    expect(screen.getByTestId('mindmap-node-0.1.0')).toHaveTextContent('并行冗余')
  })

  it('collapses a branch on click and shows the hidden-count badge', () => {
    render(<MindmapViewer root={tree} />)

    fireEvent.click(screen.getByTestId('mindmap-node-0.0'))
    expect(screen.queryByTestId('mindmap-node-0.0.0')).not.toBeInTheDocument()
    expect(screen.getByTestId('mindmap-node-0.0')).toHaveTextContent('+2')
    expect(screen.getByTestId('mindmap-node-0.0')).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByTestId('mindmap-node-0.0'))
    expect(screen.getByTestId('mindmap-node-0.0.0')).toBeInTheDocument()
    expect(screen.getByTestId('mindmap-node-0.0')).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves leaf nodes non-interactive', () => {
    render(<MindmapViewer root={tree} />)

    const leaf = screen.getByTestId('mindmap-node-0.0.0')
    expect(leaf).not.toHaveAttribute('aria-expanded')
    fireEvent.click(leaf)
    expect(screen.getByTestId('mindmap-node-0.0.0')).toBeInTheDocument()
  })
})

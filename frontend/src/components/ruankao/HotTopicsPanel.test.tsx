import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HotTopicsPanel } from './HotTopicsPanel'

// F4 占位：纯空态，无统计逻辑、无数据请求（ADR-016）
describe('HotTopicsPanel placeholder', () => {
  it('renders the planned empty state with title and description', () => {
    render(<HotTopicsPanel />)

    expect(screen.getByText('ruankao.hotTopics.plannedTitle')).toBeInTheDocument()
    expect(screen.getByText('ruankao.hotTopics.plannedDesc')).toBeInTheDocument()
  })

  it('shows only the flame icon empty state, no interactive elements', () => {
    render(<HotTopicsPanel />)

    expect(document.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

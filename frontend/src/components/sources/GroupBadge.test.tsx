import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { GroupBadge } from './GroupBadge'

// 空文件夹必须可见（徽章渲染 0），但用淡样式与有内容的文件夹区分。
describe('GroupBadge', () => {
  it('renders the count as-is, including 0', () => {
    const { rerender } = render(<GroupBadge count={3} />)
    expect(screen.getByTestId('group-badge')).toHaveTextContent('3')
    rerender(<GroupBadge count={0} />)
    expect(screen.getByTestId('group-badge')).toHaveTextContent('0')
  })

  it('fades the empty-folder badge (count 0)', () => {
    render(<GroupBadge count={0} />)
    expect(screen.getByTestId('group-badge')).toHaveClass('opacity-50')
  })

  it('keeps non-empty badges at full opacity', () => {
    render(<GroupBadge count={1} />)
    expect(screen.getByTestId('group-badge')).not.toHaveClass('opacity-50')
  })
})

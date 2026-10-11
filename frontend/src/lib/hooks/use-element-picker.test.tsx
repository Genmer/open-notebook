import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useElementPicker, } from './use-element-picker'
import type { PickedElementBlock } from './use-element-picker'

type MockFn = ReturnType<typeof vi.fn>

// 探针宿主：面板+外部目标分离，模拟真实布局
function Probe({
  active,
  onPick,
  onPickEmpty,
  onFinish,
}: {
  active: boolean
  onPick: MockFn
  onPickEmpty: MockFn
  onFinish: MockFn
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // vitest v4 的 Mock 类型与普通函数签名不互认，探针边界转一次类型
  useElementPicker({
    active,
    hostRef,
    onPick: onPick as unknown as (block: PickedElementBlock) => void,
    onPickEmpty: onPickEmpty as unknown as () => void,
    onFinish: onFinish as unknown as () => void,
  })
  return (
    <div>
      <div ref={hostRef} data-testid="host">
        <button type="button">面板内按钮</button>
      </div>
      <p data-testid="target">页面上的目标段落文本</p>
      <div data-testid="empty-target" />
    </div>
  )
}

describe('useElementPicker', () => {
  beforeEach(() => {
    document.body.className = ''
  })

  it('激活时点击外部元素：拦截默认行为并回调抽取文本', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(
      <Probe active onPick={onPick} onPickEmpty={vi.fn()} onFinish={vi.fn()} />,
    )
    const target = getByTestId('target')
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    })
    target.dispatchEvent(clickEvent)
    expect(clickEvent.defaultPrevented).toBe(true)
    expect(onPick).toHaveBeenCalledTimes(1)
    const block = onPick.mock.calls[0][0]
    expect(block.text).toBe('页面上的目标段落文本')
    expect(block.label).toContain('p ·')
  })

  it('宿主内的点击完全放行（不拾取、不拦截）', () => {
    const onPick = vi.fn()
    const { getByText } = render(
      <Probe active onPick={onPick} onPickEmpty={vi.fn()} onFinish={vi.fn()} />,
    )
    const btn = getByText('面板内按钮')
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    })
    btn.dispatchEvent(clickEvent)
    expect(onPick).not.toHaveBeenCalled()
    expect(clickEvent.defaultPrevented).toBe(false)
  })

  it('无可提取文本的元素回调 onPickEmpty', () => {
    const onPickEmpty = vi.fn()
    const { getByTestId } = render(
      <Probe active onPick={vi.fn()} onPickEmpty={onPickEmpty} onFinish={vi.fn()} />,
    )
    fireEvent.click(getByTestId('empty-target'))
    expect(onPickEmpty).toHaveBeenCalledTimes(1)
  })

  it('Escape 结束拾取并拦截（不外泄到应用快捷键）', () => {
    const onFinish = vi.fn()
    render(
      <Probe active onPick={vi.fn()} onPickEmpty={vi.fn()} onFinish={onFinish} />,
    )
    // fireEvent 在 preventDefault 后返回 false，所以断言走 defaultPrevented
    const escEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(escEvent)
    expect(escEvent.defaultPrevented).toBe(true)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('悬停高亮写入内联 outline，卸载后还原', () => {
    const { getByTestId, unmount } = render(
      <Probe active onPick={vi.fn()} onPickEmpty={vi.fn()} onFinish={vi.fn()} />,
    )
    const target = getByTestId('target')
    act(() => {
      fireEvent.mouseOver(target)
    })
    expect(target.style.outline).toContain('2px solid')
    unmount()
    expect(target.style.outline).toBe('')
    expect(document.body.classList.contains('quickask-picking')).toBe(false)
  })

  it('未激活时不挂任何监听', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(
      <Probe active={false} onPick={onPick} onPickEmpty={vi.fn()} onFinish={vi.fn()} />,
    )
    fireEvent.click(getByTestId('target'))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('active 翻转为 false 时清理 body 类', () => {
    const { rerender, getByTestId } = render(
      <Probe active onPick={vi.fn()} onPickEmpty={vi.fn()} onFinish={vi.fn()} />,
    )
    expect(document.body.classList.contains('quickask-picking')).toBe(true)
    rerender(
      <Probe active={false} onPick={vi.fn()} onPickEmpty={vi.fn()} onFinish={vi.fn()} />,
    )
    expect(document.body.classList.contains('quickask-picking')).toBe(false)
    // 关闭后点击不再被拦截
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    getByTestId('target').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
})

describe('useElementPicker（renderHook 冒烟）', () => {
  it('hostRef 为 null 时外部点击仍可拾取', () => {
    const onPick = vi.fn()
    const { result } = renderHook(() =>
      useElementPicker({
        active: true,
        hostRef: { current: null },
        onPick,
        onPickEmpty: vi.fn(),
        onFinish: vi.fn(),
      }),
    )
    expect(result.current).toBeUndefined()
    const p = document.createElement('p')
    p.textContent = '孤立元素'
    document.body.appendChild(p)
    fireEvent.click(p)
    expect(onPick).toHaveBeenCalledTimes(1)
    document.body.removeChild(p)
  })
})

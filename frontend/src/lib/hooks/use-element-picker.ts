'use client'

import { useEffect, useRef } from 'react'

import {
  describeElement,
  extractElementText,
} from '@/lib/quick-ask/element-text'

export interface PickedElementBlock {
  id: string
  label: string
  text: string
}

interface UseElementPickerOptions {
  /** 拾取模式开关 */
  active: boolean
  /** 宿主容器（面板+提示条+启动钮）：其中的点击原样放行，不参与拾取 */
  hostRef: React.RefObject<HTMLElement | null>
  onPick: (block: PickedElementBlock) => void
  onPickEmpty: () => void
  onFinish: () => void
}

const PICKING_BODY_CLASS = 'quickask-picking'

function newBlockId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 页面元素拾取模式：document 捕获阶段拦截 hover/click/Escape，悬停高亮
 * （outline 内联样式，离开即还原），点击抽取文本回调 onPick，可连续拾取，
 * Esc 或 onFinish 结束。宿主内的元素（面板自身 UI）完全放行。
 */
export function useElementPicker({
  active,
  hostRef,
  onPick,
  onPickEmpty,
  onFinish,
}: UseElementPickerOptions) {
  // 回调经 ref 转发：effect 只按 active 挂卸，监听器永远读到最新回调
  const handlersRef = useRef({ onPick, onPickEmpty, onFinish })
  handlersRef.current = { onPick, onPickEmpty, onFinish }

  useEffect(() => {
    if (!active) return

    const handlers = handlersRef

    let prev: HTMLElement | null = null
    let prevOutline = ''

    const restore = () => {
      if (prev) {
        prev.style.outline = prevOutline
        prev = null
      }
    }
    const inHost = (el: Element | null) =>
      !!(hostRef.current && el && hostRef.current.contains(el))
    const pickable = (el: Element | null): el is HTMLElement =>
      el instanceof HTMLElement &&
      !inHost(el) &&
      el !== document.body &&
      el !== document.documentElement

    const onMouseOver = (e: Event) => {
      const target = e.target as HTMLElement
      if (!pickable(target)) return
      if (prev === target) return
      restore()
      prev = target
      prevOutline = target.style.outline
      target.style.outline = '2px solid var(--color-primary, #3b82f6)'
      target.style.outlineOffset = '-2px'
    }
    const onPointerDown = (e: Event) => {
      if (inHost(e.target as Element | null)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement
      if (inHost(target)) return
      e.preventDefault()
      e.stopPropagation()
      if (!pickable(target)) return
      const text = extractElementText(target)
      if (!text) {
        handlers.current.onPickEmpty()
        return
      }
      handlers.current.onPick({
        id: newBlockId(),
        label: describeElement(target),
        text,
      })
    }
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      handlers.current.onFinish()
    }

    document.body.classList.add(PICKING_BODY_CLASS)
    document.addEventListener('mouseover', onMouseOver, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeydown, true)
    return () => {
      restore()
      document.body.classList.remove(PICKING_BODY_CLASS)
      document.removeEventListener('mouseover', onMouseOver, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeydown, true)
    }
  }, [active, hostRef])
}

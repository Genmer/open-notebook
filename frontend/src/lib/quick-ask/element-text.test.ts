import { describe, expect, it } from 'vitest'

import {
  describeElement,
  extractElementText,
  MAX_ELEMENT_TEXT_CHARS,
} from './element-text'

function divWith(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.textContent = text
  return el
}

describe('extractElementText', () => {
  it('抽取可见文本并折叠空白（3+ 连续空行压成 1 空行）', () => {
    const el = divWith('第一行\n\n\n\n第二行  \n 第三行')
    // 折叠规则只删行尾空白与 3+ 连空行，行首空格保留
    expect(extractElementText(el)).toBe('第一行\n\n第二行\n 第三行')
  })

  it('无文本时回退表单值', () => {
    const input = document.createElement('input')
    input.value = '搜索关键词'
    expect(extractElementText(input)).toBe('搜索关键词')
  })

  it('表单值也空时回退 aria-label → title → placeholder', () => {
    const el = document.createElement('div')
    el.setAttribute('aria-label', '保存按钮')
    expect(extractElementText(el)).toBe('保存按钮')
    el.removeAttribute('aria-label')
    el.setAttribute('title', '悬停提示')
    expect(extractElementText(el)).toBe('悬停提示')
    el.removeAttribute('title')
    el.setAttribute('placeholder', '请输入')
    expect(extractElementText(el)).toBe('请输入')
  })

  it('超长文本截断到与后端一致的字符上限', () => {
    const el = divWith('x'.repeat(MAX_ELEMENT_TEXT_CHARS + 500))
    expect(extractElementText(el).length).toBe(MAX_ELEMENT_TEXT_CHARS)
  })

  it('纯空白元素返回空串（拾取侧据此提示不可提取）', () => {
    expect(extractElementText(divWith('   \n  '))).toBe('')
  })
})

describe('describeElement', () => {
  it('tag + 首行文本（截断到 16 字符）', () => {
    const el = divWith('负载均衡章节的正文片段第一行共十八个字哦\n第二行')
    expect(describeElement(el)).toBe('div · 负载均衡章节的正文片段第一行共十')
  })

  it('无文本时回退 aria-label', () => {
    const el = document.createElement('button')
    el.setAttribute('aria-label', '关闭')
    expect(describeElement(el)).toBe('button · 关闭')
  })

  it('完全无标签时只给 tag', () => {
    expect(describeElement(document.createElement('span'))).toBe('span')
  })
})

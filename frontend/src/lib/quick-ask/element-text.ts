// 快捷问答「选取页面元素」的纯文本抽取器（无 DOM 副作用，可单测）。
// 字符上限与后端 MAX_CONTEXT_BLOCK_CHARS 对齐，超长元素截断。

export const MAX_ELEMENT_TEXT_CHARS = 8000

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 优先可见文本（innerText），空则回退表单值/无障碍属性。 */
export function extractElementText(el: HTMLElement): string {
  let text = collapseWhitespace(el.innerText || el.textContent || '')
  if (!text) {
    const field = el as HTMLInputElement | HTMLTextAreaElement
    text =
      (typeof field.value === 'string' && field.value) ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      ''
    text = text.trim()
  }
  return text.slice(0, MAX_ELEMENT_TEXT_CHARS)
}

/** 拾取芯片上的短标签：`tag · 首行文本`（超长截断）。 */
export function describeElement(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  const firstLine = collapseWhitespace(el.innerText || el.textContent || '')
    .split('\n')[0]
    ?.slice(0, 16)
  const label =
    firstLine ||
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.getAttribute('placeholder') ||
    ''
  const shown = label.slice(0, 16)
  return shown ? `${tag} · ${shown}` : tag
}

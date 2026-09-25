import type { TFunction } from 'i18next'

// 默认视图在 DB 固定存英文占位名；未改名时按固定 id 走 i18n，改过名则尊重用户输入
const DEFAULT_VIEW_NAME_KEYS: Record<string, { db: string; key: string }> = {
  'source_view:ai_content': { db: 'AI Content', key: 'sources.grouping.aiContentViewName' },
  'source_view:ai_title': { db: 'AI Filename', key: 'sources.grouping.aiTitleViewName' },
}

export function displayViewName(
  view: { id: string; name: string },
  t: TFunction
): string {
  const preset = DEFAULT_VIEW_NAME_KEYS[view.id]
  if (preset && view.name === preset.db) return t(preset.key)
  return view.name
}

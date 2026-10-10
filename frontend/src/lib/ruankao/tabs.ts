import { createElement, type ReactNode } from 'react'
import { EnvironmentsPanel } from '@/components/ruankao/EnvironmentsPanel'
import { HotTopicsPanel } from '@/components/ruankao/HotTopicsPanel'

// 软考模块 tab 注册表：全模块 tab 唯一事实源（key/labelKey/testid/renderContent 槽）。
// 内容槽 null 的 tab 不渲染，各段填槽后自动出现：
// 第二段填 questionBank、第三段填 modelLibrary、第四段(+第五段)填 essay。
export type RuankaoTabKey =
  | 'environments'
  | 'questionBank'
  | 'modelLibrary'
  | 'essay'
  | 'hotTopics'

export interface RuankaoTabDef {
  key: RuankaoTabKey
  labelKey: string
  testid: string
  renderContent: (() => ReactNode) | null
}

export const RUANKAO_TABS: readonly RuankaoTabDef[] = [
  {
    key: 'environments',
    labelKey: 'ruankao.tabs.environments',
    testid: 'ruankao-tab-environments',
    renderContent: () => createElement(EnvironmentsPanel),
  },
  {
    key: 'questionBank',
    labelKey: 'ruankao.tabs.questionBank',
    testid: 'ruankao-tab-questionBank',
    renderContent: null,
  },
  {
    key: 'modelLibrary',
    labelKey: 'ruankao.tabs.modelLibrary',
    testid: 'ruankao-tab-modelLibrary',
    renderContent: null,
  },
  {
    key: 'essay',
    labelKey: 'ruankao.tabs.essay',
    testid: 'ruankao-tab-essay',
    renderContent: null,
  },
  {
    key: 'hotTopics',
    labelKey: 'ruankao.tabs.hotTopics',
    testid: 'ruankao-tab-hotTopics',
    renderContent: () => createElement(HotTopicsPanel),
  },
]

// 深链 ?tab=<key> 的合法取值：只认当前已渲染（内容槽非 null）的 tab，
// 未交付段的 key 深链回落第一项，避免落在空内容区
export function visibleRuankaoTabs(): readonly RuankaoTabDef[] {
  return RUANKAO_TABS.filter((tab) => tab.renderContent !== null)
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/lib/hooks/use-translation'
import { visibleRuankaoTabs, type RuankaoTabKey } from '@/lib/ruankao/tabs'

// 模块页（结构同 tasks 页先例）：tab 状态本地 useState 不记忆；
// ?tab=<key> 作深链初始值，且跟随同页 router.push 变化（题库详情动作
// 会推 ?tab=essay&read=… / ?tab=environments）——点击切换仍不改 URL
export default function RuankaoPage() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const tabs = useMemo(() => visibleRuankaoTabs(), [])
  const deepLinkTab = searchParams?.get('tab')
  const firstTab = tabs[0]?.key as RuankaoTabKey | undefined
  const initialTab = tabs.some((tab) => tab.key === deepLinkTab)
    ? (deepLinkTab as RuankaoTabKey)
    : firstTab
  const [activeTab, setActiveTab] = useState<RuankaoTabKey | undefined>(initialTab)

  // 深链同步 effect：URL 里的合法 ?tab= 变化时跟随（非法值不打扰当前 tab）
  useEffect(() => {
    if (deepLinkTab && tabs.some((tab) => tab.key === deepLinkTab)) {
      setActiveTab(deepLinkTab as RuankaoTabKey)
    }
  }, [deepLinkTab, tabs])

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* 内容列宽约定（L 线 §2.1）：列表/表格型容器 mx-auto max-w-6xl，
            宽视口下内容列恒 1152px 居中；testid 供布局门禁断言 */}
        <div className="mx-auto max-w-6xl p-6 space-y-6" data-testid="ruankao-page-content">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {t('ruankao.title')}
            </h1>
            <p className="text-muted-foreground mt-1">{t('ruankao.description')}</p>
          </div>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as RuankaoTabKey)}>
            <TabsList>
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  data-testid={tab.testid}
                  className="min-w-max gap-1.5 whitespace-nowrap"
                >
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) => (
              <TabsContent key={tab.key} value={tab.key}>
                {tab.renderContent?.()}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </AppShell>
  )
}

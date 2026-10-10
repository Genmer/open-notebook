'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/lib/hooks/use-translation'
import { visibleRuankaoTabs, type RuankaoTabKey } from '@/lib/ruankao/tabs'

// 模块页（结构同 tasks 页先例）：tab 状态本地 useState 不记忆；
// ?tab=<key> 仅作深链初始值（先例 search/page.tsx），点击切换从不改 URL
export default function RuankaoPage() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const tabs = visibleRuankaoTabs()
  const deepLinkTab = searchParams?.get('tab')
  const firstTab = tabs[0]?.key as RuankaoTabKey | undefined
  const initialTab = tabs.some((tab) => tab.key === deepLinkTab)
    ? (deepLinkTab as RuankaoTabKey)
    : firstTab
  const [activeTab, setActiveTab] = useState<RuankaoTabKey | undefined>(initialTab)

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
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

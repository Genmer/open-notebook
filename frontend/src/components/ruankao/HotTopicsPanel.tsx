'use client'

import { Flame } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { useTranslation } from '@/lib/hooks/use-translation'

// 考点热度榜占位（F4）：纯空态，无统计逻辑、无数据请求
export function HotTopicsPanel() {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={Flame}
      title={t('ruankao.hotTopics.plannedTitle')}
      description={t('ruankao.hotTopics.plannedDesc')}
    />
  )
}

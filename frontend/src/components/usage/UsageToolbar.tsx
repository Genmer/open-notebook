'use client'

import { useTranslation } from '@/lib/hooks/use-translation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const RANGE_CHOICES = [7, 30, 90] as const

// call_type values written by the backend graphs module, with their label
// keys spelled out so the unused-key lint stays satisfied.
export const CALL_TYPE_CHOICES = [
  { value: 'chat', labelKey: 'usage.typeChat' },
  { value: 'embedding', labelKey: 'usage.typeEmbedding' },
  { value: 'transformation', labelKey: 'usage.typeTransformation' },
  { value: 'ask', labelKey: 'usage.typeAsk' },
  { value: 'source_chat', labelKey: 'usage.typeSourceChat' },
  { value: 'prompt', labelKey: 'usage.typePrompt' },
] as const

const ALL_VALUE = '__all__'

interface UsageToolbarProps {
  days: number
  onDaysChange: (days: number) => void
  callType: string
  onCallTypeChange: (callType: string) => void
}

export default function UsageToolbar({
  days,
  onDaysChange,
  callType,
  onCallTypeChange,
}: UsageToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs value={String(days)} onValueChange={(value) => onDaysChange(Number(value))}>
        <TabsList aria-label={t('usage.timeRange')} className="h-8">
          {RANGE_CHOICES.map((choice) => (
            <TabsTrigger
              key={choice}
              value={String(choice)}
              className="h-7 flex-none whitespace-nowrap px-3 text-xs"
            >
              {t('usage.lastNDays', { days: choice })}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Select
        value={callType || ALL_VALUE}
        onValueChange={(value) => onCallTypeChange(value === ALL_VALUE ? '' : value)}
      >
        <SelectTrigger
          size="sm"
          className="w-[150px]"
          aria-label={t('usage.filterByType')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t('usage.typeAll')}</SelectItem>
          {CALL_TYPE_CHOICES.map(({ value, labelKey }) => (
            <SelectItem key={value} value={value}>
              {t(labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

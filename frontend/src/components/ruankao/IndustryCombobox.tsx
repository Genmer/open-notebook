'use client'

import { useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  filterIndustryPool,
  INDUSTRY_MAX_CHARS,
  industryTitleLines,
} from '@/lib/ruankao/industry-pool'

// mock 向导行业输入（F3-c + R2）：可搜索选择 INDUSTRY_POOL + 任意自由文本。
// 触发器保留真实 input（data-testid=env-mock-industry），change 事件语义与旧 Input 一致
interface IndustryComboboxProps {
  id: string
  value: string
  onChange: (value: string) => void
}

export function IndustryCombobox({ id, value, onChange }: IndustryComboboxProps) {
  const { t } = useTranslation()
  const filtered = useMemo(() => filterIndustryPool(value), [value])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Input
          id={id}
          // PopoverTrigger 的 Slot 会给子元素强塞 type="button"，必须显式压回 text
          type="text"
          value={value}
          maxLength={INDUSTRY_MAX_CHARS}
          data-testid="env-mock-industry"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            // 回车=选中第一条池内命中；无命中时保留自由文本（自定义兜底）
            if (filtered.length > 0) onChange(filtered[0]?.name)
          }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>{t('ruankao.industry.noMatch')}</CommandEmpty>
            <CommandGroup>
              {filtered.map((entry) => (
                <CommandItem
                  key={entry.name}
                  value={entry.name}
                  onSelect={() => onChange(entry.name)}
                  // hover 解释走池内 hint + 画像（tech-glossary 先例：原生 title，未命中静默退化）
                  title={industryTitleLines(entry, t).join('\n')}
                >
                  {entry.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

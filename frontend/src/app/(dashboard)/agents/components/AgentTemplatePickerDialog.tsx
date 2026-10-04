'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  AGENT_TEMPLATES,
  AGENT_TEMPLATE_CATEGORIES,
  pickTemplateText,
  type AgentTemplate,
} from '@/lib/agent-templates'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

// Static full-key literals (not a dynamic template string) so each key stays
// greppable — the locales unused-key test scans sources for exact key text.
// 自 AgentEditorDialog 迁入：模板 Select 退役后，分组标题改由本面板承载。
const TEMPLATE_CATEGORY_KEYS: Record<AgentTemplate['category'], string> = {
  software: 'agents.templateCat.software',
  llm: 'agents.templateCat.llm',
  business: 'agents.templateCat.business',
  education: 'agents.templateCat.education',
  creative: 'agents.templateCat.creative',
  general: 'agents.templateCat.general',
}

interface AgentTemplatePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 确认选择：返回模板 key；'blank' 表示从空白开始。 */
  onConfirm: (templateKey: string) => void
}

/** 模板卡外框：未选中时悬停提亮，选中时主色描边 + 细环。 */
const templateCardClass = (isSelected: boolean) =>
  cn(
    'flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left outline-none transition-colors',
    isSelected ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent/50'
  )

export function AgentTemplatePickerDialog({
  open,
  onOpenChange,
  onConfirm,
}: AgentTemplatePickerDialogProps) {
  const { t, language } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)

  // 每次打开面板都重置选中态，避免上一次的选择残留。
  useEffect(() => {
    if (open) setSelected(null)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        data-testid="agent-template-picker"
      >
        <DialogHeader>
          <DialogTitle>{t('agents.templateLabel')}</DialogTitle>
          <DialogDescription>{t('agents.templatePickerDesc')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="max-h-[55vh] pr-3">
            <RadioGroup
              value={selected ?? ''}
              onValueChange={setSelected}
              className="gap-0"
            >
              {AGENT_TEMPLATE_CATEGORIES.map(({ key: category }, index) => (
                <section key={category} className={index > 0 ? 'pt-2' : undefined}>
                  <h3 className="sticky top-0 z-10 bg-background py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(TEMPLATE_CATEGORY_KEYS[category])}
                  </h3>
                  <div className="grid gap-3 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                    {/* 首个分组的首格：「从空白开始」虚线卡，不套用任何模板。 */}
                    {index === 0 && (
                      <label
                        data-testid="agent-template-blank"
                        className={cn(
                          'rounded-lg border border-dashed p-3',
                          templateCardClass(selected === 'blank')
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-semibold truncate">
                            {t('agents.templateBlankName')}
                          </span>
                          <RadioGroupItem value="blank" className="mt-0.5" />
                        </span>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {t('agents.templateBlankDesc')}
                        </p>
                      </label>
                    )}
                    {AGENT_TEMPLATES.filter((tpl) => tpl.category === category).map(
                      (tpl) => (
                        <label
                          key={tpl.key}
                          data-testid={`agent-template-card-${tpl.key}`}
                          className={templateCardClass(selected === tpl.key)}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="font-semibold truncate">
                              {pickTemplateText(tpl.name, language)}
                            </span>
                            <RadioGroupItem value={tpl.key} className="mt-0.5" />
                          </span>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {pickTemplateText(tpl.description, language)}
                          </p>
                          <span className="flex flex-wrap gap-1.5">
                            <Badge variant="outline" className="text-xs">
                              {t('agents.temperatureLabel', { value: tpl.temperature })}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {t('agents.maxTokensLabel', { value: tpl.maxTokens })}
                            </Badge>
                          </span>
                        </label>
                      )
                    )}
                  </div>
                </section>
              ))}
            </RadioGroup>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              if (selected) onConfirm(selected)
            }}
            disabled={!selected}
            data-testid="agent-template-use"
          >
            {t('agents.templateUse')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

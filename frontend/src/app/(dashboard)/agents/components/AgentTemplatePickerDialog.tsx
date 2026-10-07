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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AGENT_TEMPLATES,
  AGENT_TEMPLATE_CATEGORIES,
  pickTemplateText,
  type AgentTemplate,
} from '@/lib/agent-templates'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import {
  Award,
  BrainCircuit,
  Briefcase,
  Code2,
  GraduationCap,
  Palette,
  PenLine,
  Shapes,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

// Static full-key literals (not a dynamic template string) so each key stays
// greppable — the locales unused-key test scans sources for exact key text.
// 自 AgentEditorDialog 迁入：模板 Select 退役后，分组标题改由本面板承载。
const TEMPLATE_CATEGORY_KEYS: Record<AgentTemplate['category'], string> = {
  software: 'agents.templateCat.software',
  ruankao: 'agents.templateCat.ruankao',
  llm: 'agents.templateCat.llm',
  business: 'agents.templateCat.business',
  education: 'agents.templateCat.education',
  creative: 'agents.templateCat.creative',
  general: 'agents.templateCat.general',
}

// 每个分类一套完整字面量类名（Tailwind 只提取源码里出现的完整类）+ 代表图标：
// 分类标题用彩色圆点、模板卡用彩色圆底图标，避免面板通篇黑白。
const CATEGORY_STYLE: Record<
  AgentTemplate['category'],
  { dot: string; tile: string; Icon: LucideIcon }
> = {
  software: {
    dot: 'bg-blue-500',
    tile: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    Icon: Code2,
  },
  ruankao: {
    dot: 'bg-rose-500',
    tile: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    Icon: Award,
  },
  llm: {
    dot: 'bg-violet-500',
    tile: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    Icon: BrainCircuit,
  },
  business: {
    dot: 'bg-amber-500',
    tile: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    Icon: Briefcase,
  },
  education: {
    dot: 'bg-emerald-500',
    tile: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    Icon: GraduationCap,
  },
  creative: {
    dot: 'bg-pink-500',
    tile: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
    Icon: Palette,
  },
  general: {
    dot: 'bg-slate-500',
    tile: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
    Icon: Shapes,
  },
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

/**
 * 金色「专业深化」徽章：标记提示词经专业备考资料深化过的模板。
 * 金色用本仓库 amber 系令牌 text-gold（双主题自动切换），不用 Tailwind 原生
 * amber-*（会绕过暗色令牌）；图标选 Sparkles 而非 Award——ruankao 分类图标
 * 已用 Award，避免混淆（Sparkles 已在 ParallelLiveCard 承担「AI 增强」金标语义）。
 * 位于卡片 <label> 内：点击徽章会联动选中该模板，与点名称行为一致。
 */
function GoldDeepenedBadge({ tplKey }: { tplKey: string }) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={t('agents.templateGoldBadge')}
          data-testid={`agent-template-gold-${tplKey}`}
          className="shrink-0 text-gold"
        >
          <Sparkles className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-semibold">{t('agents.templateGoldBadge')}</p>
        <p>{t('agents.templateGoldBadgeDesc')}</p>
      </TooltipContent>
    </Tooltip>
  )
}

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
        className="sm:max-w-4xl h-[85vh] flex flex-col overflow-hidden"
        data-testid="agent-template-picker"
      >
        <DialogHeader>
          <DialogTitle>{t('agents.templateLabel')}</DialogTitle>
          <DialogDescription>{t('agents.templatePickerDesc')}</DialogDescription>
        </DialogHeader>

        {/* 滚动约束链：Radix ScrollArea 的 root 带 inline position:relative、
            viewport 是 height:100%——percentage 只在父级高度与内容无关时才
            解析。max-h-[85vh]（仅上限）会让中间层高度依赖内容而解析失败、
            表现为滚不动；弹窗定高 h-[85vh] + min-h-0 flex-1 + h-full 才能把
            确定高度一路传到 viewport（模板 22+ 张，定高无浪费）。 */}
        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full pr-3">
            <RadioGroup
              value={selected ?? ''}
              onValueChange={setSelected}
              className="gap-0"
            >
              {AGENT_TEMPLATE_CATEGORIES.map(({ key: category }, index) => {
                const { dot } = CATEGORY_STYLE[category]
                return (
                  <section key={category} className={index > 0 ? 'pt-2' : undefined}>
                    <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-background py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className={cn('size-2 rounded-full', dot)} />
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
                          <span className="flex items-start gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <PenLine className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1 space-y-1.5">
                              <span className="flex items-start justify-between gap-2">
                                <span className="font-semibold truncate">
                                  {t('agents.templateBlankName')}
                                </span>
                                <RadioGroupItem value="blank" className="mt-0.5" />
                              </span>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {t('agents.templateBlankDesc')}
                              </p>
                            </span>
                          </span>
                        </label>
                      )}
                      {AGENT_TEMPLATES.filter((tpl) => tpl.category === category).map(
                        (tpl) => {
                          const { tile, Icon } = CATEGORY_STYLE[tpl.category]
                          return (
                            <label
                              key={tpl.key}
                              data-testid={`agent-template-card-${tpl.key}`}
                              className={templateCardClass(selected === tpl.key)}
                            >
                              <span className="flex items-start gap-2.5">
                                <span
                                  className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                    tile
                                  )}
                                >
                                  <Icon className="size-4" />
                                </span>
                                <span className="min-w-0 flex-1 space-y-1.5">
                                  <span className="flex items-start justify-between gap-2">
                                    <span className="font-semibold truncate">
                                      {pickTemplateText(tpl.name, language)}
                                    </span>
                                    {tpl.deepened && <GoldDeepenedBadge tplKey={tpl.key} />}
                                    <RadioGroupItem value={tpl.key} className="mt-0.5" />
                                  </span>
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {pickTemplateText(tpl.description, language)}
                                  </p>
                                </span>
                              </span>
                              <span className="flex flex-wrap gap-1.5 pl-10.5">
                                <Badge variant="outline" className="text-xs">
                                  {t('agents.temperatureLabel', { value: tpl.temperature })}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {t('agents.maxTokensLabel', { value: tpl.maxTokens })}
                                </Badge>
                              </span>
                            </label>
                          )
                        }
                      )}
                    </div>
                  </section>
                )
              })}
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

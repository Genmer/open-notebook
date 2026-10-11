'use client'

import {
  ArrowDownToLine,
  CircleCheck,
  Gauge,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  BODY_HARD_CAP,
  SECTION_BASELINES,
  SECTION_TARGET_TOTAL,
  bodyState,
  capacityPercent,
  countChars,
  sectionState,
  type SectionState,
} from '@/lib/ruankao/essay-guardrails'
import type { RuankaoEssaySections } from '@/lib/ruankao/essay-drafts'

// 段四态 → 图标与配色（状态不许只靠颜色区分——warn 与 danger 色相几乎同，
// 每态都有独立图标；ok 出对勾，字数即状态）。导出给完整度 chips 复用，
// 图标语言全模块一致。
export const SECTION_STATE_ICONS: Record<SectionState, LucideIcon> = {
  ok: CircleCheck,
  under: ArrowDownToLine,
  near: TriangleAlert,
  over: XCircle,
}

export const SECTION_STATE_TEXT_KEYS: Record<Exclude<SectionState, 'ok'>, string> = {
  under: 'ruankao.essay.write.legendUnder',
  near: 'ruankao.essay.write.legendNear',
  over: 'ruankao.essay.write.legendOver',
}

const SECTION_STATE_CLASS: Record<SectionState, string> = {
  under: 'text-warn',
  ok: '',
  near: 'text-warn',
  over: 'text-destructive',
}

// 泳道填充色：达标/未达 = 段本色；偏多 = warn；超限 = destructive
function laneFillClass(state: SectionState, sectionColor: string): string {
  if (state === 'over') return 'bg-destructive'
  if (state === 'near') return 'bg-warn'
  return sectionColor
}

interface EssayCapacityBarProps {
  sections: RuankaoEssaySections
}

/**
 * 论文容量模块（写作台仪表）：五段固定泳道占比条（宽 = 目标/2700）+ 图例
 * chip 行 + 头部「正文合计」总量区。纯呈现，零 AI、零后端；只提示不拦截。
 */
export function EssayCapacityBar({ sections }: EssayCapacityBarProps) {
  const { t } = useTranslation()

  const rows = SECTION_BASELINES.map((b) => {
    const chars = countChars(sections[b.key])
    return { baseline: b, chars, state: sectionState(b.key, chars) }
  })

  const total =
    countChars(sections.background) +
    countChars(sections.question2) +
    countChars(sections.arguments) +
    countChars(sections.closing)
  const body = bodyState(total)
  const bodyClass =
    body === 'over' ? 'text-destructive' : body === 'ok' ? '' : 'text-warn'
  // 裁决 #9：恰好 2500 显示「已达硬上限」预警；>2500 才是「超出硬上限」报错口径
  const bodyStateKey =
    body === 'thin'
      ? 'ruankao.essay.write.bodyThin'
      : body === 'near'
        ? 'ruankao.essay.write.bodyNear'
        : body === 'over'
          ? total === BODY_HARD_CAP
            ? 'ruankao.essay.write.bodyAtCap'
            : 'ruankao.essay.write.overLimit'
          : null

  return (
    <Card data-testid="ruankao-write-capacity">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-fern" aria-hidden />
          {t('ruankao.essay.write.capacityTitle')}
        </CardTitle>
        <CardDescription className="sr-only">
          {t('ruankao.essay.write.capacityAria')}
        </CardDescription>
        {/* 总量区：正文合计大字 + 四态梯度（thin/ok/near/over） */}
        <CardAction>
          <div
            data-testid="ruankao-write-body-total"
            className={`text-right ${bodyClass}`}
          >
            <p className="font-mono text-2xl leading-tight tabular-nums md:text-3xl">
              {t('ruankao.essay.write.bodyTotal', { count: total })}
            </p>
            {bodyStateKey && <p className="text-xs">{t(bodyStateKey)}</p>}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* 五泳道单轨：宽 = 目标/2700（basis 之和由构造恒等于 100%），
            泳道内填充 = min(字数/目标, 1) */}
        <div
          className="flex w-full overflow-hidden rounded-full bg-muted"
          aria-label={t('ruankao.essay.write.capacityAria')}
        >
          {rows.map(({ baseline, chars, state }) => (
            <div
              key={baseline.key}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={baseline.target}
              aria-valuenow={chars}
              aria-label={t('ruankao.essay.write.legendCount', {
                name: t(baseline.nameKey),
                count: chars,
                target: baseline.target,
              })}
              data-testid={`ruankao-write-lane-${baseline.key}`}
              className="h-2 overflow-hidden"
              style={{ flexBasis: `${(baseline.target / SECTION_TARGET_TOTAL) * 100}%` }}
            >
              <span
                data-testid={`ruankao-write-lane-fill-${baseline.key}`}
                className={cn('block h-full', laneFillClass(state, baseline.colorClass))}
                style={{ width: `${capacityPercent(chars, baseline.target)}%` }}
              />
            </div>
          ))}
        </div>
        {/* 图例 chip 行：色点 + 段名 + 当前/目标 + 四态图标与文字 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {rows.map(({ baseline, chars, state }) => {
            const StateIcon = SECTION_STATE_ICONS[state]
            return (
              <span
                key={baseline.key}
                data-testid={`ruankao-write-legend-${baseline.key}`}
                className="flex items-center gap-1"
              >
                <span aria-hidden className={cn('h-2 w-2 rounded-full', baseline.colorClass)} />
                <span>
                  {t('ruankao.essay.write.legendCount', {
                    name: t(baseline.nameKey),
                    count: chars,
                    target: baseline.target,
                  })}
                </span>
                {state === 'ok' ? (
                  <StateIcon className="h-3 w-3 text-fern" aria-hidden />
                ) : (
                  <span className={cn('flex items-center gap-0.5', SECTION_STATE_CLASS[state])}>
                    <StateIcon className="h-3 w-3" aria-hidden />
                    {t(SECTION_STATE_TEXT_KEYS[state], {
                      count: Math.max(0, chars - baseline.hard),
                    })}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

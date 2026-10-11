import { Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  formatStreamElapsed,
  type StreamMetricsSample,
} from '@/lib/ruankao/stream-metrics'

// 阶段名 → i18n 键（全字面量映射，过 Unused Key Detection 门禁）；后端 stage
// 取值固定 preparing/waiting/thinking/generating，未知值不渲染阶段行。
const STAGE_KEY_BY_NAME: Record<string, string> = {
  preparing: 'ruankao.questionBank.workbench.stream.stage.preparing',
  waiting: 'ruankao.questionBank.workbench.stream.stage.waiting',
  thinking: 'ruankao.questionBank.workbench.stream.stage.thinking',
  generating: 'ruankao.questionBank.workbench.stream.stage.generating',
}

// 题库工作台生成态面板：流光条（动画心跳）+ 速度/峰值/已用时/token 数 +
// 输出尾部滚动（数据流可见性）。数据口径见 stream-metrics.ts。
// 用户裁决（2026-10-11）：不好展示数据流过程的大模型流程，至少展示
// 当前 token 速度、最高速度和已生成时间。
export function GenerationStatusPanel({
  title,
  metrics,
  testId,
  stage,
  onStop,
}: {
  title: string
  metrics: StreamMetricsSample
  testId: string
  /** SSE stage 事件值；非空时在标题行下渲染一行阶段文案 */
  stage?: string
  /** 存在时在面板右上渲染停止按钮（终止语义=丢弃，见 QuestionBankPanel） */
  onStop?: () => void
}) {
  const { t } = useTranslation()
  const stageKey = stage != null ? STAGE_KEY_BY_NAME[stage] : undefined
  return (
    <div
      className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2.5"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
        <span>{title}</span>
        {onStop && (
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            data-testid={`${testId}-stop`}
            aria-label={t('ruankao.questionBank.workbench.stopGeneration')}
            title={t('ruankao.questionBank.workbench.stopGeneration')}
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {stageKey && (
        <p
          className="text-xs text-muted-foreground"
          data-testid={`${testId}-stage`}
        >
          {t(stageKey)}
        </p>
      )}
      {/* 不定长流光条：有 token 就在动，静默期（思考中）靠 keep-alive 维持连接 */}
      <div
        className="relative h-1 overflow-hidden rounded-full bg-muted"
        aria-hidden
      >
        <div className="qstream-bar absolute inset-y-0 w-1/3 rounded-full bg-primary/70" />
      </div>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
        data-testid={`${testId}-metrics`}
      >
        <span className="tabular-nums">
          {t('ruankao.questionBank.workbench.stream.speed', {
            value: metrics.speedTps.toFixed(1),
          })}
        </span>
        <span className="tabular-nums">
          {t('ruankao.questionBank.workbench.stream.peak', {
            value: metrics.peakTps.toFixed(1),
          })}
        </span>
        <span className="tabular-nums">
          {t('ruankao.questionBank.workbench.stream.elapsed', {
            value: formatStreamElapsed(metrics.elapsedMs),
          })}
        </span>
        <span className="tabular-nums">
          {t('ruankao.questionBank.workbench.stream.tokens', {
            value: metrics.tokens.toLocaleString(),
          })}
        </span>
      </div>
      {metrics.tail && (
        <p
          className="truncate font-mono text-[11px] leading-relaxed text-muted-foreground/70"
          data-testid={`${testId}-tail`}
          aria-hidden
        >
          …{metrics.tail}
        </p>
      )}
    </div>
  )
}

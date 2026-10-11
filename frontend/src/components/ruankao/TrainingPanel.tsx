'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, History, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { writeCoachHandoff } from '@/lib/ruankao/coach-handoff'
import {
  createDraft,
  loadDrafts,
  saveDrafts,
  type RuankaoEssayDraft,
} from '@/lib/ruankao/essay-drafts'
import {
  countChars,
  guardArguments,
  guardQ2,
  type SectionGuard,
} from '@/lib/ruankao/essay-guardrails'
import { loadQuestions, type RuankaoQuestion } from '@/lib/ruankao/question-bank'
import {
  ARG_SECTION_TARGET,
  Q2_TARGET,
  appendSession,
  clearSessions,
  isTargetMet,
  loadSessions,
  newSessionId,
  type RuankaoTrainingSession,
} from '@/lib/ruankao/training-store'

// ── 憋字训练（批次5，essay tab 的 train 子视图）──────────────────────────
// 把教练七步流第 4 步「提纲先行、正文必须考生自己写、你不代写」从对话里的
// 自律要求变成有计时、有字数门、无 AI 退路的训练器械。红线与 AI 边界：
// 训练器零模型调用零检索零范文库读取；卡壳引导是静态文案；唯一的 AI 出口是
// 交卷后「复制发教练批改」——走批次4 的 coach-handoff 桥（预填不代发）。

type TrainPhase = 'setup' | 'run' | 'done'
type TimerMode = 'perSection' | 'fullSimulation'
type RunSection = 'arguments' | 'question2'

// 按段计时默认口径（设计稿 5.2）：论点段 25 分钟 + 问题2 20 分钟；全篇 120 分钟
const DEFAULT_ARG_MINUTES = 25
const DEFAULT_Q2_MINUTES = 20
const DEFAULT_TOTAL_MINUTES = 120

// 「存为写作台草稿」的目标：新稿（标题=题目）或追加到既有草稿。Radix Select
// 不接受空串 value，新稿用哨兵（写作台 NONE_ENV 同款）
const NEW_DRAFT_TARGET = '__new__'

// mm:ss（小时以上自然溢出位数，如 120:00）
export function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec))
  const mm = Math.floor(safe / 60)
  const ss = safe % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/** 把本轮训练写入写作台草稿：目标为新稿则新建（标题=题目，论点区/问题2 两段
 * 落入对应桶）；目标为既有草稿则把论点区追加进其 arguments 段（不覆盖既有
 * 内容）。导出为纯函数供测试直接钉行为。 */
export function writeTrainingIntoDrafts(
  drafts: RuankaoEssayDraft[],
  targetId: string,
  payload: { title: string; arguments: string; question2: string },
  untitledLabel: string,
): RuankaoEssayDraft[] {
  const target = drafts.find((d) => d.id === targetId)
  if (!target) {
    const base = createDraft(payload.title.trim() || untitledLabel)
    return [
      { ...base, sections: { ...base.sections, arguments: payload.arguments, question2: payload.question2 } },
      ...drafts,
    ]
  }
  return drafts.map((d) =>
    d.id === target.id
      ? {
          ...d,
          sections: {
            ...d.sections,
            arguments: d.sections.arguments.trim()
              ? `${d.sections.arguments}\n\n${payload.arguments}`
              : payload.arguments,
          },
          updatedAt: new Date().toISOString(),
        }
      : d,
  )
}

// 状态色（ADR-011 token，EssayPanel 同款）：ok 灰 / warn 黄
function guardClass(guard: SectionGuard): string {
  if (guard === 'warn') return 'text-warn'
  return 'text-muted-foreground'
}

interface SectionRuntime {
  key: RunSection
  labelKey: string
  target: number
  guard: (n: number) => SectionGuard
}

const RUN_SECTIONS: readonly SectionRuntime[] = [
  {
    key: 'arguments',
    labelKey: 'ruankao.essay.write.sectionArguments',
    target: ARG_SECTION_TARGET,
    guard: guardArguments,
  },
  {
    key: 'question2',
    labelKey: 'ruankao.essay.write.sectionQ2',
    target: Q2_TARGET,
    guard: guardQ2,
  },
]

export function TrainingPanel({
  registerLeaveGuard,
}: {
  /** EssayPanel 的返回按钮守卫注册口：run 阶段返回 home 前 confirm 防误触丢稿 */
  registerLeaveGuard?: (guard: (() => boolean) | null) => void
}) {
  const { t } = useTranslation()

  const [phase, setPhase] = useState<TrainPhase>('setup')

  // setup：题目来源（手输或题库）、提纲粘贴、计时模式与分钟数
  const [topic, setTopic] = useState('')
  const [outline, setOutline] = useState('')
  const [mode, setMode] = useState<TimerMode>('perSection')
  const [argMinutes, setArgMinutes] = useState(DEFAULT_ARG_MINUTES)
  const [q2Minutes, setQ2Minutes] = useState(DEFAULT_Q2_MINUTES)
  const [totalMinutes, setTotalMinutes] = useState(DEFAULT_TOTAL_MINUTES)
  const [questions, setQuestions] = useState<RuankaoQuestion[]>([])
  const [bankPick, setBankPick] = useState('')

  // run：正文两段 + 计时（剩余秒按段/全篇分别记，elapsed 记总用时）
  const [argText, setArgText] = useState('')
  const [q2Text, setQ2Text] = useState('')
  const [activeSection, setActiveSection] = useState<RunSection>('arguments')
  const [remaining, setRemaining] = useState({ arg: 0, q2: 0, total: 0 })
  const [elapsedSec, setElapsedSec] = useState(0)
  const startedAtRef = useRef('')

  // done：交卷结果 + 三条出路
  const [result, setResult] = useState<RuankaoTrainingSession | null>(null)
  const [sending, setSending] = useState(false)
  const [saveTarget, setSaveTarget] = useState(NEW_DRAFT_TARGET)
  const [drafts, setDrafts] = useState<RuankaoEssayDraft[]>([])

  // history：训练记录（常驻折叠区，run 阶段隐藏保持专注）
  const [sessions, setSessions] = useState<RuankaoTrainingSession[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyClearOpen, setHistoryClearOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // SSR/水合安全：localStorage 只在挂载后读（QuestionBankPanel 同款先例）
  useEffect(() => {
    setSessions(loadSessions())
    setDrafts(loadDrafts())
    setQuestions(loadQuestions())
    setHydrated(true)
  }, [])

  // 倒计时：每秒递减当前计时目标（按段=当前段，全篇=总时长），到 0 停表不自动
  // 交卷（「交卷」按钮常在，考生可提前交，达标与否如实记录）
  useEffect(() => {
    if (phase !== 'run') return
    const tick = setInterval(() => {
      setRemaining((prev) => {
        if (mode === 'fullSimulation') {
          return { ...prev, total: Math.max(0, prev.total - 1) }
        }
        if (activeSection === 'arguments') {
          return { ...prev, arg: Math.max(0, prev.arg - 1) }
        }
        return { ...prev, q2: Math.max(0, prev.q2 - 1) }
      })
      setElapsedSec((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(tick)
  }, [phase, mode, activeSection])

  // 离开守卫：run 阶段经 EssayPanel 返回按钮离开前 confirm（丢弃正文提示）
  useEffect(() => {
    if (!registerLeaveGuard) return
    registerLeaveGuard(() => {
      if (phase !== 'run') return true
      return window.confirm(t('ruankao.training.leaveConfirm'))
    })
    return () => registerLeaveGuard(null)
  }, [phase, registerLeaveGuard, t])

  const canStart = topic.trim() !== '' && outline.trim() !== ''

  const startTraining = () => {
    if (!canStart) return
    startedAtRef.current = new Date().toISOString()
    setRemaining({
      arg: Math.max(1, argMinutes) * 60,
      q2: Math.max(1, q2Minutes) * 60,
      total: Math.max(1, totalMinutes) * 60,
    })
    setElapsedSec(0)
    setActiveSection('arguments')
    setPhase('run')
  }

  const submitRun = () => {
    const argChars = countChars(argText)
    const q2Chars = countChars(q2Text)
    const session: RuankaoTrainingSession = {
      id: newSessionId(),
      topic: topic.trim(),
      outline,
      startedAt: startedAtRef.current || new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSec: elapsedSec,
      argChars,
      q2Chars,
      targetMet: isTargetMet(argChars, q2Chars),
    }
    setSessions(appendSession(session))
    setResult(session)
    setPhase('done')
  }

  // 交卷后才解锁批改：文本=论点区（复用批次4 桥，预填不代发）
  const handleCopyToCoach = async () => {
    setSending(true)
    try {
      const outcome = await writeCoachHandoff({ text: argText.trim(), projectEnvId: null })
      if (outcome.ok) toast.success(t('ruankao.essay.write.handoffReady'))
      else toast.info(t('ruankao.essay.write.handoffNoNotebook'))
    } finally {
      setSending(false)
    }
  }

  const handleSaveToDraft = () => {
    if (!result) return
    const next = writeTrainingIntoDrafts(
      loadDrafts(),
      saveTarget,
      { title: result.topic, arguments: argText, question2: q2Text },
      t('ruankao.essay.write.untitled'),
    )
    saveDrafts(next)
    setDrafts(next)
    toast.success(t('ruankao.training.saveToDraftDone'))
  }

  // 换角度重练：同题目回 setup，提纲与正文清空（设计稿 5.2）
  const handleRetrain = () => {
    setOutline('')
    setArgText('')
    setQ2Text('')
    setResult(null)
    setSaveTarget(NEW_DRAFT_TARGET)
    setBankPick('')
    setPhase('setup')
  }

  const handleClearHistory = () => {
    clearSessions()
    setSessions([])
    setHistoryClearOpen(false)
  }

  // run 阶段渲染的编辑段：按段计时只呈现当前段（切换由考生手动「下一段」，
  // 单向不可回退，保持计时纪律）；全篇模拟两段同屏
  const visibleRunSections = useMemo(() => {
    if (mode === 'fullSimulation') return RUN_SECTIONS
    return RUN_SECTIONS.filter((s) => s.key === activeSection)
  }, [mode, activeSection])

  const countdownSec =
    mode === 'fullSimulation' ? remaining.total : remaining[activeSection === 'arguments' ? 'arg' : 'q2']

  if (!hydrated) {
    return (
      <div
        className="flex items-center justify-center py-16"
        data-testid="ruankao-train-root"
      >
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="ruankao-train-root">
      {phase === 'setup' && (
        <div className="space-y-6" data-testid="ruankao-train-setup-root">
          <div>
            <h2 className="font-display text-xl font-semibold">
              {t('ruankao.training.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('ruankao.training.desc')}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('ruankao.training.setupTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 题目来源：手输技术主题，或从题库选择（批次3 localStorage 同源直读） */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ruankao-train-topic">
                    {t('ruankao.training.topicLabel')}
                  </Label>
                  <Input
                    id="ruankao-train-topic"
                    value={topic}
                    placeholder={t('ruankao.training.topicPlaceholder')}
                    onChange={(event) => {
                      setTopic(event.target.value)
                      setBankPick('')
                    }}
                    data-testid="ruankao-train-topic"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ruankao-train-bank">
                    {t('ruankao.training.pickFromBank')}
                  </Label>
                  <Select
                    value={bankPick}
                    onValueChange={(id) => {
                      setBankPick(id)
                      const picked = questions.find((q) => q.id === id)
                      if (picked) setTopic(picked.title)
                    }}
                  >
                    <SelectTrigger
                      id="ruankao-train-bank"
                      className="w-full"
                      data-testid="ruankao-train-bank"
                    >
                      <SelectValue placeholder={t('ruankao.training.pickFromBank')} />
                    </SelectTrigger>
                    <SelectContent>
                      {questions.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 提纲粘贴：拆题/矩阵/选点/提纲全在教练对话完成，本训练器不重复造 */}
              <div className="grid gap-2">
                <Label htmlFor="ruankao-train-outline">
                  {t('ruankao.training.outlineLabel')}
                </Label>
                <Textarea
                  id="ruankao-train-outline"
                  value={outline}
                  placeholder={t('ruankao.training.outlinePlaceholder')}
                  onChange={(event) => setOutline(event.target.value)}
                  className="min-h-28"
                  data-testid="ruankao-train-outline"
                />
              </div>

              {/* 计时模式：按段（论点段/问题2 分钟数可改）或全篇模拟（总时长可改） */}
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  size="sm"
                  variant={mode === 'perSection' ? 'default' : 'outline'}
                  onClick={() => setMode('perSection')}
                  data-testid="ruankao-train-mode-perSection"
                >
                  {t('ruankao.training.modePerSection')}
                </Button>
                <Button
                  size="sm"
                  variant={mode === 'fullSimulation' ? 'default' : 'outline'}
                  onClick={() => setMode('fullSimulation')}
                  data-testid="ruankao-train-mode-fullSimulation"
                >
                  {t('ruankao.training.modeFullSimulation')}
                </Button>
                {mode === 'perSection' ? (
                  <>
                    <div className="grid gap-1">
                      <Label
                        htmlFor="ruankao-train-minutes-arg"
                        className="text-xs text-muted-foreground"
                      >
                        {t('ruankao.training.minutesArgSection')}
                      </Label>
                      <Input
                        id="ruankao-train-minutes-arg"
                        type="number"
                        min={1}
                        className="w-24"
                        value={argMinutes}
                        onChange={(event) =>
                          setArgMinutes(readMinutes(event.target.value, DEFAULT_ARG_MINUTES))
                        }
                        data-testid="ruankao-train-minutes-arg"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label
                        htmlFor="ruankao-train-minutes-q2"
                        className="text-xs text-muted-foreground"
                      >
                        {t('ruankao.training.minutesQ2')}
                      </Label>
                      <Input
                        id="ruankao-train-minutes-q2"
                        type="number"
                        min={1}
                        className="w-24"
                        value={q2Minutes}
                        onChange={(event) =>
                          setQ2Minutes(readMinutes(event.target.value, DEFAULT_Q2_MINUTES))
                        }
                        data-testid="ruankao-train-minutes-q2"
                      />
                    </div>
                  </>
                ) : (
                  <div className="grid gap-1">
                    <Label
                      htmlFor="ruankao-train-minutes-total"
                      className="text-xs text-muted-foreground"
                    >
                      {t('ruankao.training.minutesTotal')}
                    </Label>
                    <Input
                      id="ruankao-train-minutes-total"
                      type="number"
                      min={1}
                      className="w-24"
                      value={totalMinutes}
                      onChange={(event) =>
                        setTotalMinutes(readMinutes(event.target.value, DEFAULT_TOTAL_MINUTES))
                      }
                      data-testid="ruankao-train-minutes-total"
                    />
                  </div>
                )}
              </div>

              <div>
                <Button
                  disabled={!canStart}
                  onClick={startTraining}
                  data-testid="ruankao-train-start"
                >
                  <Timer className="h-4 w-4" />
                  {t('ruankao.training.start')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <TrainingHistory
            sessions={sessions}
            open={historyOpen}
            onToggle={() => setHistoryOpen((prev) => !prev)}
            onClear={() => setHistoryClearOpen(true)}
            clearOpen={historyClearOpen}
            onClearConfirm={handleClearHistory}
            onClearCancel={() => setHistoryClearOpen(false)}
          />
        </div>
      )}

      {phase === 'run' && (
        <div className="space-y-6" data-testid="ruankao-train-run-root">
          {/* 专注视图：题目 + 倒计时。盲写期间无任何 AI/检索/范文入口 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              className="min-w-0 break-words font-display text-xl font-semibold"
              data-testid="ruankao-train-topic"
            >
              {topic}
            </h2>
            <div data-testid="ruankao-train-timer" className="shrink-0">
              <span className="sr-only">
                {t('ruankao.training.runTimer', {
                  mm: Math.floor(countdownSec / 60),
                  ss: String(countdownSec % 60).padStart(2, '0'),
                })}
              </span>
              <span
                aria-hidden="true"
                className="font-mono text-2xl font-semibold tabular-nums"
                data-testid="ruankao-train-clock"
              >
                {formatClock(countdownSec)}
              </span>
            </div>
          </div>

          {/* 提纲锚点卡：原文呈现，只读 */}
          <Card data-testid="ruankao-train-outline-card">
            <CardHeader>
              <CardTitle className="text-base">
                {t('ruankao.training.outlineLabel')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap break-words text-sm leading-6">
                {outline}
              </div>
            </CardContent>
          </Card>

          {/* 顶部静态卡壳引导（纯静态 i18n，非 AI） */}
          <p
            className="text-sm text-muted-foreground"
            data-testid="ruankao-train-stuck-hint"
          >
            {t('ruankao.training.stuckHint')}
          </p>

          {/* 编辑段：每段标题 + 实时字数 vs 目标（countChars 同 4.3.2 口径） */}
          {visibleRunSections.map((section) => {
            const isArg = section.key === 'arguments'
            const value = isArg ? argText : q2Text
            const chars = countChars(value)
            const guard = section.guard(chars)
            return (
              <Card key={section.key} data-testid={`ruankao-train-section-${section.key}`}>
                <CardHeader>
                  <CardTitle className="text-base">{t(section.labelKey)}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs ${guardClass(guard)}`}>
                      {t('ruankao.training.runCurrent', { count: chars })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('ruankao.training.runTarget', { count: section.target })}
                    </span>
                  </CardDescription>
                  <div
                    role="progressbar"
                    aria-valuenow={chars}
                    aria-valuemin={0}
                    aria-valuemax={section.target}
                    data-testid={`ruankao-train-progress-${section.key}`}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full bg-fern transition-[width]"
                      style={{
                        width: `${Math.min(100, (chars / section.target) * 100)}%`,
                      }}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={value}
                    onChange={(event) =>
                      isArg ? setArgText(event.target.value) : setQ2Text(event.target.value)
                    }
                    className="min-h-48"
                    data-testid={`ruankao-train-input-${section.key}`}
                  />
                </CardContent>
              </Card>
            )
          })}

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            {mode === 'perSection' && activeSection === 'arguments' && (
              <Button
                variant="outline"
                onClick={() => setActiveSection('question2')}
                data-testid="ruankao-train-next-section"
              >
                {t('ruankao.training.nextSection')}
              </Button>
            )}
            {/* 「交卷」常在：考生可提前交，达标与否如实记录 */}
            <Button onClick={submitRun} data-testid="ruankao-train-submit">
              {t('ruankao.training.submit')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-6" data-testid="ruankao-train-done-root">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-xl font-semibold">
              {t('ruankao.training.doneTitle')}
            </h2>
            {result.targetMet ? (
              <Badge className="bg-fern text-white" data-testid="ruankao-train-met-badge">
                {t('ruankao.training.doneMet')}
              </Badge>
            ) : (
              <Badge variant="secondary" data-testid="ruankao-train-unmet-badge">
                {t('ruankao.training.doneUnmet')}
              </Badge>
            )}
          </div>

          {/* 结果统计：用时 + 分段字数（是否达标见上方徽标） */}
          <div className="space-y-2" data-testid="ruankao-train-done-stats">
            <div className="flex items-center gap-2 text-sm">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span
                className="font-mono tabular-nums"
                data-testid="ruankao-train-done-duration"
              >
                {formatClock(result.durationSec)}
              </span>
            </div>
            {RUN_SECTIONS.map((section) => {
              const chars = section.key === 'arguments' ? result.argChars : result.q2Chars
              return (
                <div
                  key={section.key}
                  className="flex flex-wrap items-center gap-2 text-sm"
                  data-testid={`ruankao-train-done-count-${section.key}`}
                >
                  <span>{t(section.labelKey)}</span>
                  <span className={guardClass(section.guard(chars))}>
                    {t('ruankao.training.runCurrent', { count: chars })}
                  </span>
                  <span className="text-muted-foreground">
                    {t('ruankao.training.runTarget', { count: section.target })}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 三条出路：复制发教练批改 / 存为写作台草稿 / 换角度重练 */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={sending}
                onClick={handleCopyToCoach}
                data-testid="ruankao-train-copy-coach"
              >
                {t('ruankao.training.copyToCoach')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={saveTarget} onValueChange={setSaveTarget}>
                <SelectTrigger
                  className="w-64"
                  data-testid="ruankao-train-save-target"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_DRAFT_TARGET}>
                    {t('ruankao.essay.write.newDraft')}
                  </SelectItem>
                  {drafts.map((draft) => (
                    <SelectItem key={draft.id} value={draft.id}>
                      {draft.title || t('ruankao.essay.write.untitled')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleSaveToDraft}
                data-testid="ruankao-train-save-draft"
              >
                {t('ruankao.training.saveToDraft')}
              </Button>
            </div>
            <div>
              <Button
                variant="ghost"
                onClick={handleRetrain}
                data-testid="ruankao-train-retrain"
              >
                {t('ruankao.training.retrain')}
              </Button>
            </div>
          </div>

          <TrainingHistory
            sessions={sessions}
            open={historyOpen}
            onToggle={() => setHistoryOpen((prev) => !prev)}
            onClear={() => setHistoryClearOpen(true)}
            clearOpen={historyClearOpen}
            onClearConfirm={handleClearHistory}
            onClearCancel={() => setHistoryClearOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

// 分钟输入解析：非正整数回退默认（清空/误输不阻塞开始）
function readMinutes(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// 训练记录折叠区：最近 50 轮列表（日期 · 题目 · 用时 · 字数 · 达标徽标）
function TrainingHistory({
  sessions,
  open,
  onToggle,
  onClear,
  clearOpen,
  onClearConfirm,
  onClearCancel,
}: {
  sessions: RuankaoTrainingSession[]
  open: boolean
  onToggle: () => void
  onClear: () => void
  clearOpen: boolean
  onClearConfirm: () => void
  onClearCancel: () => void
}) {
  const { t } = useTranslation()

  return (
    <section className="space-y-3" data-testid="ruankao-train-history">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        data-testid="ruankao-train-history-toggle"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <History className="h-4 w-4" />
        {t('ruankao.training.historyTitle')}
      </button>

      {open &&
        (sessions.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="ruankao-train-history-empty"
          >
            {t('ruankao.training.historyEmpty')}
          </p>
        ) : (
          <div className="space-y-2">
            <ul
              className="divide-y divide-border rounded-md border"
              data-testid="ruankao-train-history-list"
            >
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                  data-testid={`ruankao-train-history-item-${s.id}`}
                >
                  <span className="min-w-0 flex-1 break-words text-muted-foreground">
                    {t('ruankao.training.historyItem', {
                      date: new Date(s.startedAt).toLocaleDateString(),
                      topic: s.topic,
                      // 展示口径取整分钟，不足 1 分钟按 1 分钟计
                      minutes: Math.max(1, Math.round(s.durationSec / 60)),
                      count: s.argChars + s.q2Chars,
                    })}
                  </span>
                  {s.targetMet ? (
                    <Badge variant="secondary" className="shrink-0">
                      {t('ruankao.training.doneMet')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0">
                      {t('ruankao.training.doneUnmet')}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={onClear}
              data-testid="ruankao-train-history-clear"
            >
              {t('ruankao.training.historyClear')}
            </Button>
          </div>
        ))}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={(next) => {
          if (!next) onClearCancel()
        }}
        title={t('ruankao.training.historyClear')}
        description={t('ruankao.training.historyConfirmClear')}
        confirmText={t('ruankao.training.historyClear')}
        confirmVariant="destructive"
        onConfirm={onClearConfirm}
      />
    </section>
  )
}

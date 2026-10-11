'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  BookOpen,
  FileQuestion,
  PenLine,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  EssayCapacityBar,
  SECTION_STATE_ICONS,
  SECTION_STATE_TEXT_KEYS,
} from '@/components/ruankao/EssayCapacityBar'
import { TrainingPanel } from '@/components/ruankao/TrainingPanel'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useGenerateFixedParts, useProjectEnvs } from '@/lib/hooks/use-project-envs'
import { useEssayMarkStatus, useEssayMarksLibrary } from '@/lib/hooks/use-essay-marks'
import { useSource } from '@/lib/hooks/use-sources'
import {
  createDraft,
  loadDrafts,
  saveDrafts,
  type RuankaoEssayDraft,
  type RuankaoEssaySections,
} from '@/lib/ruankao/essay-drafts'
import {
  SECTION_BASELINES,
  countChars,
  essayCompleteness,
  sectionState,
  type SectionState,
} from '@/lib/ruankao/essay-guardrails'
import { writeCoachHandoff } from '@/lib/ruankao/coach-handoff'

// 论文读写 tab 的子视图状态机（本地 useState，不进 URL；?read= 深链仅作挂载初始值，
// 与 page.tsx 的 ?tab= 深链同一精神）。write 由批次4 第二步接线、train 由批次5 接线。
type EssaySubview =
  | { kind: 'home' }
  | { kind: 'read'; sourceId: string }
  | { kind: 'write' }
  | { kind: 'train' }

// 深链 ?read= 的合法 source id 形态：source:<hash>（库面板跳转携带完整形态）或
// 裸 <hash>（按标记端点口径自动补 source: 前缀）。其余形态（含注入符号）一律忽略
// 回落 home。
export function resolveReadSourceId(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return null
  if (!/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/.test(trimmed)) return null
  return trimmed.includes(':') ? trimmed : `source:${trimmed}`
}

export function EssayPanel() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const [subview, setSubview] = useState<EssaySubview>(() => {
    const sourceId = resolveReadSourceId(searchParams?.get('read') ?? null)
    return sourceId ? { kind: 'read', sourceId } : { kind: 'home' }
  })

  // 离开守卫（批次5）：训练器 run 阶段经本组件返回按钮离开前先 confirm
  // 防误触丢稿；其余子视图不注册守卫（null 直接放行）
  const leaveGuardRef = useRef<(() => boolean) | null>(null)
  const registerLeaveGuard = useCallback((guard: (() => boolean) | null) => {
    leaveGuardRef.current = guard
  }, [])
  const handleBackToHome = () => {
    if (leaveGuardRef.current && !leaveGuardRef.current()) return
    setSubview({ kind: 'home' })
  }

  if (subview.kind === 'home') {
    return (
      <EssayHomeView
        onOpenRead={(sourceId) => setSubview({ kind: 'read', sourceId })}
        onOpenWrite={() => setSubview({ kind: 'write' })}
        onOpenTrain={() => setSubview({ kind: 'train' })}
      />
    )
  }

  return (
    <div className="space-y-6" data-testid="ruankao-essay-root">
      {/* 子视图切换条：只在非 home 视图显示，带返回（train 的 run 阶段
          由离开守卫拦确认） */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          data-testid="ruankao-essay-back"
          onClick={handleBackToHome}
        >
          <ArrowLeft className="h-4 w-4" />
          {t('ruankao.essay.read.back')}
        </Button>
        {subview.kind === 'read' && (
          <Button
            size="sm"
            variant="outline"
            data-testid="ruankao-essay-nav-write"
            onClick={() => setSubview({ kind: 'write' })}
          >
            <PenLine className="h-4 w-4" />
            {t('ruankao.essay.write.title')}
          </Button>
        )}
        {subview.kind === 'write' && (
          <Button
            size="sm"
            variant="outline"
            data-testid="ruankao-essay-nav-read"
            onClick={() => setSubview({ kind: 'home' })}
          >
            <BookOpen className="h-4 w-4" />
            {t('ruankao.essay.home.readCard')}
          </Button>
        )}
      </div>
      {subview.kind === 'read' && <EssayReadView sourceId={subview.sourceId} />}
      {subview.kind === 'write' && <EssayWriteView />}
      {subview.kind === 'train' && (
        <TrainingPanel registerLeaveGuard={registerLeaveGuard} />
      )}
    </div>
  )
}

function EssayHomeView({
  onOpenRead,
  onOpenWrite,
  onOpenTrain,
}: {
  onOpenRead: (sourceId: string) => void
  onOpenWrite: () => void
  onOpenTrain: () => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  // '' = 后端默认视图（DEFAULT_AI_CONTENT_VIEW_ID），与范文库标记面板同一数据源
  const libraryQuery = useEssayMarksLibrary('')

  const markedEssays = useMemo(() => {
    const sources = libraryQuery.data?.sources ?? []
    // 服务端已按 updated DESC 返回；只收已标记来源（直标或经文件夹生效），取前 20
    return sources
      .filter((s) => s.marked_direct || s.via_group_ids.length > 0)
      .slice(0, 20)
  }, [libraryQuery.data?.sources])

  return (
    <div className="space-y-6" data-testid="ruankao-essay-home">
      <h2 className="font-display text-xl font-semibold">
        {t('ruankao.essay.home.title')}
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        {/* 范文阅读卡（本步交付形态）：列出已标记范文，行点击进入读视图 */}
        <Card data-testid="ruankao-essay-home-read-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-fern" />
              {t('ruankao.essay.home.readCard')}
            </CardTitle>
            <CardDescription>{t('ruankao.essay.home.readCardDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {libraryQuery.isPending ? (
              <LoadingSpinner />
            ) : markedEssays.length === 0 ? (
              /* 空列表与加载失败同走引导：读卡失败不阻塞 home，范文库标记 tab
                 自带完整错误态与重试 */
              <Button
                variant="outline"
                size="sm"
                data-testid="ruankao-essay-home-open-library"
                onClick={() => router.push('/ruankao?tab=modelLibrary')}
              >
                {t('ruankao.essay.home.openLibrary')}
              </Button>
            ) : (
              <ul
                className="max-h-72 space-y-1 overflow-y-auto"
                data-testid="ruankao-essay-home-read-list"
              >
                {markedEssays.map((source) => (
                  <li key={source.id}>
                    <button
                      type="button"
                      data-testid={`ruankao-essay-home-read-item-${source.id}`}
                      className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                      onClick={() => onOpenRead(source.id)}
                    >
                      {source.title || source.id.split(':').pop() || source.id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 写作台卡（批次4 第二步已交付）：进入五段分桶写作 */}
        <Card data-testid="ruankao-essay-home-write-card">
          <CardContent>
            <Button
              variant="outline"
              data-testid="ruankao-essay-home-write-entry"
              className="flex h-auto w-full flex-col items-start gap-2 py-4"
              onClick={onOpenWrite}
            >
              <PenLine className="h-5 w-5" />
              {t('ruankao.essay.write.title')}
            </Button>
          </CardContent>
        </Card>

        {/* 憋字训练卡（批次5 已交付）：计时盲写训练器入口 */}
        <Card data-testid="ruankao-essay-home-train-card">
          <CardContent>
            <Button
              variant="outline"
              data-testid="ruankao-essay-home-train-entry"
              className="flex h-auto w-full flex-col items-start gap-2 py-4"
              onClick={onOpenTrain}
            >
              <Timer className="h-5 w-5" />
              {t('ruankao.training.title')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// 读视图。唯一网络行为 = 按源 id 读全文（例外通道 GET /api/sources/{id}，红线三条
// 之 3）+ 查标记状态（只回 id 与布尔，无正文）——无任何模型调用、无检索调用，
// 也不提供任何 AI 动作（读模式仅人眼研读）。全文不做 Markdown 渲染（范文多为
// 纯文本，避免渲染器意外），pre-wrap 等宽原样呈现。
function EssayReadView({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation()
  const sourceQuery = useSource(sourceId)
  const statusQuery = useEssayMarkStatus(sourceId)

  if (sourceQuery.isPending) {
    return (
      <div
        className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground"
        data-testid="ruankao-essay-read-loading"
      >
        <LoadingSpinner />
        {t('ruankao.essay.read.loading')}
      </div>
    )
  }

  // 读失败（404 为主）统一按「找不到来源」呈现；父级切换条已带返回按钮
  if (sourceQuery.isError || !sourceQuery.data) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-muted-foreground"
        data-testid="ruankao-essay-read-notfound"
      >
        <FileQuestion className="h-10 w-10" />
        <p className="text-sm">{t('ruankao.essay.read.notFound')}</p>
      </div>
    )
  }

  const source = sourceQuery.data
  const effective = statusQuery.data?.source?.effective ?? false

  return (
    <article className="space-y-4" data-testid="ruankao-essay-read">
      <header className="space-y-2">
        <h2
          className="break-words font-display text-xl font-semibold"
          data-testid="ruankao-essay-read-title"
        >
          {source.title || sourceId.split(':').pop() || sourceId}
        </h2>
        {/* 红线状态徽标（三态）：仅提示，不隐藏正文——读的就是例外通道全文 */}
        {statusQuery.isError ? (
          <div
            className="flex flex-wrap items-center gap-2 text-destructive"
            data-testid="ruankao-essay-read-redline-error"
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="text-sm">{t('ruankao.essay.read.redlineError')}</span>
            <Button
              size="sm"
              variant="outline"
              data-testid="ruankao-essay-read-redline-retry"
              onClick={() => statusQuery.refetch()}
            >
              {t('ruankao.essayMark.retryAction')}
            </Button>
          </div>
        ) : effective ? (
          <div
            className="flex flex-wrap items-center gap-2 text-fern"
            data-testid="ruankao-essay-read-redline-active"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="text-sm">{t('ruankao.essay.read.redlineActive')}</span>
          </div>
        ) : (
          <div
            className="flex flex-wrap items-center gap-2 text-muted-foreground"
            data-testid="ruankao-essay-read-redline-inactive"
          >
            <Shield className="h-4 w-4 shrink-0" />
            <span className="text-sm">{t('ruankao.essay.read.redlineInactive')}</span>
          </div>
        )}
      </header>
      <div
        className="whitespace-pre-wrap break-words font-mono text-sm leading-7"
        data-testid="ruankao-essay-read-text"
      >
        {source.full_text || t('sources.noContent')}
      </div>
    </article>
  )
}

// ── 写作台（批次4 第二步）──────────────────────────────────────────────
// 红线可审计：本视图唯一的 AI 触点是固定件生成端点（上下文=ProjectEnv 素材
// 字段，无任何来源检索）；「发教练批改」是 sessionStorage 种子桥——文本预填进
// 聊天输入框，由考生自己点发送（coach-handoff），写作台本身零提示词零模型调用。

// Radix Select 不接受空串 value，环境「不关联」用哨兵
const NONE_ENV = '__none__'

// 422/502/504 → 对应 i18n 键（502 model_error 与未知错误共用 generateFailed）。
// 导出供写作台测试直接钉分流口径。
export function fixedPartsErrorKey(error: unknown): string {
  const reason = (
    error as { response?: { data?: { detail?: { reason?: string } } } } | null
  )?.response?.data?.detail?.reason
  if (reason === 'no_material') return 'ruankao.essay.write.generateNoMaterial'
  if (reason === 'model_timeout') return 'ruankao.essay.write.generateTimeout'
  return 'ruankao.essay.write.generateFailed'
}

// 段四态色（ADR-011 token）：未达/达标段本色灰、偏多 warn、超限红——
// 只提示不拦截，硬拦会挡住修改中的中间态
function sectionStateClass(state: SectionState): string {
  if (state === 'over') return 'text-destructive'
  if (state === 'near' || state === 'under') return 'text-warn'
  return 'text-muted-foreground'
}

function EssayWriteView() {
  const { t } = useTranslation()
  const { data: envs } = useProjectEnvs('manage')
  const generateFixed = useGenerateFixedParts()

  const [drafts, setDrafts] = useState<RuankaoEssayDraft[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [includeQ2, setIncludeQ2] = useState(false)
  const [sending, setSending] = useState(false)

  // SSR/水合安全：localStorage 只在挂载后读（QuestionBankPanel 同款先例）
  useEffect(() => {
    const loaded = loadDrafts()
    setDrafts(loaded)
    setCurrentId(loaded[0]?.id ?? null)
    setHydrated(true)
  }, [])

  const current = useMemo(
    () => drafts.find((d) => d.id === currentId) ?? null,
    [drafts, currentId]
  )

  // debounce 800ms 自动保存：任何编辑重置计时；保存成功不 toast（4.3.1）
  useEffect(() => {
    if (!hydrated || !current) return
    const timer = setTimeout(() => saveDrafts(drafts), 800)
    return () => clearTimeout(timer)
  }, [drafts, hydrated, current])

  const touch = (patch: (draft: RuankaoEssayDraft) => RuankaoEssayDraft) => {
    setDrafts((prev) => prev.map((d) => (d.id === currentId ? patch(d) : d)))
  }
  const setSection = (key: keyof RuankaoEssaySections, value: string) => {
    touch((d) => ({
      ...d,
      sections: { ...d.sections, [key]: value },
      updatedAt: new Date().toISOString(),
    }))
  }
  // 失焦即存（debounce 之外的兜底）
  const persistNow = () => {
    if (hydrated) saveDrafts(drafts)
  }

  const handleNewDraft = () => {
    persistNow()
    const draft = createDraft(t('ruankao.essay.write.untitled'))
    setDrafts((prev) => [draft, ...prev])
    setCurrentId(draft.id)
  }

  const handleRenameConfirm = () => {
    touch((d) => ({
      ...d,
      title: renameValue.trim() || d.title,
      updatedAt: new Date().toISOString(),
    }))
    setRenameOpen(false)
  }

  const handleDelete = () => {
    const remaining = drafts.filter((d) => d.id !== currentId)
    setDrafts(remaining)
    setCurrentId(remaining[0]?.id ?? null)
    saveDrafts(remaining)
    setDeleteOpen(false)
  }

  const handleEnvChange = (value: string) => {
    touch((d) => ({
      ...d,
      projectEnvId: value === NONE_ENV ? null : value,
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleGenerate = () => {
    if (!current?.projectEnvId) return
    const s = current.sections
    const hasExisting =
      s.abstract.trim() !== '' || s.background.trim() !== '' || s.closing.trim() !== ''
    if (hasExisting && !window.confirm(t('ruankao.essay.write.generateOverwrite'))) {
      return
    }
    const envIdForCall = current.projectEnvId
    generateFixed.mutate(envIdForCall, {
      onSuccess: (parts) => {
        // 三段填空版落入对应桶；生成后考生可自由编辑（消化）
        touch((d) => ({
          ...d,
          sections: {
            ...d.sections,
            abstract: parts.abstract,
            background: parts.background,
            closing: parts.closing,
          },
          updatedAt: new Date().toISOString(),
        }))
      },
      onError: (error: unknown) => {
        toast.error(t(fixedPartsErrorKey(error)))
      },
    })
  }

  const handleSendToCoach = async () => {
    if (!current) return
    const chunks: string[] = []
    if (includeQ2 && current.sections.question2.trim()) {
      chunks.push(`【问题2】\n${current.sections.question2.trim()}`)
    }
    chunks.push(current.sections.arguments.trim())
    setSending(true)
    try {
      const result = await writeCoachHandoff({
        text: chunks.join('\n\n'),
        projectEnvId: current.projectEnvId,
      })
      if (result.ok) toast.success(t('ruankao.essay.write.handoffReady'))
      else toast.info(t('ruankao.essay.write.handoffNoNotebook'))
    } finally {
      setSending(false)
    }
  }

  if (!hydrated) {
    return (
      <div
        className="flex items-center justify-center py-16"
        data-testid="ruankao-write-root"
      >
        <LoadingSpinner />
      </div>
    )
  }

  if (!current) {
    return (
      <div className="space-y-4" data-testid="ruankao-write-root">
        <p className="text-sm text-muted-foreground">
          {t('ruankao.essay.write.desc')}
        </p>
        <Button
          data-testid="ruankao-write-new-draft"
          variant="outline"
          onClick={handleNewDraft}
        >
          <Plus className="h-4 w-4" />
          {t('ruankao.essay.write.newDraft')}
        </Button>
      </div>
    )
  }

  const sections = current.sections
  // 交卷完整度（只提示不阻断发送）：全空诚实显示 0/5
  const completeness = essayCompleteness(sections)
  const fiveTotal = SECTION_BASELINES.reduce(
    (sum, b) => sum + countChars(sections[b.key]),
    0
  )

  return (
    <div className="space-y-6" data-testid="ruankao-write-root">
      {/* 草稿选择条：多稿本地持久（上限 20，超出丢最旧） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t('ruankao.essay.write.draftLabel')}
        </span>
        <Select
          value={current.id}
          onValueChange={(id) => {
            persistNow()
            setCurrentId(id)
          }}
        >
          <SelectTrigger className="w-64" data-testid="ruankao-write-draft-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {drafts.map((draft) => (
              <SelectItem key={draft.id} value={draft.id}>
                {draft.title || t('ruankao.essay.write.untitled')} ·{' '}
                {new Date(draft.updatedAt).toLocaleDateString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          data-testid="ruankao-write-new-draft"
          onClick={handleNewDraft}
        >
          <Plus className="h-4 w-4" />
          {t('ruankao.essay.write.newDraft')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="ruankao-write-rename-draft"
          onClick={() => {
            setRenameValue(current.title)
            setRenameOpen(true)
          }}
        >
          {t('ruankao.essay.write.renameDraft')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          data-testid="ruankao-write-delete-draft"
          onClick={() => setDeleteOpen(true)}
        >
          {t('ruankao.essay.write.deleteDraft')}
        </Button>
      </div>

      {/* 论文容量条：五段占比 + 图例 + 正文合计总量区（只提示不拦截） */}
      <EssayCapacityBar sections={sections} />

      {/* 关联行：项目环境（固定件生成源）+ 生成按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t('ruankao.essay.write.envLabel')}
        </span>
        <Select value={current.projectEnvId ?? NONE_ENV} onValueChange={handleEnvChange}>
          <SelectTrigger className="w-64" data-testid="ruankao-write-env-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_ENV}>
              {t('ruankao.essay.write.envNone')}
            </SelectItem>
            {(envs ?? []).map((env) => (
              <SelectItem key={env.id} value={env.id}>
                {env.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          data-testid="ruankao-write-generate-fixed"
          disabled={generateFixed.isPending || !current.projectEnvId}
          onClick={handleGenerate}
        >
          {generateFixed.isPending ? (
            <>
              <LoadingSpinner />
              {t('ruankao.essay.write.generateRunning')}
            </>
          ) : (
            t('ruankao.essay.write.generateFixed')
          )}
        </Button>
      </div>

      {/* 五段编辑区：每段 Card = 纯段名 + 目标区间徽标 + 四态字数 + 占全文比 */}
      <div className="space-y-4">
        {SECTION_BASELINES.map((b) => {
          const chars = countChars(sections[b.key])
          const state = sectionState(b.key, chars)
          return (
            <Card key={b.key} data-testid={`ruankao-write-section-${b.key}`}>
              <CardHeader>
                {/* title 沿用旧版长口径标签（含下限/上限说明），正文只显示纯段名 */}
                <CardTitle className="text-base" title={t(b.labelKey)}>
                  {t(b.nameKey)}
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="font-mono text-xs font-normal tabular-nums"
                  >
                    {t('ruankao.essay.write.targetRange', {
                      min: b.floor,
                      max: b.target,
                    })}
                  </Badge>
                  <Badge
                    variant="outline"
                    data-testid={`ruankao-write-count-${b.key}`}
                    className={`font-mono text-xs tabular-nums ${sectionStateClass(state)}`}
                  >
                    {t('ruankao.essay.write.countLabel', { count: chars })}
                  </Badge>
                  {state === 'under' && (
                    <span className="text-xs text-warn">
                      {t('ruankao.essay.write.underFloor')}
                    </span>
                  )}
                  {state === 'near' && (
                    <span className="text-xs text-warn">
                      {t('ruankao.essay.write.legendNear')}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t('ruankao.essay.write.percentOfTotal', {
                      percent: fiveTotal > 0 ? Math.round((chars / fiveTotal) * 100) : 0,
                    })}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={sections[b.key]}
                  onChange={(event) => setSection(b.key, event.target.value)}
                  onBlur={persistNow}
                  className="min-h-36"
                  data-testid={`ruankao-write-input-${b.key}`}
                />
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 底部动作条：发教练批改（预填不代发）+ 本地自动保存灰字 */}
      <div className="flex flex-wrap items-center gap-4 border-t pt-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="ruankao-write-include-q2"
            checked={includeQ2}
            onCheckedChange={(checked) => setIncludeQ2(checked === true)}
            data-testid="ruankao-write-include-q2"
          />
          <Label
            htmlFor="ruankao-write-include-q2"
            className="cursor-pointer text-sm text-muted-foreground"
          >
            {t('ruankao.essay.write.sendToCoachIncludeQ2')}
          </Label>
        </div>
        {/* 交卷完整度小结：达标段数 + 未达标段 chips（只提示，不阻断发送） */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid="ruankao-write-completeness"
        >
          <span className="text-xs text-muted-foreground">
            {t('ruankao.essay.write.completeness', {
              met: completeness.met,
              total: completeness.total,
            })}
          </span>
          {completeness.issues.map(({ key, state }) => {
            const baseline = SECTION_BASELINES.find((b) => b.key === key)
            if (!baseline) return null
            const StateIcon = SECTION_STATE_ICONS[state]
            return (
              <Badge
                key={key}
                variant="outline"
                data-testid={`ruankao-write-completeness-chip-${key}`}
                className={`gap-1 text-xs ${sectionStateClass(state)}`}
              >
                <StateIcon className="h-3 w-3" aria-hidden />
                {t(baseline.nameKey)}
                {' · '}
                {t(SECTION_STATE_TEXT_KEYS[state], {
                  count: Math.max(0, countChars(sections[key]) - baseline.hard),
                })}
              </Badge>
            )
          })}
        </div>
        <Button
          size="sm"
          data-testid="ruankao-write-send-coach"
          disabled={sending || sections.arguments.trim() === ''}
          onClick={handleSendToCoach}
        >
          {t('ruankao.essay.write.sendToCoach')}
        </Button>
        <span
          className="ml-auto text-xs text-muted-foreground"
          data-testid="ruankao-write-saved-local"
        >
          {t('ruankao.essay.write.savedLocal')}
        </span>
      </div>

      {/* 重命名 Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ruankao.essay.write.renameDraft')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            data-testid="ruankao-write-rename-input"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button data-testid="ruankao-write-rename-confirm" onClick={handleRenameConfirm}>
              {t('ruankao.essay.write.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('ruankao.essay.write.deleteDraft')}
        description={t('ruankao.essay.write.confirmDeleteDraft')}
        confirmText={t('ruankao.essay.write.deleteDraft')}
        confirmVariant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { WizardContainer, type WizardStep } from '@/components/ui/wizard-container'
import { cn } from '@/lib/utils'
import { Building2, Bot, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useCreateProjectEnv,
  useMockGenerateProjectEnv,
  usePolishBackground,
  useProjectEnv,
} from '@/lib/hooks/use-project-envs'
import { MaterialSelectionStep, type MaterialTab } from './MaterialSelectionStep'
import { TimeRangeField } from './TimeRangeField'
import { VerificationPanel } from './VerificationPanel'
import { IndustryCombobox } from '@/components/ruankao/IndustryCombobox'
import { validatePeriod, parseMonthsFromText, type ProjectEnvMode } from '@/lib/utils/project-env-time'

type PolishState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'preview'; polished: string }
  | { phase: 'error' }

interface CreateEnvWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Reopen an existing env straight at the verification step (list row click
  // on a pending / needs_review environment).
  initialEnvId?: string | null
  // 一次性种子（wizardSeed 通道）：打开时以 mock 模式落到第 2 步并带行业值，
  // 优先级 preset > localStorage > 默认；父层在关闭时清空
  preset?: { industry: string } | null
}

const KEYWORD_MIN = 2
const KEYWORD_MAX = 8

function KeywordInput({
  keywords,
  onChange,
  disabled,
}: {
  keywords: string[]
  onChange: (keywords: string[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const addDraft = () => {
    const parts = draft
      .split(/[,，、;；\s]+/)
      .map((part) => part.trim())
      .filter(Boolean)
    const next = [...keywords]
    for (const part of parts) {
      if (next.length >= KEYWORD_MAX) break
      if (!next.includes(part)) next.push(part)
    }
    if (next.length > keywords.length) onChange(next)
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 text-sm">
        {keywords.map((keyword) => (
          <Badge key={keyword} variant="secondary" className="gap-1 font-normal">
            {keyword}
            <button
              type="button"
              aria-label={`${t('common.remove')} ${keyword}`}
              disabled={disabled}
              onClick={() => onChange(keywords.filter((item) => item !== keyword))}
              className="rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          className="min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          value={draft}
          disabled={disabled}
          placeholder={
            keywords.length ? '' : t('projectEnvs.mockKeywordsPlaceholder')
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              addDraft()
            } else if (
              event.key === 'Backspace' &&
              !draft &&
              keywords.length &&
              !disabled
            ) {
              onChange(keywords.slice(0, -1))
            }
          }}
          onBlur={addDraft}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('projectEnvs.mockKeywordsHint')}</p>
    </div>
  )
}

export function CreateEnvWizard({ open, onOpenChange, initialEnvId, preset }: CreateEnvWizardProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState<ProjectEnvMode | null>(null)

  // Real-project form
  const [name, setName] = useState('')
  const [period, setPeriod] = useState({ start: '', end: '' })
  const [background, setBackground] = useState('')
  const [techBackground, setTechBackground] = useState('')
  const [tuning, setTuning] = useState('')
  const [problems, setProblems] = useState('')
  const [myRole, setMyRole] = useState('')
  // scale 输入已移除（人员/规模/资金三层禁令）：关闭用户手填规模的入口
  const [polish, setPolish] = useState<PolishState>({ phase: 'idle' })
  const [polishAdopted, setPolishAdopted] = useState(false)
  // Token fence: a canceled polish may still resolve later; the stale
  // response must not overwrite the returned-to-idle UI.
  const polishTokenRef = useRef(0)

  // Mock form
  const [mockName, setMockName] = useState('')
  const [industry, setIndustry] = useState(
    () =>
      (typeof window !== 'undefined' && localStorage.getItem('project-env-industry')) ||
      '物流行业'
  )
  const [keywords, setKeywords] = useState<string[]>([])
  const [mockPeriod, setMockPeriod] = useState({ start: '', end: '' })
  const [mockPeriodTouched, setMockPeriodTouched] = useState(false)

  const [envId, setEnvId] = useState<string | null>(null)

  // Materials step (mock only): selection state lives here so switching
  // wizard steps or tabs never drops what the user already picked.
  const [materialTab, setMaterialTab] = useState<MaterialTab>('materials')
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set())
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [reopenPending, setReopenPending] = useState(false)

  const createMutation = useCreateProjectEnv()
  const mockMutation = useMockGenerateProjectEnv()
  const mockMaterialsMutation = useMockGenerateProjectEnv()
  const polishMutation = usePolishBackground()

  // mock-generate always creates a NEW env row, so a second submit from
  // step 2 while the current row is still mid-flight would silently fork
  // the work — block it instead.
  const { data: currentEnv } = useProjectEnv(envId)
  const envInFlight =
    !!envId &&
    !!currentEnv &&
    !['verified', 'needs_review', 'failed'].includes(String(currentEnv.status))

  // Reopen routing needs the row (source_type + status) before the target
  // step is known; keep the indicator steady with a loading body meanwhile.
  const { data: reopenedEnv, isError: reopenError } = useProjectEnv(
    open && initialEnvId ? initialEnvId : null
  )

  const lastStep = mode === 'mock' ? 4 : 3
  const steps: WizardStep[] = [
    { number: 1, title: t('projectEnvs.stepMode'), description: '' },
    { number: 2, title: t('projectEnvs.stepDetails'), description: '' },
    ...(mode === 'mock'
      ? [{ number: 3, title: t('projectEnvs.stepMaterials'), description: '' }]
      : []),
    { number: lastStep, title: t('projectEnvs.stepVerify'), description: '' },
  ]

  useEffect(() => {
    if (!open) {
      // Dialog state is parent-cleared by design; reset everything on close.
      setStep(1)
      setMode(null)
      setName('')
      setPeriod({ start: '', end: '' })
      setBackground('')
      setTechBackground('')
      setTuning('')
      setProblems('')
      setMyRole('')
      setPolish({ phase: 'idle' })
      setPolishAdopted(false)
      setMockName('')
      setKeywords([])
      setMockPeriod({ start: '', end: '' })
      setMockPeriodTouched(false)
      setEnvId(null)
      setMaterialTab('materials')
      setSelectedMaterialIds(new Set())
      setSelectedRouteId(null)
      setReopenPending(false)
    } else if (initialEnvId) {
      setEnvId(initialEnvId)
      setReopenPending(true)
    } else if (preset) {
      // 行业池点条目：直接进入 mock 第 2 步并带行业值（一次性种子）
      setMode('mock')
      setStep(2)
      setIndustry(preset.industry)
    }
  }, [open, initialEnvId, preset])

  useEffect(() => {
    if (!open || !initialEnvId || !reopenPending) return
    if (reopenedEnv) {
      setMode(reopenedEnv.source_type)
      // Mock envs land on the materials step whenever the candidate store
      // matters: mid-generation, awaiting a pick, or failed (failed lets the
      // user re-pick from the stored batch or retry/skip from the banner).
      setStep(
        reopenedEnv.source_type === 'mock' &&
          ['material_pending', 'material_ready', 'failed'].includes(
            String(reopenedEnv.status)
          )
          ? 3
          : reopenedEnv.source_type === 'mock'
            ? 4
            : 3
      )
      setReopenPending(false)
    } else if (reopenError) {
      // Row vanished (deleted elsewhere): land on verify like before; the
      // panel surfaces the missing env.
      setStep(3)
      setReopenPending(false)
    }
  }, [open, initialEnvId, reopenPending, reopenedEnv, reopenError])

  // Real form: R1 blocks, R2/R3 only warn (decision ②).
  const realViolations = validatePeriod(period.start, period.end, 'real')
  const realBlocked =
    realViolations.some((v) => v.severity === 'block') ||
    !name.trim() ||
    !background.trim() ||
    !techBackground.trim() ||
    !period.start ||
    !period.end ||
    polish.phase === 'loading' ||
    createMutation.isPending

  // Mock form: every violation blocks (decision ②).
  const mockViolations = validatePeriod(mockPeriod.start, mockPeriod.end, 'mock')
  const mockKeywordsInvalid =
    keywords.length < KEYWORD_MIN || keywords.length > KEYWORD_MAX
  const mockBlocked =
    mockKeywordsInvalid ||
    (!!mockPeriod.start !== !!mockPeriod.end) ||
    mockViolations.some((v) => v.severity === 'block') ||
    mockMutation.isPending ||
    mockMaterialsMutation.isPending ||
    envInFlight

  const handlePolish = () => {
    if (!background.trim()) return
    const token = ++polishTokenRef.current
    setPolish({ phase: 'loading' })
    polishMutation.mutate(
      {
        background: background.trim(),
        name: name.trim() || undefined,
        tech_background: techBackground.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          if (polishTokenRef.current === token) {
            setPolish({ phase: 'preview', polished: result.polished })
          }
        },
        onError: () => {
          if (polishTokenRef.current === token) setPolish({ phase: 'error' })
        },
      }
    )
  }

  const cancelPolish = () => {
    polishTokenRef.current++
    polishMutation.reset()
    setPolish({ phase: 'idle' })
  }

  const adoptPolish = () => {
    if (polish.phase !== 'preview') return
    setBackground(polish.polished)
    setPolishAdopted(true)
    setPolish({ phase: 'idle' })
  }

  const submitReal = () => {
    createMutation.mutate(
      {
        name: name.trim(),
        background: background.trim(),
        period_start: period.start,
        period_end: period.end,
        source_type: 'real',
        tech_background: techBackground.trim(),
        tuning_process: tuning.trim() || null,
        problems_solutions: problems.trim() || null,
        my_role: myRole.trim() || null,
        background_ai_polished: polishAdopted,
      },
      {
        onSuccess: (env) => {
          setEnvId(env.id)
          setStep(3)
        },
      }
    )
  }

  // 行业偏好随提交持久化（不在每次击键时写），下次打开向导时回填
  const persistIndustry = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('project-env-industry', industry.trim())
    }
  }

  // flow='materials' stops at the candidate step for the user to pick;
  // flow='direct' (skip) runs the legacy draft+verify pipeline right away.
  const submitMockMaterials = () => {
    persistIndustry()
    mockMaterialsMutation.mutate(
      {
        name: mockName.trim() || undefined,
        keywords,
        industry: industry.trim() || undefined,
        period_start: mockPeriod.start || undefined,
        period_end: mockPeriod.end || undefined,
        flow: 'materials',
      },
      {
        onSuccess: (result) => {
          setEnvId(result.id)
          setStep(3)
        },
      }
    )
  }

  const submitMock = () => {
    persistIndustry()
    mockMutation.mutate(
      {
        name: mockName.trim() || undefined,
        keywords,
        industry: industry.trim() || undefined,
        period_start: mockPeriod.start || undefined,
        period_end: mockPeriod.end || undefined,
        flow: 'direct',
      },
      {
        onSuccess: (result) => {
          setEnvId(result.id)
          setStep(lastStep)
        },
      }
    )
  }

  // Keyword text may carry explicit YYYY.MM hints; prefill the pickers until
  // the user touches them (after that the pickers win, per decision ③).
  const handleKeywordsChange = (next: string[]) => {
    setKeywords(next)
    if (mockPeriodTouched) return
    const months = parseMonthsFromText(next.join(' '))
    if (months.length >= 2 && months[0] !== months[1]) {
      const [start, end] = [...months].sort()
      setMockPeriod({ start, end })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {t('projectEnvs.wizardTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[calc(90vh-7rem)] overflow-y-auto p-4">
          <WizardContainer currentStep={step} steps={steps} onStepClick={setStep}>
            {open && initialEnvId && reopenPending ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.loading')}
              </div>
            ) : (
              <>
            {step === 1 && (
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  {t('projectEnvs.sharedNote')}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('real')
                      setStep(2)
                    }}
                    className={cn(
                      'rounded-lg border p-4 text-left transition-colors hover:border-fern/60',
                      mode === 'real' && 'border-fern bg-fern-tint/40'
                    )}
                    data-testid="env-mode-real"
                  >
                    <div className="mb-1 flex items-center gap-2 font-medium">
                      <Building2 className="h-4 w-4 text-fern" />
                      {t('projectEnvs.realModeTitle')}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('projectEnvs.realModeDesc')}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('mock')
                      setStep(2)
                    }}
                    className={cn(
                      'rounded-lg border p-4 text-left transition-colors hover:border-teal/60',
                      mode === 'mock' && 'border-teal bg-teal-tint/40'
                    )}
                    data-testid="env-mode-mock"
                  >
                    <div className="mb-1 flex items-center gap-2 font-medium">
                      <Bot className="h-4 w-4 text-teal" />
                      {t('projectEnvs.mockModeTitle')}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('projectEnvs.mockModeDesc')}
                    </p>
                  </button>
                </div>
              </div>
            )}

            {step === 2 && mode === 'real' && (
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="env-name">{t('projectEnvs.nameLabel')} *</Label>
                  <Input
                    id="env-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('projectEnvs.namePlaceholder')}
                    maxLength={100}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('projectEnvs.periodStart')} / {t('projectEnvs.periodEnd')} *</Label>
                  <TimeRangeField
                    value={period}
                    onChange={setPeriod}
                    mode="real"
                    idPrefix="env-period"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="env-background">
                      {t('projectEnvs.backgroundLabel')} *
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-teal"
                      disabled={!background.trim() || polish.phase === 'loading'}
                      onClick={handlePolish}
                    >
                      {polish.phase === 'loading' ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t('projectEnvs.polishing')}
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          {t('projectEnvs.polish')}
                        </>
                      )}
                    </Button>
                  </div>
                  <Textarea
                    id="env-background"
                    value={background}
                    onChange={(event) => {
                      setBackground(event.target.value)
                      setPolishAdopted(false)
                    }}
                    placeholder={t('projectEnvs.backgroundPlaceholder')}
                    rows={4}
                  />
                  {polish.phase === 'loading' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground"
                      onClick={cancelPolish}
                    >
                      {t('projectEnvs.polishCancel')}
                    </Button>
                  )}
                  {polish.phase === 'preview' && (
                    <div className="space-y-2 rounded-md border p-2" data-testid="polish-preview">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {t('projectEnvs.polishOriginal')}
                          </p>
                          <p className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                            {background}
                          </p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-teal">
                            {t('projectEnvs.polishPolished')}
                          </p>
                          <p className="whitespace-pre-wrap break-all rounded bg-teal-tint/50 p-2 text-xs">
                            {polish.polished}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={adoptPolish}>
                          {t('projectEnvs.polishAdopt')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPolish({ phase: 'idle' })}
                        >
                          {t('projectEnvs.polishUndo')}
                        </Button>
                      </div>
                    </div>
                  )}
                  {polish.phase === 'error' && (
                    <div className="flex items-center gap-2 text-xs text-warn">
                      <span>{t('projectEnvs.polishFailed')}</span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handlePolish}>
                        {t('projectEnvs.polishRetry')}
                      </Button>
                    </div>
                  )}
                  {polishAdopted && (
                    <Badge variant="outline" className="border-teal/50 text-teal">
                      <Sparkles className="h-3 w-3" />
                      {t('projectEnvs.aiPolished')}
                    </Badge>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="env-tech">
                    {t('projectEnvs.techBackgroundLabel')} *
                  </Label>
                  <Textarea
                    id="env-tech"
                    value={techBackground}
                    onChange={(event) => setTechBackground(event.target.value)}
                    placeholder={t('projectEnvs.techBackgroundPlaceholder')}
                    rows={3}
                  />
                </div>

                <details className="space-y-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {t('common.optional')}
                  </summary>
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="env-tuning">{t('projectEnvs.tuningLabel')}</Label>
                      <Textarea
                        id="env-tuning"
                        value={tuning}
                        onChange={(event) => setTuning(event.target.value)}
                        placeholder={t('projectEnvs.tuningPlaceholder')}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="env-problems">{t('projectEnvs.problemsLabel')}</Label>
                      <Textarea
                        id="env-problems"
                        value={problems}
                        onChange={(event) => setProblems(event.target.value)}
                        placeholder={t('projectEnvs.problemsPlaceholder')}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="env-role">{t('projectEnvs.myRoleLabel')}</Label>
                      <Textarea
                        id="env-role"
                        value={myRole}
                        onChange={(event) => setMyRole(event.target.value)}
                        placeholder={t('projectEnvs.myRolePlaceholder')}
                        rows={2}
                      />
                    </div>
                  </div>
                </details>

                <div className="flex justify-end gap-2 border-t pt-3">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    {t('common.back')}
                  </Button>
                  <Button disabled={realBlocked} onClick={submitReal} data-testid="env-create-submit">
                    {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('projectEnvs.createAndVerify')}
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && mode === 'mock' && (
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="env-mock-industry">
                    {t('projectEnvs.mockIndustryLabel')}
                  </Label>
                  <IndustryCombobox
                    id="env-mock-industry"
                    value={industry}
                    onChange={setIndustry}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('projectEnvs.mockIndustryHelper')}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="env-mock-name">{t('projectEnvs.mockNameLabel')}</Label>
                  <Input
                    id="env-mock-name"
                    value={mockName}
                    onChange={(event) => setMockName(event.target.value)}
                    placeholder={t('projectEnvs.mockNamePlaceholder')}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('projectEnvs.mockKeywordsLabel')} *</Label>
                  <KeywordInput keywords={keywords} onChange={handleKeywordsChange} />
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{t('projectEnvs.mockExampleLabel')}</span>
                    {[
                      t('projectEnvs.mockExample1'),
                      t('projectEnvs.mockExample2'),
                      t('projectEnvs.mockExample3'),
                    ].map((example) => (
                      <button
                        key={example}
                        type="button"
                        className="rounded-full border px-2 py-0.5 hover:border-teal/60 hover:text-teal"
                        onClick={() =>
                          handleKeywordsChange(
                            example.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
                          )
                        }
                      >
                        <Plus className="mr-0.5 inline h-3 w-3" />
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('projectEnvs.periodStart')} / {t('projectEnvs.periodEnd')}</Label>
                  <TimeRangeField
                    value={mockPeriod}
                    onChange={(next) => {
                      setMockPeriod(next)
                      setMockPeriodTouched(true)
                    }}
                    mode="mock"
                    idPrefix="env-mock-period"
                  />
                </div>
                <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  {t('projectEnvs.mockCostHint')}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    {t('common.back')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={mockBlocked}
                    onClick={submitMock}
                    data-testid="env-mock-submit"
                  >
                    {mockMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('projectEnvs.skipMaterials')}
                  </Button>
                  <Button
                    disabled={mockBlocked}
                    onClick={submitMockMaterials}
                    data-testid="env-mock-materials-submit"
                  >
                    {mockMaterialsMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {t('projectEnvs.generateMaterials')}
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && mode === 'mock' && envId && (
              <MaterialSelectionStep
                envId={envId}
                keywords={keywords.length ? keywords : (reopenedEnv?.keywords ?? [])}
                tab={materialTab}
                selectedIds={selectedMaterialIds}
                selectedRouteId={selectedRouteId}
                onTabChange={setMaterialTab}
                onSelectedIdsChange={setSelectedMaterialIds}
                onSelectedRouteChange={setSelectedRouteId}
                onSubmitted={() => setStep(lastStep)}
                onBack={() => setStep(2)}
                onClose={() => onOpenChange(false)}
              />
            )}

            {step === lastStep && envId && (
              <div className="space-y-3 py-2">
                <p className="text-sm font-medium">{t('projectEnvs.verifyingTitle')}</p>
                <VerificationPanel envId={envId} onCancel={() => onOpenChange(false)} />
                <div className="flex justify-end border-t pt-3">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    {t('projectEnvs.backToList')}
                  </Button>
                </div>
              </div>
            )}
              </>
            )}
          </WizardContainer>
        </div>
      </DialogContent>
    </Dialog>
  )
}

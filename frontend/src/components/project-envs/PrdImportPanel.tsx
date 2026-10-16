'use client'

import { useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { IndustryCombobox } from '@/components/ruankao/IndustryCombobox'
import { FileText, Loader2, Upload } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useParsePrd, useProjectEnvs } from '@/lib/hooks/use-project-envs'
import type { PrdParseDraft } from '@/lib/types/api'
import { validatePeriod, type ProjectEnvMode } from '@/lib/utils/project-env-time'
import { cn } from '@/lib/utils'
import { KEYWORD_MAX, KEYWORD_MIN, KeywordInput } from './KeywordInput'
import { TimeRangeField } from './TimeRangeField'
import { DEFAULT_INDUSTRY, INDUSTRY_STORAGE_KEY } from '@/lib/ruankao/industry-pool'

// prd_seed 只由五个叙述字段组成（period/keywords/industry 走各自通道）
const NARRATIVE_FIELDS = [
  'background',
  'tech_background',
  'tuning_process',
  'problems_solutions',
  'my_role',
] as const

// 真实通道 my_role 缺省：软考论文作者默认身份，预览可改，不填即用它
export const DEFAULT_MY_ROLE = '系统架构师'

export interface PrdImportRealPayload {
  name: string
  background: string
  period_start: string
  period_end: string
  keywords: string[]
  tech_background: string
  tuning_process: string | null
  problems_solutions: string | null
  my_role: string | null
}

export interface PrdImportMockPayload {
  name: string
  keywords: string[]
  industry: string
  period_start: string
  period_end: string
  prd_seed: Record<string, string>
}

interface PrdImportPanelProps {
  createPending: boolean
  mockPending: boolean
  onConfirmReal: (payload: PrdImportRealPayload) => void
  onConfirmMock: (payload: PrdImportMockPayload) => void
  onBack: () => void
}

function parseErrorInfo(error: unknown): { reason: string; message: string | null } {
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (detail && typeof detail === 'object') {
      return {
        reason: String(detail.reason ?? 'parse_failed'),
        message: typeof detail.message === 'string' ? detail.message : null,
      }
    }
  }
  return { reason: 'parse_failed', message: null }
}

export function PrdImportPanel({
  createPending,
  mockPending,
  onConfirmReal,
  onConfirmMock,
  onBack,
}: PrdImportPanelProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'input' | 'parsing' | 'preview'>('input')
  const [importMode, setImportMode] = useState<ProjectEnvMode>('real')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const parseMutation = useParsePrd()
  // Token fence: a canceled parse may still resolve later; the stale
  // response must not flip the UI into preview (same posture as polish).
  const parseTokenRef = useRef(0)

  const [draft, setDraft] = useState<PrdParseDraft | null>(null)
  const [omitted, setOmitted] = useState<Set<string>>(new Set())
  const [truncated, setTruncated] = useState(false)
  const [period, setPeriod] = useState({ start: '', end: '' })
  const [keywords, setKeywords] = useState<string[]>([])
  const [industry, setIndustry] = useState(
    () =>
      (typeof window !== 'undefined' &&
        localStorage.getItem(INDUSTRY_STORAGE_KEY)) ||
      DEFAULT_INDUSTRY
  )

  const { data: existingEnvs } = useProjectEnvs('manage')
  const existingNames = new Set(
    (existingEnvs ?? []).map((env) => env.name.trim()).filter(Boolean)
  )

  const hasText = !!text.trim()
  const hasFile = !!file
  const bothInputs = hasText && hasFile
  const noInputs = !hasText && !hasFile

  const handleParse = () => {
    if (bothInputs || noInputs) return
    const form = new FormData()
    if (hasText) form.append('text', text.trim())
    else if (file) form.append('file', file)
    const token = ++parseTokenRef.current
    setPhase('parsing')
    parseMutation.mutate(form, {
      onSuccess: (result) => {
        if (parseTokenRef.current !== token) return
        const role = result.draft.my_role.trim() || DEFAULT_MY_ROLE
        setDraft({
          ...result.draft,
          my_role: role,
        })
        const omittedSet = new Set(result.omitted)
        if (!result.draft.my_role.trim()) {
          omittedSet.delete('my_role')
        }
        setOmitted(omittedSet)
        setTruncated(result.input_truncated)
        setPeriod({ start: result.draft.period_start, end: result.draft.period_end })
        setKeywords(result.draft.keywords)
        if (result.draft.industry.trim()) setIndustry(result.draft.industry.trim())
        setPhase('preview')
      },
      onError: () => {
        if (parseTokenRef.current !== token) return
        setPhase('input')
      },
    })
  }

  const cancelParse = () => {
    parseTokenRef.current++
    parseMutation.reset()
    setPhase('input')
  }

  const errorInfo = parseMutation.isError ? parseErrorInfo(parseMutation.error) : null

  const setField = (field: keyof PrdParseDraft, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  const nameExists = !!draft?.name.trim() && existingNames.has(draft.name.trim())

  const violations = validatePeriod(period.start, period.end, importMode)
  const realBlocked =
    !draft?.name.trim() ||
    !draft?.background.trim() ||
    !draft?.tech_background.trim() ||
    !period.start ||
    !period.end ||
    violations.some((v) => v.severity === 'block') ||
    createPending
  const keywordsInvalid =
    keywords.length < KEYWORD_MIN || keywords.length > KEYWORD_MAX
  const mockBlocked =
    keywordsInvalid ||
    (!!period.start !== !!period.end) ||
    violations.some((v) => v.severity === 'block') ||
    mockPending

  const confirmReal = () => {
    if (!draft || realBlocked) return
    onConfirmReal({
      name: draft.name.trim(),
      background: draft.background.trim(),
      period_start: period.start,
      period_end: period.end,
      keywords,
      tech_background: draft.tech_background.trim(),
      tuning_process: draft.tuning_process.trim() || null,
      problems_solutions: draft.problems_solutions.trim() || null,
      my_role: draft.my_role.trim() || DEFAULT_MY_ROLE,
    })
  }

  const confirmMock = () => {
    if (!draft || mockBlocked) return
    const prdSeed: Record<string, string> = {}
    for (const field of NARRATIVE_FIELDS) {
      const value = draft[field].trim()
      if (value) prdSeed[field] = value
    }
    onConfirmMock({
      name: draft.name.trim(),
      keywords,
      industry,
      period_start: period.start,
      period_end: period.end,
      prd_seed: prdSeed,
    })
  }

  const omittedBadge = (field: string) =>
    omitted.has(field) ? (
      <span className="text-xs text-warn" data-testid={`prd-omitted-${field}`}>
        {t('projectEnvs.prdImport.omittedHint')}
      </span>
    ) : null

  return (
    <div className="space-y-4 py-2">
      {phase !== 'preview' && (
        <>
          <div className="space-y-1.5">
            <Label>{t('projectEnvs.prdImport.modeLabel')}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['real', 'mock'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setImportMode(mode)}
                  data-testid={`prd-mode-${mode}`}
                  className={cn(
                    'rounded-lg border p-3 text-left text-sm transition-colors',
                    mode === 'real'
                      ? 'hover:border-fern/60'
                      : 'hover:border-teal/60',
                    importMode === mode &&
                      (mode === 'real'
                        ? 'border-fern bg-fern-tint/40'
                        : 'border-teal bg-teal-tint/40')
                  )}
                >
                  <span className="font-medium">
                    {t(
                      mode === 'real'
                        ? 'projectEnvs.prdImport.modeReal'
                        : 'projectEnvs.prdImport.modeMock'
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prd-text">{t('projectEnvs.prdImport.textLabel')}</Label>
            <Textarea
              id="prd-text"
              value={text}
              disabled={phase === 'parsing'}
              onChange={(event) => setText(event.target.value)}
              placeholder={t('projectEnvs.prdImport.textPlaceholder')}
              rows={6}
              maxLength={100000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prd-file">{t('projectEnvs.prdImport.fileLabel')}</Label>
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                id="prd-file"
                type="file"
                accept=".txt,.md,.pdf,.docx"
                disabled={phase === 'parsing'}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                data-testid="prd-file-input"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('projectEnvs.prdImport.fileHint')}
            </p>
          </div>

          {(bothInputs || noInputs) && phase === 'input' && (
            <p className="text-xs text-warn" data-testid="prd-inputs-hint">
              {t(
                bothInputs
                  ? 'projectEnvs.prdImport.bothInputsHint'
                  : 'projectEnvs.prdImport.emptyInputsHint'
              )}
            </p>
          )}

          {errorInfo && phase === 'input' && (
            <p className="text-xs text-warn" data-testid="prd-parse-error">
              {errorInfo.reason === 'model_timeout'
                ? t('projectEnvs.prdImport.parseTimeout')
                : errorInfo.reason === 'model_error'
                  ? t('projectEnvs.prdImport.parseModelError')
                  : (errorInfo.message ?? t('projectEnvs.prdImport.parseFailed'))}
            </p>
          )}

          {phase === 'parsing' ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <Loader2 className="h-4 w-4 animate-spin text-teal" />
              <span className="text-sm text-muted-foreground" data-testid="prd-parsing">
                {t('projectEnvs.prdImport.parsing')}
              </span>
              <Button variant="ghost" size="sm" onClick={cancelParse}>
                {t('projectEnvs.prdImport.parseCancel')}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={onBack}>
                {t('projectEnvs.prdImport.back')}
              </Button>
              <Button
                onClick={handleParse}
                disabled={bothInputs || noInputs}
                data-testid="prd-parse-submit"
              >
                <FileText className="h-4 w-4" />
                {t('projectEnvs.prdImport.parse')}
              </Button>
            </div>
          )}
        </>
      )}

      {phase === 'preview' && draft && (
        <>
          <p className="text-sm font-medium">
            {t('projectEnvs.prdImport.previewTitle')}
          </p>
          {truncated && (
            <p
              className="rounded-md bg-warn-tint/50 p-2 text-xs text-warn"
              data-testid="prd-truncated-warning"
            >
              {t('projectEnvs.prdImport.truncatedWarning')}
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="prd-name">{t('projectEnvs.nameLabel')} *</Label>
              {omittedBadge('name')}
            </div>
            <Input
              id="prd-name"
              value={draft.name}
              onChange={(event) => setField('name', event.target.value)}
              maxLength={100}
              data-testid="prd-name-input"
            />
            {nameExists && (
              <p className="text-xs text-warn" data-testid="prd-name-exists">
                {t('projectEnvs.prdImport.nameExists')}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label>
                {t('projectEnvs.periodStart')} / {t('projectEnvs.periodEnd')}
                {importMode === 'real' ? ' *' : ''}
              </Label>
              {omittedBadge('period_start')}
              {omittedBadge('period_end')}
            </div>
            <TimeRangeField
              value={period}
              onChange={setPeriod}
              mode={importMode}
              idPrefix="prd-period"
            />
          </div>

          {importMode === 'mock' && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="prd-industry">
                    {t('projectEnvs.mockIndustryLabel')}
                  </Label>
                  {omittedBadge('industry')}
                </div>
                <IndustryCombobox id="prd-industry" value={industry} onChange={setIndustry} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label>{t('projectEnvs.mockKeywordsLabel')} *</Label>
                  {omittedBadge('keywords')}
                </div>
                <KeywordInput keywords={keywords} onChange={setKeywords} />
              </div>
            </>
          )}

          {(
            [
              ['background', 'backgroundLabel', 4, true],
              ['tech_background', 'techBackgroundLabel', 3, true],
              ['tuning_process', 'tuningLabel', 2, false],
              ['problems_solutions', 'problemsLabel', 2, false],
              ['my_role', 'myRoleLabel', 2, false],
            ] as const
          ).map(([field, labelKey, rows, required]) => (
            <div key={field} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`prd-${field}`}>
                  {t(`projectEnvs.${labelKey}`)}
                  {required && importMode === 'real' ? ' *' : ''}
                </Label>
                {omittedBadge(field)}
              </div>
              <Textarea
                id={`prd-${field}`}
                value={draft[field]}
                onChange={(event) => setField(field, event.target.value)}
                rows={rows}
                data-testid={`prd-field-${field}`}
              />
              {field === 'my_role' && importMode === 'real' && !draft.my_role.trim() && (
                <p className="text-xs text-muted-foreground" data-testid="prd-role-default-hint">
                  {t('projectEnvs.prdImport.roleDefaultHint', { role: DEFAULT_MY_ROLE })}
                </p>
              )}
            </div>
          ))}

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              variant="outline"
              onClick={() => {
                setPhase('input')
                parseMutation.reset()
              }}
            >
              {t('projectEnvs.prdImport.back')}
            </Button>
            {importMode === 'real' ? (
              <Button
                disabled={realBlocked}
                onClick={confirmReal}
                data-testid="prd-confirm-real"
              >
                {createPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('projectEnvs.prdImport.confirmReal')}
              </Button>
            ) : (
              <Button
                disabled={mockBlocked}
                onClick={confirmMock}
                data-testid="prd-confirm-mock"
              >
                {mockPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('projectEnvs.prdImport.confirmMock')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

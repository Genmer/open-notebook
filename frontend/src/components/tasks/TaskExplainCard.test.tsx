import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mirrors api/explain_service.py _degraded_response: anchors inline with an
// em-dash, trailing bare JSON. The standalone-line variant lives below.
const INLINE_MARKDOWN = [
  'AI-powered explanation is unavailable right now; the rule-based classification below stands in.',
  '',
  '**What happened** — The task failed midway.',
  '**Likely root cause** — A transient network error (classification: transient, confidence: low).',
  '**How to fix** — 1. Follow the suggested action. 2. Copy diagnostics.',
  '**Next actions** — Start with the first suggested action.',
  '',
  '{"category":"transient","suggestions":[{"action":"retry"}]}',
].join('\n')

const STANDALONE_MARKDOWN = [
  '**What happened**',
  'The task failed midway.',
  '',
  '**Likely root cause**',
  'A transient network error.',
  '',
  '**How to fix**',
  '1. Follow the suggested action.',
  '',
  '**Next actions**',
  'Start with the first suggested action.',
  '',
  '{"category":"transient"}',
].join('\n')

const FENCED_JSON_MARKDOWN = [
  '**What happened** — The task failed midway.',
  '**Likely root cause** — A transient network error.',
  '**How to fix** — 1. Follow the suggested action.',
  '**Next actions** — Start with the first suggested action.',
  '',
  '```json',
  '{"category":"transient","suggestions":[{"action":"retry"}]}',
  '```',
].join('\n')

const { explainMutate, explainState } = vi.hoisted(() => ({
  explainMutate: vi.fn(),
  explainState: {
    data: null as Record<string, unknown> | null,
    isPending: false,
  },
}))

vi.mock('@/lib/hooks/use-explain', () => ({
  useExplain: () => ({
    data: explainState.data,
    isError: false,
    isPending: explainState.isPending,
    mutate: explainMutate,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { TaskExplainCard } from './TaskExplainCard'
import type { TaskEntry } from '@/lib/api/tasks'
import { toast } from 'sonner'

// use-translation is mocked globally in src/test/setup.ts (t returns the key).

const writeText = vi.fn().mockResolvedValue(undefined)

const makeTask = (overrides: Partial<TaskEntry> = {}): TaskEntry => ({
  id: 'command:failed1',
  name: 'export_data',
  type: 'data_transfer',
  target: null,
  status: 'failed',
  progress: null,
  error_message: 'super-secret-token boom',
  created: '2026-09-28T00:00:00Z',
  updated: null,
  retryable: false,
  ...overrides,
})

const setExplainData = (
  markdown: string,
  recovery?: { recovered: boolean; detail: string } | null,
) => {
  explainState.data = {
    mode: 'explain',
    classification: 'transient',
    explanation_markdown: markdown,
    suggestions: [
      { action: 'retry', label_key: 'tasks.explain.actionRetry' },
      { action: 'open_models_settings', label_key: 'tasks.explain.actionOpenModelsSettings' },
      { action: 'open_credentials', label_key: 'tasks.explain.actionOpenCredentials' },
      { action: 'copy_diagnostics', label_key: 'tasks.explain.actionCopyDiagnostics' },
      { action: 'report_issue', label_key: 'tasks.explain.actionReportIssue' },
      // not a backend-whitelisted action: must not render anything
      { action: 'bogus', label_key: 'tasks.explain.actionBogus' },
    ],
    facts: [
      { label_key: 'tasks.explain.factCommand', value: 'export_data' },
      { label_key: 'tasks.explain.factError', value: 'boom at step 2 (redacted)' },
    ],
    recovery,
    degraded: false,
    from_cache: false,
  }
}

describe('TaskExplainCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    explainState.isPending = false
    setExplainData(INLINE_MARKDOWN)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  it('renders the multicolor AI badge in the card header', () => {
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    const label = screen.getByText('tasks.explain.aiLabel')
    // The gradient span itself carries the label text.
    expect(label).toHaveClass('bg-gradient-to-r', 'from-teal-500', 'text-white')
    // Sparkles icon ships inside the badge.
    expect(label.querySelector('svg')).toBeInTheDocument()
  })

  it('shows the AI thinking line with staggered bouncing dots while pending', () => {
    explainState.data = null
    explainState.isPending = true
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    const line = screen.getByText('tasks.explain.thinking')
    expect(line.parentElement).toHaveClass('text-teal')
    expect(line.parentElement?.querySelectorAll('.animate-bounce')).toHaveLength(3)
    // A faint skeleton keeps the content-area feel under the thinking row.
    expect(document.querySelector('.animate-pulse.rounded.bg-muted')).toBeInTheDocument()
  })

  it('shows the recovered notice and no retry buttons when recovery.recovered is true', () => {
    setExplainData(INLINE_MARKDOWN, { recovered: true, detail: 'source processed later' })
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    expect(screen.getByText('tasks.explain.recoveredNotice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.explain.actionRetry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.explain.aiRetry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.explain.manualRetry' })).not.toBeInTheDocument()
    // Non-retry suggestions still render.
    expect(
      screen.getByRole('link', { name: 'tasks.explain.actionOpenModelsSettings' }),
    ).toBeInTheDocument()
  })

  it('renders AI retry + manual retry when recovery exists and the task is not recovered', () => {
    setExplainData(INLINE_MARKDOWN, { recovered: false, detail: 'still failing' })
    const onRetry = vi.fn()
    render(<TaskExplainCard task={makeTask()} onRetry={onRetry} />)

    const aiButton = screen.getByRole('button', { name: 'tasks.explain.aiRetry' })
    const manualButton = screen.getByRole('button', { name: 'tasks.explain.manualRetry' })
    expect(screen.queryByRole('button', { name: 'tasks.explain.actionRetry' })).not.toBeInTheDocument()

    fireEvent.click(aiButton)
    fireEvent.click(manualButton)

    expect(onRetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'command:failed1', status: 'failed' }),
      { checkRecovery: true },
    )
    // Manual retry carries no pre-check: onRetry gets the task alone.
    expect(onRetry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'command:failed1' }),
    )
  })

  it('refreshes the explanation when the AI retry pre-check reports recovery', async () => {
    setExplainData(INLINE_MARKDOWN, { recovered: false, detail: 'still failing' })
    const onRetry = vi.fn().mockResolvedValue({
      job_id: null,
      status: 'skipped_recovered',
      message: 'Already recovered: source ok',
    })
    render(<TaskExplainCard task={makeTask()} onRetry={onRetry} />)

    // Mount fired the initial request; the skip must trigger a refresh re-ask.
    expect(explainMutate).toHaveBeenCalledWith({ refresh: false })
    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.aiRetry' }))

    await waitFor(() => expect(explainMutate).toHaveBeenCalledWith({ refresh: true }))
  })

  it('does not refresh the explanation when the AI retry actually replays the job', async () => {
    setExplainData(INLINE_MARKDOWN, { recovered: false, detail: 'still failing' })
    const onRetry = vi.fn().mockResolvedValue({
      job_id: 'command:replayed',
      status: 'submitted',
    })
    render(<TaskExplainCard task={makeTask()} onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.aiRetry' }))

    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1))
    // Let the awaited onRetry continuation run before asserting no refresh.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(explainMutate).toHaveBeenCalledTimes(1)
    expect(explainMutate).toHaveBeenCalledWith({ refresh: false })
  })

  it('keeps a single plain retry button when recovery is unknown', () => {
    setExplainData(INLINE_MARKDOWN, null)
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'tasks.explain.actionRetry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.explain.aiRetry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tasks.explain.manualRetry' })).not.toBeInTheDocument()
    expect(screen.queryByText('tasks.explain.recoveredNotice')).not.toBeInTheDocument()
  })

  it('renders one labeled control per backend-whitelisted action and skips unknown actions', () => {
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    // plain buttons
    for (const key of ['tasks.explain.actionRetry', 'tasks.explain.actionCopyDiagnostics']) {
      expect(screen.getByRole('button', { name: key })).toBeInTheDocument()
    }
    // navigation actions render as links (Button asChild)
    for (const key of [
      'tasks.explain.actionOpenModelsSettings',
      'tasks.explain.actionOpenCredentials',
      'tasks.explain.actionReportIssue',
    ]) {
      expect(screen.getByRole('link', { name: key })).toBeInTheDocument()
    }
    expect(screen.queryByText('tasks.explain.actionBogus')).not.toBeInTheDocument()
  })

  it('points report_issue at the upstream repository issues page', () => {
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    const link = screen.getByRole('link', { name: 'tasks.explain.actionReportIssue' })
    expect(link).toHaveAttribute('href', 'https://github.com/lfnovo/open-notebook/issues')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('splits the backend inline-anchor format into i18n-titled sections', () => {
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    expect(screen.getByText('tasks.explain.sectionWhat')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.sectionCause')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.sectionFix')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.sectionNext')).toBeInTheDocument()

    // Inline body survives; anchor text and the trailing JSON do not render.
    expect(screen.getByText(/The task failed midway/)).toBeInTheDocument()
    expect(screen.getByText(/Follow the suggested action/)).toBeInTheDocument()
    expect(screen.queryByText(/\*\*What happened\*\*/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"category"/)).not.toBeInTheDocument()
  })

  it('also splits the standalone-line anchor format', () => {
    setExplainData(STANDALONE_MARKDOWN)
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    for (const key of [
      'tasks.explain.sectionWhat',
      'tasks.explain.sectionCause',
      'tasks.explain.sectionFix',
      'tasks.explain.sectionNext',
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument()
    }
    expect(screen.getByText(/The task failed midway/)).toBeInTheDocument()
    expect(screen.queryByText(/\*\*What happened\*\*/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"category"/)).not.toBeInTheDocument()
  })

  it('strips a fenced ```json tail instead of rendering the fence', () => {
    setExplainData(FENCED_JSON_MARKDOWN)
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    expect(screen.getByText('tasks.explain.sectionWhat')).toBeInTheDocument()
    expect(screen.queryByText(/"category"/)).not.toBeInTheDocument()
    expect(screen.queryByText(/```/)).not.toBeInTheDocument()
  })

  it('routes the retry action through onRetry with the owning task', () => {
    const onRetry = vi.fn()
    render(<TaskExplainCard task={makeTask()} onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.actionRetry' }))

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'command:failed1', status: 'failed' }),
    )
  })

  it('copies only the task id and backend-redacted facts, never the raw error', async () => {
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.actionCopyDiagnostics' }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('command:failed1')
    expect(text).toContain('boom at step 2 (redacted)')
    // task.error_message holds an unredacted secret-like token; it must not leak.
    expect(text).not.toContain('super-secret-token')
    expect(toast.success).toHaveBeenCalledWith('tasks.explain.copyDone')
  })

  it('reveals the facts list with backend fact label keys on toggle', () => {
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    expect(screen.queryByText('export_data')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.factsTitle' }))

    expect(screen.getByText('tasks.explain.factCommand')).toBeInTheDocument()
    expect(screen.getByText('tasks.explain.factError')).toBeInTheDocument()
    expect(screen.getByText('export_data')).toBeInTheDocument()
  })

  it('refresh re-asks the backend bypassing the cache', () => {
    render(<TaskExplainCard task={makeTask()} onRetry={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'tasks.explain.refresh' }))

    expect(explainMutate).toHaveBeenCalledWith({ refresh: true })
  })
})

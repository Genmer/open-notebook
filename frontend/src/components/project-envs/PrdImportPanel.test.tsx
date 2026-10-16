import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrdImportPanel } from './PrdImportPanel'
import { useParsePrd, useProjectEnvs } from '@/lib/hooks/use-project-envs'
import type { PrdParseResponse } from '@/lib/types/api'

// t() is mocked globally in setup.ts (returns the key string)

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useParsePrd: vi.fn(),
  useProjectEnvs: vi.fn(),
}))

vi.mock('./TimeRangeField', () => ({
  // Interactive stub: clicking injects a rule-valid period via onChange.
  TimeRangeField: ({
    onChange,
  }: {
    onChange: (value: { start: string; end: string }) => void
  }) => (
    <button
      type="button"
      data-testid="period-stub"
      onClick={() => onChange({ start: '2025.02', end: '2025.09' })}
    >
      period
    </button>
  ),
}))

vi.mock('@/components/ruankao/IndustryCombobox', () => ({
  IndustryCombobox: ({ value }: { value: string }) => (
    <div data-testid="industry-stub">{value}</div>
  ),
}))

interface ParseMutation {
  mutate: ReturnType<typeof vi.fn>
  isPending: boolean
  isError: boolean
  error: unknown
  reset: ReturnType<typeof vi.fn>
}

function mockParseMutation(): ParseMutation {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }
}

function parseResponse(
  overrides: Partial<PrdParseResponse['draft']> = {}
): PrdParseResponse {
  return {
    draft: {
      name: '物流 TMS 系统',
      period_start: '2025.02',
      period_end: '2025.09',
      industry: '物流行业',
      keywords: ['TMS', '物流'],
      background: 'PRD 抽取的项目背景。',
      tech_background: 'PRD 抽取的技术栈。',
      tuning_process: '',
      problems_solutions: '',
      my_role: '',
      ...overrides,
    },
    omitted: [],
    input_truncated: false,
    extracted_chars: 100,
  }
}

function setupPanel(envs: { name: string }[] = []) {
  const parseMutation = mockParseMutation()
  vi.mocked(useParsePrd).mockReturnValue(parseMutation as never)
  vi.mocked(useProjectEnvs).mockReturnValue({ data: envs } as never)
  const onConfirmReal = vi.fn()
  const onConfirmMock = vi.fn()
  render(
    <PrdImportPanel
      createPending={false}
      mockPending={false}
      onConfirmReal={onConfirmReal}
      onConfirmMock={onConfirmMock}
      onBack={vi.fn()}
    />
  )
  return { parseMutation, onConfirmReal, onConfirmMock }
}

function typeText(value: string) {
  fireEvent.change(screen.getByLabelText('projectEnvs.prdImport.textLabel'), {
    target: { value },
  })
}

function attachFile(name: string) {
  const input = screen.getByTestId('prd-file-input') as HTMLInputElement
  const file = new File(['PRD bytes'], name, { type: 'text/plain' })
  Object.defineProperty(input, 'files', { value: [file] })
  fireEvent.change(input)
}

async function runParseSuccess(
  mutation: ParseMutation,
  result: PrdParseResponse
) {
  const options = mutation.mutate.mock.calls[0][1] as {
    onSuccess: (result: PrdParseResponse) => void
  }
  await act(async () => {
    options.onSuccess(result)
  })
}

describe('PrdImportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('disables parse and hints when input is empty or both given', async () => {
    const { parseMutation } = setupPanel()
    const parseButton = screen.getByTestId('prd-parse-submit') as HTMLButtonElement
    expect(parseButton.disabled).toBe(true)
    expect(screen.getByTestId('prd-inputs-hint').textContent).toBe(
      'projectEnvs.prdImport.emptyInputsHint'
    )

    typeText('PRD 文本')
    expect(parseButton.disabled).toBe(false)
    expect(screen.queryByTestId('prd-inputs-hint')).toBeNull()

    attachFile('a.txt')
    expect(parseButton.disabled).toBe(true)
    expect(screen.getByTestId('prd-inputs-hint').textContent).toBe(
      'projectEnvs.prdImport.bothInputsHint'
    )
    expect(parseMutation.mutate).not.toHaveBeenCalled()
  })

  it('sends pasted text as FormData and shows parsing with cancel', async () => {
    const { parseMutation } = setupPanel()
    typeText('  PRD 文本  ')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))

    expect(parseMutation.mutate).toHaveBeenCalledTimes(1)
    const form = parseMutation.mutate.mock.calls[0][0] as FormData
    expect(form.get('text')).toBe('PRD 文本')
    expect(screen.getByTestId('prd-parsing').textContent).toBe(
      'projectEnvs.prdImport.parsing'
    )
    // 解析中不能再提交
    expect(screen.queryByTestId('prd-parse-submit')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'projectEnvs.prdImport.parseCancel' })
    )
    expect(parseMutation.reset).toHaveBeenCalled()
    expect(screen.getByTestId('prd-parse-submit')).toBeTruthy()
  })

  it('a late success after cancel does not flip the UI into preview (token fence)', async () => {
    const { parseMutation } = setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    fireEvent.click(
      screen.getByRole('button', { name: 'projectEnvs.prdImport.parseCancel' })
    )

    await runParseSuccess(parseMutation, parseResponse())
    expect(screen.queryByTestId('prd-name-input')).toBeNull()
    expect(screen.getByTestId('prd-parse-submit')).toBeTruthy()
  })

  it('re-parsing after a cancel can still succeed and enter preview', async () => {
    const { parseMutation } = setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    fireEvent.click(
      screen.getByRole('button', { name: 'projectEnvs.prdImport.parseCancel' })
    )

    // 取消后重新解析：第二次 mutate 的 onSuccess（新 token）正常进预览
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    expect(parseMutation.mutate).toHaveBeenCalledTimes(2)
    await act(async () => {
      const options = parseMutation.mutate.mock.calls[1][1] as {
        onSuccess: (result: PrdParseResponse) => void
      }
      options.onSuccess(parseResponse())
    })

    expect(screen.getByText('projectEnvs.prdImport.previewTitle')).toBeTruthy()
    expect(screen.getByTestId('prd-name-input')).toBeTruthy()
  })

  it('real confirm stays blocked while a required field is emptied', async () => {
    const { parseMutation } = setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    await runParseSuccess(parseMutation, parseResponse())

    const confirm = screen.getByTestId('prd-confirm-real') as HTMLButtonElement
    expect(confirm.disabled).toBe(false) // 解析结果四必填齐全

    fireEvent.change(screen.getByTestId('prd-name-input'), {
      target: { value: '' },
    })
    expect(confirm.disabled).toBe(true) // name 清空后必填拦截
  })

  it('preview marks omitted fields with the warn hint and sets default role', async () => {
    setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    const result = parseResponse({ my_role: '', tuning_process: '' })
    result.omitted = ['my_role', 'period_start', 'tuning_process']
    await runParseSuccess(
      (
        vi.mocked(useParsePrd).mock.results[
          vi.mocked(useParsePrd).mock.results.length - 1
        ]?.value as ParseMutation
      ),
      result
    )

    expect(screen.getByText('projectEnvs.prdImport.previewTitle')).toBeTruthy()
    // 未提供的真实缺省字段（my_role）自动应用默认值，不显示警告标签
    expect(screen.queryByTestId('prd-omitted-my_role')).toBeNull()
    expect(
      (screen.getByTestId('prd-field-my_role') as HTMLTextAreaElement).value
    ).toBe('系统架构师')
    expect(screen.getByTestId('prd-omitted-period_start')).toBeTruthy()
    expect(screen.getByTestId('prd-omitted-tuning_process')).toBeTruthy()
    expect(screen.queryByTestId('prd-omitted-background')).toBeNull()
  })

  it('real confirm carries parsed keywords and the default role, never scale/industry', async () => {
    const { parseMutation, onConfirmReal } = setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    await runParseSuccess(
      parseMutation,
      parseResponse({
        period_start: '',
        period_end: '',
        tuning_process: '',
        problems_solutions: '',
        my_role: '',
      })
    )

    const confirm = screen.getByTestId('prd-confirm-real') as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // PRD 未给周期，必须补齐才能确认

    fireEvent.click(screen.getByTestId('period-stub'))
    expect(confirm.disabled).toBe(false)
    // 默认预填系统架构师，此时不展示留空提示
    expect(screen.queryByTestId('prd-role-default-hint')).toBeNull()
    // 若手动清空输入框，才提示默认值兜底
    fireEvent.change(screen.getByTestId('prd-field-my_role'), {
      target: { value: '' },
    })
    expect(screen.getByTestId('prd-role-default-hint').textContent).toBe(
      'projectEnvs.prdImport.roleDefaultHint'
    )
    fireEvent.click(confirm)

    expect(onConfirmReal).toHaveBeenCalledTimes(1)
    const payload = onConfirmReal.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      name: '物流 TMS 系统',
      period_start: '2025.02',
      period_end: '2025.09',
      keywords: ['TMS', '物流'],
      tuning_process: null,
      problems_solutions: null,
      // PRD 未给角色 → 默认系统架构师（可改）
      my_role: '系统架构师',
    })
    expect('scale' in payload).toBe(false)
    expect('industry' in payload).toBe(false)
  })

  it('real confirm keeps a hand-edited role over the default', async () => {
    const { parseMutation, onConfirmReal } = setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    await runParseSuccess(
      parseMutation,
      parseResponse({ my_role: '' })
    )

    fireEvent.change(screen.getByTestId('prd-field-my_role'), {
      target: { value: '技术总监' },
    })
    expect(screen.queryByTestId('prd-role-default-hint')).toBeNull()
    fireEvent.click(screen.getByTestId('prd-confirm-real'))

    const payload = onConfirmReal.mock.calls[0][0] as Record<string, unknown>
    expect(payload.my_role).toBe('技术总监')
  })

  it('mock confirm requires 2-8 keywords and sends prd_seed with empties dropped', async () => {
    const { parseMutation, onConfirmMock } = setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-mode-mock'))
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    await runParseSuccess(
      parseMutation,
      parseResponse({
        keywords: [],
        tuning_process: '',
        problems_solutions: '',
        my_role: '',
      })
    )

    fireEvent.click(screen.getByTestId('period-stub'))
    const confirm = screen.getByTestId('prd-confirm-mock') as HTMLButtonElement

    // 从 0 补到 2 个关键词：占位符输入框敲入并回车（节点复用，引用可跨渲染持有）
    const keywordBox = screen.getByPlaceholderText('projectEnvs.mockKeywordsPlaceholder')
    fireEvent.change(keywordBox, { target: { value: 'TMS' } })
    fireEvent.keyDown(keywordBox, { key: 'Enter' })
    expect(confirm.disabled).toBe(true) // 只有 1 个关键词

    fireEvent.change(keywordBox, { target: { value: '运输调度' } })
    fireEvent.keyDown(keywordBox, { key: 'Enter' })
    expect(confirm.disabled).toBe(false)

    fireEvent.click(confirm)
    expect(onConfirmMock).toHaveBeenCalledTimes(1)
    const payload = onConfirmMock.mock.calls[0][0] as {
      keywords: string[]
      prd_seed: Record<string, string>
    }
    expect(payload.keywords).toEqual(['TMS', '运输调度'])
    // 空叙述字段（如 tuning_process/problems_solutions）剔出 seed，默认角色则保留
    expect(Object.keys(payload.prd_seed).sort()).toEqual([
      'background',
      'my_role',
      'tech_background',
    ])
    expect(payload.prd_seed.my_role).toBe('系统架构师')
    expect(payload.prd_seed.background).toBe('PRD 抽取的项目背景。')
  })

  it('warns (without blocking) when an env with the same name exists', async () => {
    const { parseMutation, onConfirmReal } = setupPanel([
      { name: '物流 TMS 系统' },
    ])
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    await runParseSuccess(parseMutation, parseResponse())

    expect(screen.getByTestId('prd-name-exists').textContent).toBe(
      'projectEnvs.prdImport.nameExists'
    )
    fireEvent.click(screen.getByTestId('period-stub'))
    const confirm = screen.getByTestId('prd-confirm-real') as HTMLButtonElement
    expect(confirm.disabled).toBe(false) // 轻提示不硬拦
    fireEvent.click(confirm)
    expect(onConfirmReal).toHaveBeenCalledTimes(1)
  })

  it('shows the truncation warning banner when input was truncated', async () => {
    const { parseMutation } = setupPanel()
    typeText('PRD 文本')
    fireEvent.click(screen.getByTestId('prd-parse-submit'))
    const result = parseResponse()
    result.input_truncated = true
    await runParseSuccess(parseMutation, result)

    expect(screen.getByTestId('prd-truncated-warning').textContent).toBe(
      'projectEnvs.prdImport.truncatedWarning'
    )
  })
})

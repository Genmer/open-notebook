import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreateEnvWizard } from './CreateEnvWizard'
import {
  useCreateProjectEnv,
  useMockGenerateProjectEnv,
  usePolishBackground,
  useProjectEnv,
} from '@/lib/hooks/use-project-envs'
import type { ProjectEnv } from '@/lib/types/api'

// cmdk 的 CommandList 需要 ResizeObserver，jsdom 没有实现
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// t() is mocked globally in setup.ts (returns the key string)

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useCreateProjectEnv: vi.fn(),
  useMockGenerateProjectEnv: vi.fn(),
  usePolishBackground: vi.fn(),
  useProjectEnv: vi.fn(),
}))

vi.mock('./MaterialSelectionStep', () => ({
  MaterialSelectionStep: () => <div data-testid="material-step-stub" />,
}))

vi.mock('./VerificationPanel', () => ({
  VerificationPanel: () => <div data-testid="verification-stub" />,
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

// Radix Popover 在 jsdom 里打不开（NotesColumn/Select 先例手法无效）：
// mock 成常开浮层，直接断言过滤列表与点选行为
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="industry-popover">{children}</div>
  ),
}))

function mockMutation() {
  return { mutate: vi.fn(), isPending: false, reset: vi.fn() }
}

const verifiedEnv = {
  id: 'project_env:e1',
  source_type: 'mock',
  status: 'verified',
  keywords: ['微服务', '高并发'],
} as unknown as ProjectEnv

function setupMutationMocks() {
  const materialsMutation = mockMutation()
  const directMutation = mockMutation()
  // The wizard calls useMockGenerateProjectEnv twice per render (materials
  // submit + skip submit); every render re-invokes the hooks, so map calls
  // by parity instead of a one-shot return-value queue.
  let seq = 0
  vi.mocked(useMockGenerateProjectEnv).mockImplementation(
    () =>
      ((seq += 1) % 2 === 1 ? directMutation : materialsMutation) as unknown as ReturnType<
        typeof useMockGenerateProjectEnv
      >
  )
  vi.mocked(useCreateProjectEnv).mockReturnValue(
    mockMutation() as unknown as ReturnType<typeof useCreateProjectEnv>
  )
  vi.mocked(usePolishBackground).mockReturnValue(
    mockMutation() as unknown as ReturnType<typeof usePolishBackground>
  )
  vi.mocked(useProjectEnv).mockReturnValue({
    data: verifiedEnv,
    isError: false,
  } as unknown as ReturnType<typeof useProjectEnv>)
  return { materialsMutation, directMutation }
}

function fillMockForm() {
  fireEvent.click(screen.getByTestId('env-mode-mock')) // enters step 2 directly
  const keywordInput = screen.getByPlaceholderText('projectEnvs.mockKeywordsPlaceholder')
  fireEvent.change(keywordInput, { target: { value: '微服务 高并发' } })
  fireEvent.keyDown(keywordInput, { key: 'Enter' })
  expect(screen.getByText('微服务')).toBeInTheDocument()
  expect(screen.getByText('高并发')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('period-stub'))
}

describe('CreateEnvWizard materials flow', () => {
  let mutations: ReturnType<typeof setupMutationMocks>

  beforeEach(() => {
    vi.clearAllMocks()
    mutations = setupMutationMocks()
  })

  it('mock mode shows 4 steps with the materials step indicator', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByTestId('env-mode-mock'))

    expect(screen.getByText('projectEnvs.stepMaterials')).toBeInTheDocument()
    expect(screen.getByText('projectEnvs.generateMaterials')).toBeInTheDocument()
    expect(screen.getByText('projectEnvs.skipMaterials')).toBeInTheDocument()
  })

  it('submits flow=materials from the primary button and lands on step 3', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)

    fillMockForm()
    const submit = screen.getByTestId('env-mock-materials-submit')
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)

    const mutation = mutations.materialsMutation
    expect(mutation.mutate).toHaveBeenCalledTimes(1)
    const [payload, options] = mutation.mutate.mock.calls[0]
    expect(payload.flow).toBe('materials')
    expect(payload.keywords).toEqual(['微服务', '高并发'])

    // job created -> wizard moves to the materials step
    act(() => options.onSuccess({ id: 'project_env:new' }))
    expect(screen.getByTestId('material-step-stub')).toBeInTheDocument()
  })

  it('submits flow=direct from the skip button and jumps to verification', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)

    fillMockForm()
    fireEvent.click(screen.getByTestId('env-mock-submit'))

    const mutation = mutations.directMutation
    expect(mutation.mutate).toHaveBeenCalledTimes(1)
    expect(mutation.mutate.mock.calls[0][0].flow).toBe('direct')

    const options = mutation.mutate.mock.calls[0][1]
    act(() => options.onSuccess({ id: 'project_env:new' }))
    expect(screen.getByTestId('verification-stub')).toBeInTheDocument()
    expect(
      screen.queryByTestId('material-step-stub')
    ).not.toBeInTheDocument()
  })

  it('reopening a material_ready env lands on the materials step', () => {
    vi.mocked(useProjectEnv).mockReturnValue({
      data: {
        ...verifiedEnv,
        status: 'material_ready',
        materials: { materials: { items: [] }, routes: { items: [] } },
      } as unknown as ProjectEnv,
      isError: false,
    } as unknown as ReturnType<typeof useProjectEnv>)

    render(
      <CreateEnvWizard open onOpenChange={vi.fn()} initialEnvId="project_env:e1" />
    )

    expect(screen.getByTestId('material-step-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('verification-stub')).not.toBeInTheDocument()
  })

  it('reopening a failed mock env lands on the materials step for retry/repick', () => {
    vi.mocked(useProjectEnv).mockReturnValue({
      data: { ...verifiedEnv, status: 'failed' } as unknown as ProjectEnv,
      isError: false,
    } as unknown as ReturnType<typeof useProjectEnv>)

    render(
      <CreateEnvWizard open onOpenChange={vi.fn()} initialEnvId="project_env:e1" />
    )

    expect(screen.getByTestId('material-step-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('verification-stub')).not.toBeInTheDocument()
  })
})

describe('CreateEnvWizard industry input', () => {
  let mutations: ReturnType<typeof setupMutationMocks>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mutations = setupMutationMocks()
  })

  it('defaults to 物流行业 and restores the last persisted choice', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('env-mode-mock'))
    expect(screen.getByTestId('env-mock-industry')).toHaveValue('物流行业')

    localStorage.setItem('project-env-industry', '医疗行业')
    cleanup()
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('env-mode-mock'))
    expect(screen.getByTestId('env-mock-industry')).toHaveValue('医疗行业')
  })

  it('sends industry with both mock payloads and persists the final value on submit', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fillMockForm()
    fireEvent.change(screen.getByTestId('env-mock-industry'), {
      target: { value: '医疗行业' },
    })
    fireEvent.click(screen.getByTestId('env-mock-materials-submit'))
    fireEvent.click(screen.getByTestId('env-mock-submit'))

    expect(
      mutations.materialsMutation.mutate.mock.calls[0][0].industry
    ).toBe('医疗行业')
    expect(
      mutations.directMutation.mutate.mock.calls[0][0].industry
    ).toBe('医疗行业')
    expect(localStorage.getItem('project-env-industry')).toBe('医疗行业')
  })

  it('omits industry from the payload when the input is emptied', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fillMockForm()
    fireEvent.change(screen.getByTestId('env-mock-industry'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByTestId('env-mock-materials-submit'))

    expect(
      mutations.materialsMutation.mutate.mock.calls[0][0].industry
    ).toBeUndefined()
  })

  it('refills the switched industry from localStorage when the wizard reopens', () => {
    // full round trip: switch 行业 -> submit (persistIndustry writes) -> remount
    // the wizard -> the input must backfill the persisted choice, not the default
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fillMockForm()
    fireEvent.change(screen.getByTestId('env-mock-industry'), {
      target: { value: '金融行业' },
    })
    fireEvent.click(screen.getByTestId('env-mock-materials-submit'))
    expect(localStorage.getItem('project-env-industry')).toBe('金融行业')

    cleanup()
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('env-mode-mock'))
    expect(screen.getByTestId('env-mock-industry')).toHaveValue('金融行业')
  })
})

describe('CreateEnvWizard industry combobox', () => {
  let mutations: ReturnType<typeof setupMutationMocks>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mutations = setupMutationMocks()
  })

  it('keeps a real input with maxLength 20 and Enter picks the first pool match', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('env-mode-mock'))

    const input = screen.getByTestId('env-mock-industry')
    expect(input).toHaveAttribute('maxlength', '20')

    fireEvent.change(input, { target: { value: '银行' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('银行核心系统改造')
  })

  it('shows the filtered pool entries in the popover and sets the value on pick', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('env-mode-mock'))

    const input = screen.getByTestId('env-mock-industry')
    fireEvent.change(input, { target: { value: '银行' } })

    expect(screen.getAllByRole('option').length).toBe(4)
    fireEvent.click(screen.getByRole('option', { name: '银行统一收单平台' }))
    expect(input).toHaveValue('银行统一收单平台')
  })

  it('accepts free text outside the pool as a valid industry (custom fallback)', () => {
    render(<CreateEnvWizard open onOpenChange={vi.fn()} />)
    fillMockForm()
    fireEvent.change(screen.getByTestId('env-mock-industry'), {
      target: { value: '航天行业' },
    })
    fireEvent.click(screen.getByTestId('env-mock-materials-submit'))

    expect(
      mutations.materialsMutation.mutate.mock.calls[0][0].industry
    ).toBe('航天行业')
    expect(localStorage.getItem('project-env-industry')).toBe('航天行业')
  })
})

describe('CreateEnvWizard preset seed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupMutationMocks()
  })

  it('opens straight at mock step 2 with the preset industry', () => {
    render(
      <CreateEnvWizard open onOpenChange={vi.fn()} preset={{ industry: '能源行业' }} />
    )

    expect(screen.getByTestId('env-mock-industry')).toHaveValue('能源行业')
    expect(
      screen.getByPlaceholderText('projectEnvs.mockKeywordsPlaceholder')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('env-mode-real')).not.toBeInTheDocument()
  })

  it('preset wins over the persisted localStorage choice', () => {
    localStorage.setItem('project-env-industry', '医疗行业')
    render(
      <CreateEnvWizard open onOpenChange={vi.fn()} preset={{ industry: '能源行业' }} />
    )

    expect(screen.getByTestId('env-mock-industry')).toHaveValue('能源行业')
  })
})

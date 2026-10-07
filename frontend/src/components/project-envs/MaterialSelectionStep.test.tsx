import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { MaterialSelectionStep, type MaterialTab } from './MaterialSelectionStep'
import {
  useGenerateProjectEnvMaterials,
  useProjectEnvMaterials,
  useRegenerateProjectEnv,
  useSubmitProjectEnvMaterials,
} from '@/lib/hooks/use-project-envs'
import type {
  ProjectEnvMaterialItem,
  ProjectEnvMaterialsStatus,
  ProjectEnvRouteProposal,
} from '@/lib/types/api'

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvMaterials: vi.fn(),
  useGenerateProjectEnvMaterials: vi.fn(),
  useRegenerateProjectEnv: vi.fn(),
  useSubmitProjectEnvMaterials: vi.fn(),
}))

// Radix AlertDialog is unreliable in jsdom; probe the ConfirmDialog contract.
vi.mock('@/components/common/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    onConfirm,
  }: {
    open: boolean
    title: React.ReactNode
    onConfirm: () => void
  }) =>
    open ? (
      <div data-testid="confirm-probe">
        <span>{title}</span>
        <button type="button" onClick={onConfirm}>
          confirm
        </button>
      </div>
    ) : null,
}))

const mockMaterials = vi.mocked(useProjectEnvMaterials)
const mockGenerate = vi.mocked(useGenerateProjectEnvMaterials)
const mockRegenerate = vi.mocked(useRegenerateProjectEnv)
const mockSubmit = vi.mocked(useSubmitProjectEnvMaterials)

function material(overrides: Partial<ProjectEnvMaterialItem> = {}): ProjectEnvMaterialItem {
  return {
    id: 'm1',
    category: 'background',
    title: '素材标题',
    text: '素材正文片段',
    tags: [],
    ...overrides,
  }
}

function route(overrides: Partial<ProjectEnvRouteProposal> = {}): ProjectEnvRouteProposal {
  return {
    id: 'r1',
    title: '数据中台路线',
    summary: '围绕实时数仓构建的路线',
    tech_stack: ['Kafka 3.6', 'Flink 1.18'],
    scale: '日增 2 亿条日志',
    role: '数据平台负责人',
    highlights: ['Exactly-Once 投递'],
    period: { start: '2025.02', end: '2025.09' },
    ...overrides,
  }
}

function status(overrides: Partial<ProjectEnvMaterialsStatus> = {}): ProjectEnvMaterialsStatus {
  return {
    status: 'material_ready',
    job: null,
    progress: null,
    selection: null,
    materials: null,
    routes: null,
    ...overrides,
  }
}

// Mirrors the wizard: selection state is lifted above the step so tab and
// step switches never drop it.
function Harness({ onSubmitted = vi.fn(), onBack = vi.fn() }) {
  const [tab, setTab] = useState<MaterialTab>('materials')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  return (
    <MaterialSelectionStep
      envId="env:1"
      keywords={['MES', '高并发']}
      tab={tab}
      selectedIds={selectedIds}
      selectedRouteId={selectedRouteId}
      onTabChange={setTab}
      onSelectedIdsChange={setSelectedIds}
      onSelectedRouteChange={setSelectedRouteId}
      onSubmitted={onSubmitted}
      onBack={onBack}
      onClose={vi.fn()}
    />
  )
}

describe('MaterialSelectionStep', () => {
  let submitMutate: ReturnType<typeof vi.fn>
  let generateMutate: ReturnType<typeof vi.fn>
  let regenerateMutate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    submitMutate = vi.fn((_vars, options) => options?.onSuccess?.())
    generateMutate = vi.fn((_id, options) => options?.onSuccess?.())
    regenerateMutate = vi.fn((_id, options) => options?.onSuccess?.())
    mockMaterials.mockReturnValue({
      data: status(),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)
    mockGenerate.mockReturnValue({
      mutate: generateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateProjectEnvMaterials>)
    mockRegenerate.mockReturnValue({
      mutate: regenerateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRegenerateProjectEnv>)
    mockSubmit.mockReturnValue({
      mutate: submitMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useSubmitProjectEnvMaterials>)
  })

  it('renders generation progress with stage label, percent and message, no submit buttons', () => {
    mockMaterials.mockReturnValue({
      data: status({
        status: 'material_pending',
        progress: {
          stage: 'materialing',
          percent: 42,
          message: 'AI 生成素材候选中……',
          updated: new Date().toISOString(),
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    expect(screen.getByText('projectEnvs.stageMaterialing')).toBeDefined()
    expect(screen.getByText('42%')).toBeDefined()
    expect(screen.getByTestId('candidates-progress-message')).toHaveTextContent(
      'AI 生成素材候选中……'
    )
    expect(screen.queryByTestId('env-material-submit')).toBeNull()
    expect(screen.queryByTestId('env-route-submit')).toBeNull()
  })

  it('groups candidates by the six TEXT_FIELDS labels and sends unknown categories to fieldOther', () => {
    mockMaterials.mockReturnValue({
      data: status({
        materials: {
          items: [
            material({ id: 'm1', category: 'background' }),
            material({ id: 'm2', category: 'tech_background' }),
            material({ id: 'm3', category: 'tuning_process' }),
            material({ id: 'm4', category: 'problems_solutions' }),
            material({ id: 'm5', category: 'my_role' }),
            material({ id: 'm6', category: 'scale' }),
            material({ id: 'm7', category: 'not_a_field' }),
          ],
          generated_at: '2026-10-07T10:00:00Z',
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    for (const key of [
      'projectEnvs.fieldBackground',
      'projectEnvs.fieldTechBackground',
      'projectEnvs.fieldTuning',
      'projectEnvs.fieldProblems',
      'projectEnvs.fieldMyRole',
      'projectEnvs.fieldScale',
      'projectEnvs.fieldOther',
    ]) {
      expect(screen.getByText(key), key).toBeDefined()
    }
    expect(screen.getByTestId('material-card-m7')).toBeDefined()
  })

  it('failed without candidates shows the banner with the raw error and retry/skip actions', () => {
    mockMaterials.mockReturnValue({
      data: status({
        status: 'failed',
        progress: { stage: 'done', percent: 100, error: '生成超时，请重试' },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    expect(screen.getByTestId('candidates-failed-banner')).toHaveTextContent(
      'projectEnvs.materialGenerateFailed'
    )
    expect(screen.getByTestId('candidates-failed-banner')).toHaveTextContent('生成超时，请重试')

    fireEvent.click(screen.getByTestId('candidates-retry'))
    expect(generateMutate).toHaveBeenCalledWith('env:1')

    fireEvent.click(screen.getByText('projectEnvs.skipMaterials'))
    expect(regenerateMutate).toHaveBeenCalledWith('env:1', expect.anything())
  })

  it('ready-but-empty stores show materialEmptyAll with retry/skip', () => {
    mockMaterials.mockReturnValue({
      data: status({ status: 'material_ready', materials: null, routes: null }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    expect(screen.getByText('projectEnvs.materialEmptyAll')).toBeDefined()
    expect(screen.getByTestId('candidates-retry')).toBeDefined()
    expect(screen.getByTestId('candidates-skip')).toBeDefined()
  })

  it('an empty category renders materialGroupEmpty without blocking other groups', () => {
    mockMaterials.mockReturnValue({
      data: status({
        materials: { items: [material({ id: 'm1', category: 'background' })] },
        routes: { items: [route()] },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    expect(screen.getAllByText('projectEnvs.materialGroupEmpty').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('material-card-m1'))
    fireEvent.click(screen.getByTestId('env-material-submit'))

    expect(submitMutate).toHaveBeenCalledWith(
      { envId: 'env:1', data: { kind: 'materials', material_ids: ['m1'] } },
      expect.anything()
    )
  })

  it('select-all updates the count line and submits the checked payload, then notifies onSubmitted', () => {
    const onSubmitted = vi.fn()
    mockMaterials.mockReturnValue({
      data: status({
        materials: {
          items: [
            material({ id: 'm1', category: 'background' }),
            material({ id: 'm2', category: 'background' }),
            material({ id: 'm3', category: 'scale' }),
          ],
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness onSubmitted={onSubmitted} />)

    fireEvent.click(screen.getByTestId('material-toggle-all-background'))
    fireEvent.click(screen.getByTestId('env-material-submit'))

    expect(submitMutate).toHaveBeenCalledWith(
      {
        envId: 'env:1',
        data: { kind: 'materials', material_ids: ['m1', 'm2'] },
      },
      expect.anything()
    )
    expect(onSubmitted).toHaveBeenCalled()
  })

  it('switching to the routes tab submits the picked route id', () => {
    mockMaterials.mockReturnValue({
      data: status({
        materials: { items: [material()] },
        routes: { items: [route(), route({ id: 'r2', title: '离线路线' })] },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    // Radix TabsTrigger activates on mousedown, not click (repo precedent).
    fireEvent.mouseDown(screen.getByText('projectEnvs.tabRoutes'))
    fireEvent.click(screen.getByTestId('route-card-r2').querySelector('button')!)
    fireEvent.click(screen.getByTestId('env-route-submit'))

    expect(submitMutate).toHaveBeenCalledWith(
      { envId: 'env:1', data: { kind: 'routes', route_id: 'r2' } },
      expect.anything()
    )
  })

  it('keeps material selections while switching tabs', () => {
    mockMaterials.mockReturnValue({
      data: status({
        materials: {
          items: [material({ id: 'm1' }), material({ id: 'm2', category: 'scale' })],
        },
        routes: { items: [route()] },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    fireEvent.click(screen.getByTestId('material-card-m1'))
    fireEvent.click(screen.getByTestId('material-card-m2'))
    fireEvent.mouseDown(screen.getByText('projectEnvs.tabRoutes'))
    fireEvent.mouseDown(screen.getByText('projectEnvs.tabMaterials'))

    expect(screen.getByTestId('material-card-m1').className).toContain('bg-teal-tint/40')
    expect(screen.getByTestId('material-card-m2').className).toContain('bg-teal-tint/40')
  })

  it('shows the stale hint when progress has not advanced for over 180s', () => {
    mockMaterials.mockReturnValue({
      data: status({
        status: 'material_pending',
        progress: {
          stage: 'routing',
          percent: 60,
          updated: new Date(Date.now() - 200_000).toISOString(),
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)

    render(<Harness />)

    expect(screen.getByText('projectEnvs.stageRouting')).toBeDefined()
    expect(screen.getByText('projectEnvs.materialStaleHint')).toBeDefined()
  })

  function readyStore() {
    mockMaterials.mockReturnValue({
      data: status({
        materials: { items: [material()] },
        routes: { items: [route()] },
      }),
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectEnvMaterials>)
  }

  it('ready store offers regenerate-batch and skip; regenerating clears picks after confirm', () => {
    readyStore()
    render(<Harness />)

    expect(screen.getByTestId('candidates-regenerate-batch')).toBeDefined()
    expect(screen.getByTestId('candidates-skip-ready')).toBeDefined()

    fireEvent.click(screen.getByTestId('material-card-m1'))
    expect(screen.getByTestId('material-card-m1').className).toContain('bg-teal-tint/40')

    fireEvent.click(screen.getByTestId('candidates-regenerate-batch'))
    expect(screen.getByTestId('confirm-probe')).toHaveTextContent(
      'projectEnvs.materialRegenerateTitle'
    )
    fireEvent.click(screen.getByText('confirm'))

    expect(generateMutate).toHaveBeenCalledWith('env:1')
    expect(screen.getByTestId('material-card-m1').className).not.toContain('bg-teal-tint/40')
  })

  it('skip on the ready branch asks for confirmation, then regenerates directly', () => {
    readyStore()
    render(<Harness />)

    fireEvent.click(screen.getByTestId('candidates-skip-ready'))
    expect(screen.getByTestId('confirm-probe')).toHaveTextContent('projectEnvs.skipReadyTitle')
    fireEvent.click(screen.getByText('confirm'))

    expect(regenerateMutate).toHaveBeenCalledWith('env:1', expect.anything())
  })

  it('adopting a route while materials are picked asks to discard them first', () => {
    readyStore()
    render(<Harness />)

    fireEvent.click(screen.getByTestId('material-card-m1'))
    fireEvent.mouseDown(screen.getByText('projectEnvs.tabRoutes'))
    fireEvent.click(screen.getByTestId('route-card-r1').querySelector('button')!)
    fireEvent.click(screen.getByTestId('env-route-submit'))

    expect(screen.getByTestId('confirm-probe')).toHaveTextContent(
      'projectEnvs.crossTabRoutesTitle'
    )
    expect(submitMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('confirm'))
    expect(submitMutate).toHaveBeenCalledWith(
      { envId: 'env:1', data: { kind: 'routes', route_id: 'r1' } },
      expect.anything()
    )
  })

  it('submitting materials while a route is picked asks to discard it first', () => {
    readyStore()
    render(<Harness />)

    fireEvent.mouseDown(screen.getByText('projectEnvs.tabRoutes'))
    fireEvent.click(screen.getByTestId('route-card-r1').querySelector('button')!)
    fireEvent.mouseDown(screen.getByText('projectEnvs.tabMaterials'))
    fireEvent.click(screen.getByTestId('material-card-m1'))
    fireEvent.click(screen.getByTestId('env-material-submit'))

    expect(screen.getByTestId('confirm-probe')).toHaveTextContent(
      'projectEnvs.crossTabMaterialsTitle'
    )
    expect(submitMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('confirm'))
    expect(submitMutate).toHaveBeenCalledWith(
      { envId: 'env:1', data: { kind: 'materials', material_ids: ['m1'] } },
      expect.anything()
    )
  })
})

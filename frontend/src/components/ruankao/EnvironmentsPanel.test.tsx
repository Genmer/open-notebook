import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentsPanel } from './EnvironmentsPanel'

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvs: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCreateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  useMockGenerateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  usePolishBackground: () => ({ mutate: vi.fn(), isPending: false }),
  useProjectEnv: () => ({ data: undefined, isError: false }),
  useReverifyProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/components/project-envs/ProjectEnvList', () => ({
  ProjectEnvList: () => <div data-testid="project-env-list" />,
  ProjectEnvEmptyState: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" data-testid="env-create-button" onClick={onCreate} />
  ),
}))

vi.mock('@/components/project-envs/MaterialSelectionStep', () => ({
  MaterialSelectionStep: () => <div data-testid="material-step-stub" />,
}))

vi.mock('@/components/project-envs/VerificationPanel', () => ({
  VerificationPanel: () => <div data-testid="verification-stub" />,
}))

describe('EnvironmentsPanel wizardSeed channel', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('clicking an industry chip opens the mock wizard at step 2 with the value', () => {
    render(<EnvironmentsPanel />)

    fireEvent.click(screen.getByTestId('ruankao-industry-item-冷链物流'))

    // mock 模式第 2 步：行业输入已带值、关键词输入在场（无需先选模式）
    expect(screen.getByTestId('env-mock-industry')).toHaveValue('冷链物流')
    expect(
      screen.getByPlaceholderText('projectEnvs.mockKeywordsPlaceholder')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('env-mode-real')).not.toBeInTheDocument()
  })

  it('clears the seed when the wizard closes (one-shot semantics)', () => {
    render(<EnvironmentsPanel />)

    fireEvent.click(screen.getByTestId('ruankao-industry-item-冷链物流'))
    expect(screen.getByTestId('env-mock-industry')).toHaveValue('冷链物流')

    // Esc 关闭对话框（repo 先例）→ onOpenChange(false) → 种子清空
    fireEvent.keyDown(document, { key: 'Escape' })

    // 重新经「新建」打开：不再带种子，回到第 1 步模式选择
    // （页头与空态各有一枚 env-create-button，沿用原 testid，取页头第一枚）
    fireEvent.click(screen.getAllByTestId('env-create-button')[0])
    expect(screen.getByTestId('env-mode-real')).toBeInTheDocument()
    expect(screen.getByTestId('env-mode-mock')).toBeInTheDocument()
    expect(screen.queryByTestId('env-mock-industry')).not.toBeInTheDocument()
  })

  it('consumes the question-bank wizard seed on mount: wizard opens prefilled, seed burned', () => {
    // 题库 D② 一次性种子：keywords + name（无 industry）
    sessionStorage.setItem(
      'ruankao.wizardSeed.v1',
      JSON.stringify({
        keywords: ['微服务架构及其应用', '微服务与分布式'],
        name: '论微服务架构及其应用',
      }),
    )
    render(<EnvironmentsPanel />)

    // mock 第 2 步直接打开（模式选择不出现）
    expect(screen.queryByTestId('env-mode-real')).not.toBeInTheDocument()
    // keywords-only 种子不触碰 industry 受控输入：保持默认「物流行业」
    expect(screen.getByTestId('env-mock-industry')).toHaveValue('物流行业')
    // 名称与关键词预填
    expect(
      screen.getByLabelText('projectEnvs.mockNameLabel'),
    ).toHaveValue('论微服务架构及其应用')
    expect(screen.getByText('微服务架构及其应用')).toBeInTheDocument()
    expect(screen.getByText('微服务与分布式')).toBeInTheDocument()
    // 即焚：种子已消费
    expect(sessionStorage.getItem('ruankao.wizardSeed.v1')).toBeNull()
  })

  it('opens nothing extra when no wizard seed is pending', () => {
    render(<EnvironmentsPanel />)
    expect(screen.queryByTestId('env-mock-industry')).not.toBeInTheDocument()
    expect(
      screen.getAllByTestId('env-create-button').length,
    ).toBeGreaterThan(0)
  })
})


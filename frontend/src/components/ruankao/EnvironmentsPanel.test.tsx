import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentsPanel } from './EnvironmentsPanel'

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvs: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCreateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  useMockGenerateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  usePolishBackground: () => ({ mutate: vi.fn(), isPending: false }),
  useProjectEnv: () => ({ data: undefined, isError: false }),
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
})

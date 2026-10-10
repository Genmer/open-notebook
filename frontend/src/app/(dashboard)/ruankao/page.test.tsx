import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuankaoPage from './page'
import { RUANKAO_TABS } from '@/lib/ruankao/tabs'

let tabParam: string | null = null

vi.mock('next/navigation', () => ({
  usePathname: () => '/ruankao',
  useSearchParams: () => new URLSearchParams(tabParam ? `tab=${tabParam}` : ''),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/hooks/use-project-envs', () => ({
  useProjectEnvs: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCreateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  useMockGenerateProjectEnv: () => ({ mutate: vi.fn(), isPending: false }),
  usePolishBackground: () => ({ mutate: vi.fn(), isPending: false }),
  useProjectEnv: () => ({ data: undefined, isError: false }),
}))

function activeTab() {
  return screen
    .getAllByTestId(/^ruankao-tab-/)
    .find((el) => el.getAttribute('data-state') === 'active')
}

describe('RuankaoPage tab container', () => {
  beforeEach(() => {
    tabParam = null
  })

  it('keeps the registry as the single source of truth for tab order and ids', () => {
    expect(RUANKAO_TABS.map((tab) => tab.key)).toEqual([
      'environments',
      'questionBank',
      'modelLibrary',
      'essay',
      'hotTopics',
    ])
    expect(RUANKAO_TABS.map((tab) => tab.testid)).toEqual([
      'ruankao-tab-environments',
      'ruankao-tab-questionBank',
      'ruankao-tab-modelLibrary',
      'ruankao-tab-essay',
      'ruankao-tab-hotTopics',
    ])
  })

  it('lands on the environments tab by default with the migrated page body', () => {
    render(<RuankaoPage />)

    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-environments')
    // 原样平移：标题/新建按钮（页头+空态各一枚，沿用原 testid）/行业池小节
    expect(screen.getAllByTestId('env-create-button').length).toBeGreaterThan(0)
    expect(screen.getByTestId('ruankao-industry-search')).toBeInTheDocument()
  })

  it('honours a valid ?tab= deep link as the initial tab only', () => {
    tabParam = 'hotTopics'
    render(<RuankaoPage />)

    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-hotTopics')
    expect(screen.getByText('ruankao.hotTopics.plannedTitle')).toBeInTheDocument()
  })

  it('falls back to the first tab on an invalid ?tab=', () => {
    tabParam = 'not-a-tab'
    render(<RuankaoPage />)

    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-environments')
  })

  it('hides null-slot tabs (undelivered segments) and falls back for their keys', () => {
    tabParam = 'questionBank'
    render(<RuankaoPage />)

    expect(screen.queryByTestId('ruankao-tab-questionBank')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ruankao-tab-modelLibrary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ruankao-tab-essay')).not.toBeInTheDocument()
    // null 槽 key 的深链同样回落第一项，避免落在空内容区
    expect(activeTab()?.getAttribute('data-testid')).toBe('ruankao-tab-environments')
  })

  it('switches tabs in place without unmounting the page shell', () => {
    render(<RuankaoPage />)

    // Radix TabsTrigger activates on mousedown, not click (repo precedent)
    fireEvent.mouseDown(screen.getByTestId('ruankao-tab-hotTopics'))

    // 同页切换：模块标题仍在，热度榜空态出现，未激活 tab 的内容卸载
    expect(screen.getByText('ruankao.title')).toBeInTheDocument()
    expect(screen.getByText('ruankao.hotTopics.plannedTitle')).toBeInTheDocument()
    expect(screen.queryByTestId('env-create-button')).not.toBeInTheDocument()
  })
})

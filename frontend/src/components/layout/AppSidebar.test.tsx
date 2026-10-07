/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { usePathname } from 'next/navigation'
import { AppSidebar } from './AppSidebar'
import { useSidebarStore } from '@/lib/stores/sidebar-store'

// Mock Tooltip components to avoid Radix UI async issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('AppSidebar', () => {
  afterEach(() => {
    vi.mocked(usePathname).mockReturnValue('')
  })

  it('highlights only Models (not Settings) on the Models page', () => {
    vi.mocked(usePathname).mockReturnValue('/settings/models')

    const { container } = render(<AppSidebar />)

    const modelsButton = container.querySelector('a[href="/settings/models"] button')
    const settingsButton = container.querySelector('a[href="/settings"] button')

    expect(modelsButton?.className).toContain('font-semibold')
    expect(settingsButton?.className).toContain('font-medium')
    expect(settingsButton?.className).not.toContain('font-semibold')
  })

  it('renders correctly when expanded', () => {
    render(<AppSidebar />)

    // With mocked t() returning keys, check for translation key strings
    expect(screen.getByText('common.appName')).toBeDefined()
    expect(screen.getByText('navigation.sources')).toBeDefined()
    expect(screen.getByText('navigation.notebooks')).toBeDefined()
  })

  it('carries the exam-essay hint as the project-environments link title when expanded', () => {
    const { container } = render(<AppSidebar />)

    const link = container.querySelector('a[href="/project-environments"]')
    expect(link?.getAttribute('title')).toBe('navigation.projectEnvironmentsHint')
    // entries without a hint keep no title attribute
    expect(container.querySelector('a[href="/sources"]')?.getAttribute('title')).toBeNull()
  })

  it('uses consistent spacing for expanded footer actions', () => {
    render(<AppSidebar />)

    const themeButton = screen.getByText('common.theme').closest('button')
    const languageButton = screen.getByText('common.language').closest('button')
    const signOutButton = screen.getByRole('button', { name: 'common.signOut' })

    expect(themeButton?.className.split(/\s+/)).toContain('px-3')

    for (const button of [themeButton, languageButton, signOutButton]) {
      expect(button?.className.split(/\s+/)).toContain('gap-2')
    }

    expect(themeButton?.querySelector(':scope > span.relative.size-4')).not.toBeNull()
    expect(signOutButton.className.split(/\s+/)).not.toContain('gap-3')
  })

  it('toggles collapse state when clicking handle', () => {
    const toggleCollapse = vi.fn()
    vi.mocked(useSidebarStore).mockReturnValue({
      isCollapsed: false,
      toggleCollapse,
    } as any)

    render(<AppSidebar />)

    fireEvent.click(screen.getByTestId('sidebar-toggle'))

    expect(toggleCollapse).toHaveBeenCalled()
  })

  it('shows collapsed view when isCollapsed is true', () => {
    vi.mocked(useSidebarStore).mockReturnValue({
      isCollapsed: true,
      toggleCollapse: vi.fn(),
    } as any)

    render(<AppSidebar />)

    // In collapsed mode, app name shouldn't be visible (as text)
    expect(screen.queryByText('common.appName')).toBeNull()
  })

  it('includes the exam-essay hint in the collapsed project-environments tooltip', () => {
    vi.mocked(useSidebarStore).mockReturnValue({
      isCollapsed: true,
      toggleCollapse: vi.fn(),
    } as any)

    render(<AppSidebar />)

    // TooltipContent is mocked to render its children inline, so the hint
    // line shows up next to the entry name without a real hover.
    expect(screen.getByText('navigation.projectEnvironmentsHint')).toBeDefined()
  })
})

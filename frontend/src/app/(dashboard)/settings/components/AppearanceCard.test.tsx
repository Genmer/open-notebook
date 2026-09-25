import { render, screen, fireEvent } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, beforeEach } from 'vitest'

import { AppearanceCard } from './AppearanceCard'
import { useThemeStore } from '@/lib/stores/theme-store'

// useTranslation is mocked globally in setup.ts (t returns the key string),
// so option labels render as their literal key names below.

describe('AppearanceCard', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-skin')
    useThemeStore.setState({ theme: 'system', skin: 'quiet-green' })
  })

  it('renders both skin options', () => {
    render(<AppearanceCard />)

    expect(screen.getByText('settings.skin')).toBeInTheDocument()
    expect(screen.getByText('settings.skinQuietGreen')).toBeInTheDocument()
    expect(screen.getByText('settings.skinClassic')).toBeInTheDocument()
    expect(screen.getByText('settings.skinQuietGreenDesc')).toBeInTheDocument()
    expect(screen.getByText('settings.skinClassicDesc')).toBeInTheDocument()
  })

  it('renders no checked radio in server markup (hydration-safe)', () => {
    // renderToString runs no effects, so mounted stays false like in SSR
    const html = renderToString(<AppearanceCard />)

    expect(html).toContain('settings.skin')
    expect(html).not.toContain('aria-checked="true"')
  })

  it('checks the option matching a classic store', () => {
    useThemeStore.setState({ skin: 'classic' })
    render(<AppearanceCard />)

    const classic = screen.getByRole('radio', { name: /settings\.skinClassic/ })
    const quietGreen = screen.getByRole('radio', { name: /settings\.skinQuietGreen/ })
    expect(classic.getAttribute('aria-checked')).toBe('true')
    expect(quietGreen.getAttribute('aria-checked')).toBe('false')
  })

  it('applies the skin immediately on click', () => {
    render(<AppearanceCard />)

    fireEvent.click(screen.getByRole('radio', { name: /settings\.skinClassic/ }))

    expect(useThemeStore.getState().skin).toBe('classic')
    expect(document.documentElement.getAttribute('data-skin')).toBe('classic')
  })
})

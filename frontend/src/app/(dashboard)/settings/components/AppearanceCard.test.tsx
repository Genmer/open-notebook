import { render, screen, fireEvent } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, beforeEach } from 'vitest'

import { AppearanceCard } from './AppearanceCard'
import { useThemeStore } from '@/lib/stores/theme-store'
import { useNotebookViewStore } from '@/lib/stores/notebook-view-store'

// useTranslation is mocked globally in setup.ts (t returns the key string),
// so option labels render as their literal key names below.

describe('AppearanceCard', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-skin')
    useThemeStore.setState({ theme: 'system', skin: 'quiet-green' })
    useNotebookViewStore.setState({ detailStyle: 'open_notebook' })
  })

  it('renders both skin options', () => {
    render(<AppearanceCard />)

    expect(screen.getByText('settings.skin')).toBeInTheDocument()
    expect(screen.getByText('settings.skinQuietGreen')).toBeInTheDocument()
    expect(screen.getByText('settings.skinClassic')).toBeInTheDocument()
    expect(screen.getByText('settings.skinQuietGreenDesc')).toBeInTheDocument()
    expect(screen.getByText('settings.skinClassicDesc')).toBeInTheDocument()
  })

  it('renders notebook detail style options', () => {
    render(<AppearanceCard />)

    expect(screen.getByText('settings.notebookDetailStyle')).toBeInTheDocument()
    expect(screen.getByText('settings.styleOpenNotebook')).toBeInTheDocument()
    expect(screen.getByText('settings.styleGeminiNotebook')).toBeInTheDocument()
    expect(screen.getByText('settings.styleOpenNotebookDesc')).toBeInTheDocument()
    expect(screen.getByText('settings.styleGeminiNotebookDesc')).toBeInTheDocument()
  })

  it('renders no checked radio in server markup (hydration-safe)', () => {
    // renderToString runs no effects, so mounted stays false like in SSR
    const html = renderToString(<AppearanceCard />)

    expect(html).toContain('settings.skin')
    expect(html).toContain('settings.notebookDetailStyle')
    expect(html).not.toContain('aria-checked="true"')
  })

  it('checks the option matching a classic store', () => {
    useThemeStore.setState({ skin: 'classic' })
    useNotebookViewStore.setState({ detailStyle: 'gemini_notebook' })
    render(<AppearanceCard />)

    const classic = screen.getByRole('radio', { name: /settings\.skinClassic/ })
    const quietGreen = screen.getByRole('radio', { name: /settings\.skinQuietGreen/ })
    expect(classic.getAttribute('aria-checked')).toBe('true')
    expect(quietGreen.getAttribute('aria-checked')).toBe('false')

    const gemini = screen.getByRole('radio', { name: /settings\.styleGeminiNotebook/ })
    const openNotebook = screen.getByRole('radio', { name: /settings\.styleOpenNotebook/ })
    expect(gemini.getAttribute('aria-checked')).toBe('true')
    expect(openNotebook.getAttribute('aria-checked')).toBe('false')
  })

  it('applies the skin immediately on click', () => {
    render(<AppearanceCard />)

    fireEvent.click(screen.getByRole('radio', { name: /settings\.skinClassic/ }))

    expect(useThemeStore.getState().skin).toBe('classic')
    expect(document.documentElement.getAttribute('data-skin')).toBe('classic')
  })

  it('switches notebook detail style immediately on click', () => {
    render(<AppearanceCard />)

    fireEvent.click(screen.getByRole('radio', { name: /settings\.styleGeminiNotebook/ }))

    expect(useNotebookViewStore.getState().detailStyle).toBe('gemini_notebook')
  })
})

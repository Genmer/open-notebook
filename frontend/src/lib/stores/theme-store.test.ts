import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useThemeStore, parseSkin } from './theme-store'

describe('theme-store skin', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-skin')
    useThemeStore.setState({ theme: 'system', skin: 'quiet-green', hasHydrated: true })
  })

  it('defaults skin to quiet-green and hasHydrated to false', async () => {
    vi.resetModules()
    localStorage.removeItem('theme-storage')
    const { useThemeStore: fresh } = await import('./theme-store')

    // Sync localStorage rehydrates during module evaluation, so the initial
    // values are only observable via the creation-time snapshot.
    expect(fresh.getInitialState().skin).toBe('quiet-green')
    expect(fresh.getInitialState().hasHydrated).toBe(false)
    expect(fresh.getState().skin).toBe('quiet-green')
  })

  it('setSkin updates state and writes the document attribute', () => {
    useThemeStore.getState().setSkin('classic')

    expect(useThemeStore.getState().skin).toBe('classic')
    expect(document.documentElement.getAttribute('data-skin')).toBe('classic')
  })

  it('rehydrates a garbage persisted skin back to quiet-green', async () => {
    vi.resetModules()
    localStorage.setItem(
      'theme-storage',
      JSON.stringify({ state: { theme: 'dark', skin: 'blue' }, version: 0 })
    )
    const { useThemeStore: fresh } = await import('./theme-store')

    expect(fresh.getState().skin).toBe('quiet-green')
    expect(fresh.getState().theme).toBe('dark')
  })

  it('persists exactly theme and skin', () => {
    useThemeStore.setState({ theme: 'dark', skin: 'classic' })
    const options = useThemeStore.persist.getOptions()
    const persisted = options.partialize?.(useThemeStore.getState())

    expect(persisted).toEqual({ theme: 'dark', skin: 'classic' })
  })
})

describe('parseSkin', () => {
  it('passes valid skins through', () => {
    expect(parseSkin('quiet-green')).toBe('quiet-green')
    expect(parseSkin('classic')).toBe('classic')
  })

  it('falls back to quiet-green for anything else', () => {
    expect(parseSkin('blue')).toBe('quiet-green')
    expect(parseSkin(undefined)).toBe('quiet-green')
    expect(parseSkin(null)).toBe('quiet-green')
    expect(parseSkin(42)).toBe('quiet-green')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { themeScript } from './theme-script'

// The script is an IIFE string injected into <head>; evaluate it like a browser
function runScript() {
  new Function(themeScript)()
}

describe('themeScript skin', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-skin')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('light', 'dark')
  })

  it('applies a persisted valid skin', () => {
    localStorage.setItem(
      'theme-storage',
      JSON.stringify({ state: { theme: 'light', skin: 'classic' }, version: 0 })
    )

    expect(() => runScript()).not.toThrow()
    expect(document.documentElement.getAttribute('data-skin')).toBe('classic')
  })

  it('falls back to quiet-green when the skin is missing', () => {
    localStorage.setItem(
      'theme-storage',
      JSON.stringify({ state: { theme: 'light' }, version: 0 })
    )

    runScript()

    expect(document.documentElement.getAttribute('data-skin')).toBe('quiet-green')
  })

  it('falls back to quiet-green on corrupted JSON without throwing', () => {
    localStorage.setItem('theme-storage', '{not json')

    expect(() => runScript()).not.toThrow()
    expect(document.documentElement.getAttribute('data-skin')).toBe('quiet-green')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })
})

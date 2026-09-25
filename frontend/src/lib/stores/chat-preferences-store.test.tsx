import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatPreferencesStore } from './chat-preferences-store'

describe('chat-preferences-store', () => {
  beforeEach(() => {
    localStorage.clear()
    useChatPreferencesStore.setState({ enterToSend: false })
  })

  it('defaults enterToSend to false', async () => {
    vi.resetModules()
    localStorage.removeItem('chat-preferences-storage')
    const { useChatPreferencesStore: fresh } = await import('./chat-preferences-store')

    // Sync localStorage rehydrates during module evaluation, so the initial
    // values are only observable via the creation-time snapshot.
    expect(fresh.getInitialState().enterToSend).toBe(false)
    expect(fresh.getState().enterToSend).toBe(false)
    expect(fresh.getInitialState().hasHydrated).toBe(false)
  })

  it('setEnterToSend updates state and persists to localStorage', () => {
    useChatPreferencesStore.getState().setEnterToSend(true)

    expect(useChatPreferencesStore.getState().enterToSend).toBe(true)
    const persisted = JSON.parse(localStorage.getItem('chat-preferences-storage') ?? '{}')
    expect(persisted.state.enterToSend).toBe(true)
  })

  it('persists exactly enterToSend', () => {
    useChatPreferencesStore.setState({ enterToSend: true })
    const options = useChatPreferencesStore.persist.getOptions()
    const persisted = options.partialize?.(useChatPreferencesStore.getState())

    expect(persisted).toEqual({ enterToSend: true })
  })

  it('rehydrates a persisted true value and marks hydration done', async () => {
    vi.resetModules()
    localStorage.setItem(
      'chat-preferences-storage',
      JSON.stringify({ state: { enterToSend: true }, version: 0 })
    )
    const { useChatPreferencesStore: fresh } = await import('./chat-preferences-store')

    expect(fresh.getState().enterToSend).toBe(true)
    expect(fresh.getState().hasHydrated).toBe(true)
  })
})

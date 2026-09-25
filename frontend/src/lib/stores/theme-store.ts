import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type Skin = 'quiet-green' | 'classic'

export const SKINS: readonly Skin[] = ['quiet-green', 'classic']

export function parseSkin(value: unknown): Skin {
  return SKINS.includes(value as Skin) ? (value as Skin) : 'quiet-green'
}

interface ThemeState {
  theme: Theme
  skin: Skin
  hasHydrated: boolean
  setTheme: (theme: Theme) => void
  setSkin: (skin: Skin) => void
  setHasHydrated: (state: boolean) => void
  getSystemTheme: () => 'light' | 'dark'
  getEffectiveTheme: () => 'light' | 'dark'
}

const themeStorage = createJSONStorage<Pick<ThemeState, 'theme' | 'skin'>>(() => localStorage)

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      skin: 'quiet-green',
      hasHydrated: !themeStorage,

      setHasHydrated: (state: boolean) => {
        set({ hasHydrated: state })
      },

      setTheme: (theme: Theme) => {
        set({ theme })

        // Apply theme to document immediately
        if (typeof window !== 'undefined') {
          const root = window.document.documentElement
          const effectiveTheme = theme === 'system' ? get().getSystemTheme() : theme

          root.classList.remove('light', 'dark')
          root.classList.add(effectiveTheme)
          root.setAttribute('data-theme', effectiveTheme)
        }
      },

      setSkin: (skin: Skin) => {
        set({ skin })

        if (typeof window !== 'undefined') {
          window.document.documentElement.setAttribute('data-skin', skin)
        }
      },
      
      getSystemTheme: () => {
        if (typeof window !== 'undefined') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        }
        return 'light'
      },
      
      getEffectiveTheme: () => {
        const { theme } = get()
        return theme === 'system' ? get().getSystemTheme() : theme
      }
    }),
    {
      name: 'theme-storage',
      storage: themeStorage,
      partialize: (state) => ({ theme: state.theme, skin: state.skin }),
      // Persisted payloads from older versions (or tampered localStorage) may
      // carry an unknown skin; validate instead of trusting the stored value.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ThemeState>
        return { ...current, ...saved, skin: parseSkin(saved.skin) }
      },
      onRehydrateStorage: (state) => () => {
        state.setHasHydrated(true)
      }
    }
  )
)

// Hook for components to use theme
export function useTheme() {
  const { theme, hasHydrated, setTheme, getEffectiveTheme } = useThemeStore()
  
  return {
    theme,
    hasHydrated,
    setTheme,
    effectiveTheme: getEffectiveTheme(),
    isDark: getEffectiveTheme() === 'dark'
  }
}

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface ChatPreferencesState {
  enterToSend: boolean
  hasHydrated: boolean
  setEnterToSend: (value: boolean) => void
  setHasHydrated: (state: boolean) => void
}

const chatPreferencesStorage = createJSONStorage<Pick<ChatPreferencesState, 'enterToSend'>>(
  () => localStorage
)

export const useChatPreferencesStore = create<ChatPreferencesState>()(
  persist(
    (set) => ({
      enterToSend: false,
      // SSR 上 localStorage 不存在、无从 rehydrate，视为已就绪；客户端初始
      // false，等 onRehydrateStorage 完成后再翻 true（防首帧 hydration mismatch）。
      hasHydrated: !chatPreferencesStorage,
      setEnterToSend: (value: boolean) => {
        set({ enterToSend: value })
      },
      setHasHydrated: (state: boolean) => {
        set({ hasHydrated: state })
      }
    }),
    {
      name: 'chat-preferences-storage',
      storage: chatPreferencesStorage,
      partialize: (state) => ({ enterToSend: state.enterToSend }),
      onRehydrateStorage: (state) => () => {
        state.setHasHydrated(true)
      }
    }
  )
)

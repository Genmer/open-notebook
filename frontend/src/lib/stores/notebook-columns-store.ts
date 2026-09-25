import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotebookColumnsState {
  foldersCollapsed: boolean
  sourcesCollapsed: boolean
  notesCollapsed: boolean
  toggleFolders: () => void
  toggleSources: () => void
  toggleNotes: () => void
  setFolders: (collapsed: boolean) => void
  setSources: (collapsed: boolean) => void
  setNotes: (collapsed: boolean) => void
}

export const useNotebookColumnsStore = create<NotebookColumnsState>()(
  persist(
    (set) => ({
      foldersCollapsed: false,
      sourcesCollapsed: false,
      notesCollapsed: false,
      toggleFolders: () => set((state) => ({ foldersCollapsed: !state.foldersCollapsed })),
      toggleSources: () => set((state) => ({ sourcesCollapsed: !state.sourcesCollapsed })),
      toggleNotes: () => set((state) => ({ notesCollapsed: !state.notesCollapsed })),
      setFolders: (collapsed) => set({ foldersCollapsed: collapsed }),
      setSources: (collapsed) => set({ sourcesCollapsed: collapsed }),
      setNotes: (collapsed) => set({ notesCollapsed: collapsed }),
    }),
    {
      name: 'notebook-columns-storage',
    }
  )
)

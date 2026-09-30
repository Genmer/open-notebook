import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type NotebookViewMode = 'tile' | 'list'
export type NotebookDetailStyle = 'open_notebook' | 'gemini_notebook'

interface NotebookViewState {
  viewMode: NotebookViewMode
  setViewMode: (mode: NotebookViewMode) => void
  detailStyle: NotebookDetailStyle
  setDetailStyle: (style: NotebookDetailStyle) => void
}

export const useNotebookViewStore = create<NotebookViewState>()(
  persist(
    (set) => ({
      viewMode: 'tile',
      setViewMode: (mode) => set({ viewMode: mode }),
      detailStyle: 'open_notebook',
      setDetailStyle: (style) => set({ detailStyle: style }),
    }),
    {
      name: 'notebook-view-storage',
    }
  )
)

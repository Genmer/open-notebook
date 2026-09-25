import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { SourceGroupResponse, SourceViewResponse } from '@/lib/types/api'

// Virtual tab id for the built-in "by file type" browsing mode (not a real view).
export const FILE_TYPE_VIEW_ID = 'file_type'

// 'all' | 'ungrouped' | a group id — or a source type / file extension (link/text/pdf…) under the file_type tab.
export type GroupSelection = 'all' | 'ungrouped' | string

const FILE_TYPE_FIXED_SELECTIONS: GroupSelection[] = ['all', 'link', 'text']
// Extension buckets come from the API, so validity is shape-based; 'file' is
// the pre-extension "File" group whose persisted selections must fall back.
const FILE_TYPE_EXT_PATTERN = /^[a-z0-9]{1,10}$/

interface SourceViewState {
  activeViewId: string
  selectedGroupByView: Record<string, GroupSelection>
  hasHydrated: boolean
  setActiveView: (viewId: string) => void
  setSelectedGroup: (viewId: string, group: GroupSelection) => void
  setHasHydrated: (state: boolean) => void
}

const sourceViewStorage = createJSONStorage<
  Pick<SourceViewState, 'activeViewId' | 'selectedGroupByView'>
>(() => localStorage)

// Stored ids can outlive their view/group (deleted elsewhere); fall back to
// 'all' instead of showing an empty list forever.
export function resolveActiveViewId(stored: string, views: SourceViewResponse[]): string {
  if (stored === FILE_TYPE_VIEW_ID || views.some((v) => v.id === stored)) {
    return stored
  }
  return FILE_TYPE_VIEW_ID
}

export function resolveGroupSelection(
  stored: GroupSelection | undefined,
  activeViewId: string,
  groups: SourceGroupResponse[]
): GroupSelection {
  if (!stored) return 'all'
  if (activeViewId === FILE_TYPE_VIEW_ID) {
    if (FILE_TYPE_FIXED_SELECTIONS.includes(stored)) return stored
    // 'file' is legacy; 'ungrouped' belongs to groupable views only
    return stored !== 'file' && stored !== 'ungrouped' && FILE_TYPE_EXT_PATTERN.test(stored)
      ? stored
      : 'all'
  }
  if (stored === 'all' || stored === 'ungrouped') return stored
  return groups.some((g) => g.id === stored) ? stored : 'all'
}

export const useSourceViewStore = create<SourceViewState>()(
  persist(
    (set) => ({
      activeViewId: FILE_TYPE_VIEW_ID,
      selectedGroupByView: {},
      hasHydrated: !sourceViewStorage,

      setActiveView: (viewId: string) => {
        set({ activeViewId: viewId })
      },

      setSelectedGroup: (viewId: string, group: GroupSelection) => {
        set((state) => ({
          selectedGroupByView: { ...state.selectedGroupByView, [viewId]: group },
        }))
      },

      setHasHydrated: (state: boolean) => {
        set({ hasHydrated: state })
      },
    }),
    {
      name: 'source-view-storage',
      storage: sourceViewStorage,
      partialize: (state) => ({
        activeViewId: state.activeViewId,
        selectedGroupByView: state.selectedGroupByView,
      }),
      onRehydrateStorage: (state) => () => {
        state.setHasHydrated(true)
      },
    }
  )
)

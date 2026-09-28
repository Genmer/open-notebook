import { useQuery } from '@tanstack/react-query'
import { notebooksApi } from '@/lib/api/notebooks'
import { useSourceViews } from '@/lib/hooks/use-source-views'

// Folder tree + every notebook source for the chat context picker. Fetched
// lazily when the picker opens (enabled flag) — the data is only needed for
// the dialog, never for the page itself.
//
// When no folder view is actively browsed the page has no viewId; fall back
// to the notebook's grouping view (custom first, then default, then first)
// so the picker renders the same folder tree as the sidebar.
export function useContextTree(
  notebookId: string,
  viewId: string | null | undefined,
  enabled: boolean,
) {
  const { data: views } = useSourceViews()
  const resolvedViewId =
    viewId ??
    (views?.find(v => v.view_type === 'custom') ??
      views?.find(v => v.is_default) ??
      views?.[0])?.id
  return useQuery({
    queryKey: ['contextTree', notebookId, resolvedViewId ?? null],
    queryFn: () => notebooksApi.contextTree(notebookId, resolvedViewId ?? undefined),
    enabled: enabled && !!notebookId,
    staleTime: 60 * 1000,
  })
}

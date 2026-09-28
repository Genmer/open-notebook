import { useQuery } from '@tanstack/react-query'
import { contextPrefsApi } from '@/lib/api/notebooks'
import { QUERY_KEYS } from '@/lib/api/query-client'

// Saved per-source chat-context preferences for one folder scope, keyed by
// (notebook, folder). A null folderId addresses the ungrouped bucket (the
// request omits folder_id). Only enabled while a concrete folder/bucket is
// browsed — the unscoped "all" view keeps its implicit defaults.
export function useContextPreferences(
  notebookId: string,
  folderId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: QUERY_KEYS.contextPreferences(notebookId, folderId),
    queryFn: () => contextPrefsApi.get(notebookId, folderId),
    enabled: enabled && !!notebookId,
    staleTime: 30 * 1000,
  })
}

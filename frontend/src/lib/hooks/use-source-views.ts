import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sourceViewsApi } from '@/lib/api/source-views'
import { sourcesApi } from '@/lib/api/sources'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { ClassifyProgress, SourceViewResponse } from '@/lib/types/api'

const CLASSIFY_POLL_MS = 5000

const ACTIVE_CLASSIFY_STAGES: ClassifyProgress['stage'][] = [
  'clustering',
  'llm',
  'assigning',
]

export function isClassifyActive(progress: ClassifyProgress | null): boolean {
  return !!progress && ACTIVE_CLASSIFY_STAGES.includes(progress.stage)
}

// Poll the views list every 5s while any view is mid-classification.
export function classifyPollInterval(
  views: SourceViewResponse[] | undefined
): number | false {
  return views?.some((view) => isClassifyActive(view.classify_progress))
    ? CLASSIFY_POLL_MS
    : false
}

// Grouping mutations invalidate the whole ['source-views'] prefix so view and
// group caches (incl. source_count badges) refresh together with ['sources'].
export function useInvalidateGrouping() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourceViews })
    queryClient.invalidateQueries({ queryKey: ['sources'] })
  }
}

function useGroupingErrorToast() {
  const { toast } = useToast()
  const { t } = useTranslation()
  return (error: unknown) => {
    toast({
      title: t('common.error'),
      description: getApiErrorMessage(error, (key) => t(key), t('sources.grouping.operationFailed')),
      variant: 'destructive',
    })
  }
}

export function useSourceViews() {
  return useQuery({
    queryKey: QUERY_KEYS.sourceViews,
    queryFn: sourceViewsApi.listViews,
    staleTime: 30 * 1000,
    refetchInterval: (query) =>
      classifyPollInterval(query.state.data as SourceViewResponse[] | undefined),
  })
}

export function useClassifyView() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  const { toast } = useToast()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (viewId: string) => sourceViewsApi.classifyView(viewId),
    onSuccess: () => {
      toast({ title: t('sources.grouping.classify.startedToast') })
      invalidate()
    },
    onError,
  })
}

// Fires the result/error toast and refreshes group + source caches when a
// classification run reaches its terminal stage (polling delivers the change).
export function useClassifyProgressWatcher(views: SourceViewResponse[] | undefined) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()
  const prevStages = useRef<Map<string, ClassifyProgress['stage'] | 'idle'>>(new Map())

  useEffect(() => {
    if (!views) return
    views.forEach((view) => {
      const stage = view.classify_progress?.stage ?? 'idle'
      const prev = prevStages.current.get(view.id) ?? 'idle'
      prevStages.current.set(view.id, stage)
      if (prev === stage || !ACTIVE_CLASSIFY_STAGES.includes(prev as ClassifyProgress['stage'])) {
        return
      }
      if (stage === 'done') {
        const progress = view.classify_progress
        toast({
          title: t('sources.grouping.classify.doneSummary', {
            groups: progress?.groups_created ?? 0,
            sources: progress?.sources_classified ?? 0,
            unclassified: progress?.unclassified ?? 0,
          }),
        })
        queryClient.invalidateQueries({ queryKey: ['sources'] })
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourceViewGroups(view.id) })
      } else if (stage === 'failed') {
        toast({
          title: t('sources.grouping.classify.failed'),
          description: view.classify_progress?.error || undefined,
          variant: 'destructive',
        })
      }
    })
  }, [views, queryClient, toast, t])
}

export function useViewGroups(viewId?: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.sourceViewGroups(viewId ?? 'none'),
    queryFn: () => sourceViewsApi.listGroups(viewId as string),
    enabled: !!viewId,
    staleTime: 30 * 1000,
  })
}

// Per-extension buckets for the virtual file_type tab; the ['sources'] prefix
// match keeps counts fresh whenever source/grouping mutations invalidate it.
export function useSourceTypeGroups(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.sourceTypeGroups,
    queryFn: sourcesApi.typeGroups,
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useCreateView() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: (name: string) => sourceViewsApi.createView(name),
    onSuccess: invalidate,
    onError,
  })
}

export function useUpdateView() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      sourceViewsApi.updateView(id, name),
    onSuccess: invalidate,
    onError,
  })
}

export function useDeleteView() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: (id: string) => sourceViewsApi.deleteView(id),
    onSuccess: invalidate,
    onError,
  })
}

export function useCreateGroup() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: ({ viewId, name, parentId }: { viewId: string; name: string; parentId?: string | null }) =>
      sourceViewsApi.createGroup(viewId, name, parentId),
    onSuccess: invalidate,
    onError,
  })
}

export function useUpdateGroup() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: ({ id, name, parentId }: { id: string; name?: string; parentId?: string | null }) =>
      sourceViewsApi.updateGroup(id, { name, parent_id: parentId }),
    onSuccess: invalidate,
    onError,
  })
}

export function useDeleteGroup() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: ({ id, deleteSources }: { id: string; deleteSources: boolean }) =>
      sourceViewsApi.deleteGroup(id, deleteSources),
    onSuccess: invalidate,
    onError,
  })
}

export function useMoveToGroup() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: ({ groupId, sourceIds }: { groupId: string; sourceIds: string[] }) =>
      sourceViewsApi.moveMembers(groupId, sourceIds),
    onSuccess: invalidate,
    onError,
  })
}

export function useUngroupMembers() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: ({ viewId, sourceIds }: { viewId: string; sourceIds: string[] }) =>
      sourceViewsApi.ungroupMembers(viewId, sourceIds),
    onSuccess: invalidate,
    onError,
  })
}

export function useCopyToGroup() {
  const invalidate = useInvalidateGrouping()
  const onError = useGroupingErrorToast()
  return useMutation({
    mutationFn: ({ groupId, sourceIds }: { groupId: string; sourceIds: string[] }) =>
      sourceViewsApi.copyMembers(groupId, sourceIds),
    onSuccess: invalidate,
    onError,
  })
}

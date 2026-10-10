import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { essayMarksApi } from '@/lib/api/ruankao-essay-marks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import type {
  EssayMarkTargetType,
  EssayMarksLibraryResponse,
  EssayMarkToggleRequest,
} from '@/lib/types/api'

// 乐观补丁只翻转按钮态（marked_direct / group.marked）与两项计数；
// 生效集合大小（effective_total）依赖服务端子树计算，交给成功后的 refetch 修正
export function applyOptimisticToggle(
  library: EssayMarksLibraryResponse,
  targetType: EssayMarkTargetType,
  targetId: string
): EssayMarksLibraryResponse {
  if (targetType === 'source') {
    const source = library.sources.find((s) => s.id === targetId)
    if (!source) return library
    const nextMarked = !source.marked_direct
    return {
      ...library,
      sources: library.sources.map((s) =>
        s.id === targetId ? { ...s, marked_direct: nextMarked } : s
      ),
      stats: {
        ...library.stats,
        marked_sources: library.stats.marked_sources + (nextMarked ? 1 : -1),
      },
    }
  }

  const group = library.groups.find((g) => g.id === targetId)
  if (!group) return library
  const nextMarked = !group.marked
  return {
    ...library,
    groups: library.groups.map((g) =>
      g.id === targetId ? { ...g, marked: nextMarked } : g
    ),
    stats: {
      ...library.stats,
      marked_groups: library.stats.marked_groups + (nextMarked ? 1 : -1),
    },
  }
}

function useInvalidateEssayMarks() {
  const queryClient = useQueryClient()
  // 标记不按视图隔离（生效集合全局），所以所有视图的 library 缓存一起失效
  return () => queryClient.invalidateQueries({ queryKey: ['ruankao-essay-marks'] })
}

export function useEssayMarksLibrary(viewId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.essayMarksLibrary(viewId),
    queryFn: () => essayMarksApi.library(viewId),
  })
}

// 单按钮幂等 toggle：乐观切换，失败回滚 + toast（mark.md 2.2 操作流）
export function useToggleEssayMark() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (data: EssayMarkToggleRequest) => essayMarksApi.toggle(data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['ruankao-essay-marks'] })
      const snapshots = queryClient.getQueriesData<EssayMarksLibraryResponse>({
        queryKey: ['ruankao-essay-marks'],
      })
      for (const [key] of snapshots) {
        queryClient.setQueryData<EssayMarksLibraryResponse>(key, (previous) =>
          previous ? applyOptimisticToggle(previous, data.target_type, data.target_id) : previous
        )
      }
      return { snapshots }
    },
    onError: (error: unknown, _data, context) => {
      context?.snapshots.forEach(([key, value]) => {
        queryClient.setQueryData(key, value)
      })
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('ruankao.essayMark.toggleFailed'))
    },
    onSettled: () => {
      // 成功/失败都以服务端为准刷新一次：统计 K、经文件夹生效徽标、悬空回报
      queryClient.invalidateQueries({ queryKey: ['ruankao-essay-marks'] })
    },
  })
}

// 悬空引用手动清理（事件级联之外的双保险入口）
export function useCleanupDanglingMarks() {
  const invalidate = useInvalidateEssayMarks()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: () => essayMarksApi.cleanupDangling(),
    onSuccess: (response) => {
      invalidate()
      toast.success(t('ruankao.essayMark.danglingCleaned', { count: response.removed }))
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('ruankao.essayMark.danglingCleanupFailed'))
    },
  })
}

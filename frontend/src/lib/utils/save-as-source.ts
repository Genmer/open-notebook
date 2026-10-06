import { toast } from 'sonner'
import type { QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { sourceViewsApi } from '@/lib/api/source-views'
import type { FolderTargetValue } from '@/components/sources/FolderTargetSection'

// createSource 只取 helper 用到的切片，避免与 useCreateSource 的完整返回类型耦合
// （SaveAsSourceDialog / SaveNoteDialog 都直接传 hook 返回值）。
interface CreateTextSourceMutation {
  mutateAsync: (payload: {
    type: 'text'
    title: string
    content: string
    notebooks: string[]
    embed: false
    async_processing: true
  }) => Promise<{ id: string }>
}

interface CreateTextSourceWithFilingArgs {
  createSource: CreateTextSourceMutation
  queryClient: QueryClient
  invalidateGrouping: () => void
  t: TFunction
  notebookId: string
  title: string
  content: string
  folderTarget: FolderTargetValue | null
}

/**
 * 把一段文本内容创建为 text 来源并可选归档进文件夹（SaveAsSourceDialog 与
 * SaveNoteDialog「存为来源」模式共用的提交序列）。
 *
 * - embed:false + async_processing:true 是硬约束：绝不排队嵌入（用户额度受限），
 *   全仓库只允许在这里出现这一次。
 * - 来源创建失败时异常原样向上抛，由调用方决定是否保持弹窗打开。
 * - 归档失败只警告不回滚（AddSourceDialog 先例）：来源已创建成功，仅跳过分组缓存失效。
 */
export async function createTextSourceWithFiling({
  createSource,
  queryClient,
  invalidateGrouping,
  t,
  notebookId,
  title,
  content,
  folderTarget,
}: CreateTextSourceWithFilingArgs): Promise<{ id: string }> {
  const created = await createSource.mutateAsync({
    type: 'text',
    title,
    content,
    notebooks: [notebookId],
    embed: false,
    async_processing: true,
  })

  let movedAny = false
  if (folderTarget) {
    try {
      await sourceViewsApi.moveMembers(folderTarget.groupId, [created.id])
      movedAny = true
    } catch (error) {
      // 来源已创建成功，归档失败只警告不回滚（AddSourceDialog 先例）
      console.error('Failed to file source into folder:', error)
      toast.warning(t('sources.grouping.folderAssignFailed', { count: 1 }))
    }
  }

  if (movedAny) invalidateGrouping()
  // Gemini 左列来源树走独立的 contextTree 缓存，前缀失效一并刷新
  queryClient.invalidateQueries({ queryKey: ['contextTree'] })

  return created
}

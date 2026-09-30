import { useCallback, useState } from 'react'
import { explainApi, type ExplainResponse } from '@/lib/api/explain'
import { useTranslation } from '@/lib/hooks/use-translation'

// useMutation is intentionally avoided here: its observer silently drops the
// success notification when mutate() is fired from a mount effect under
// StrictMode (verified in-browser — onSettled fires, the card never re-renders
// off the skeleton). Plain state cannot lose that update.
export function useExplain(resourceId: string) {
  const { language } = useTranslation()
  const [data, setData] = useState<ExplainResponse | null>(null)
  const [isError, setIsError] = useState(false)
  const [isPending, setIsPending] = useState(false)

  const mutate = useCallback(
    async ({ refresh = false }: { refresh?: boolean } = {}) => {
      setIsError(false)
      setIsPending(true)
      try {
        const response = await explainApi.explain({
          resource_type: 'failed_command',
          resource_id: resourceId,
          question: null,
          history: [],
          locale: language,
          refresh,
        })
        setData(response)
      } catch {
        setIsError(true)
      } finally {
        setIsPending(false)
      }
    },
    [resourceId, language],
  )

  return { data, isError, isPending, mutate }
}

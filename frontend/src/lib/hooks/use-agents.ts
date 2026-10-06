import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '@/lib/api/agents'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import {
  CreateAgentRequest,
  UpdateAgentRequest,
} from '@/lib/types/agents'

export function useAgents(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QUERY_KEYS.agents,
    queryFn: () => agentsApi.list(),
    enabled: options?.enabled ?? true,
  })
}

function useInvalidateAgents() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.agents })
}

export function useCreateAgent() {
  const invalidate = useInvalidateAgents()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: CreateAgentRequest) => agentsApi.create(data),
    onSuccess: () => {
      invalidate()
      toast({
        title: t('common.success'),
        description: t('agents.createSuccess'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useUpdateAgent() {
  const invalidate = useInvalidateAgents()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAgentRequest }) =>
      agentsApi.update(id, data),
    onSuccess: () => {
      invalidate()
      toast({
        title: t('common.success'),
        description: t('agents.updateSuccess'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteAgent() {
  const invalidate = useInvalidateAgents()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => agentsApi.delete(id),
    onSuccess: () => {
      invalidate()
      toast({
        title: t('common.success'),
        description: t('agents.deleteSuccess'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { projectEnvsApi, ProjectEnvView } from '@/lib/api/project-envs'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import {
  CreateProjectEnvRequest,
  MaterialsSubmitRequest,
  MockGenerateRequest,
  PolishBackgroundRequest,
  RewriteClaimRequest,
  UpdateProjectEnvRequest,
} from '@/lib/types/api'

function useInvalidateProjectEnvs() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['project-envs'] })
}

export function useProjectEnvs(view: ProjectEnvView = 'manage') {
  return useQuery({
    queryKey: QUERY_KEYS.projectEnvs(view),
    queryFn: () => projectEnvsApi.list(view),
    // Rows flip pending -> verified/needs_review server-side; poll only
    // while at least one verification or materials generation is running.
    refetchInterval: (query) =>
      query.state.data?.some(
        (env) => env.status === 'pending' || env.status === 'material_pending'
      )
        ? 5000
        : false,
  })
}

export function useProjectEnv(id: string | null | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.projectEnv(id ?? ''),
    queryFn: () => projectEnvsApi.get(id as string),
    enabled: !!id,
  })
}

export function useProjectEnvVerification(id: string | null | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.projectEnvVerification(id ?? ''),
    queryFn: () => projectEnvsApi.getVerification(id as string),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 3000 : false,
  })
}

export function useProjectEnvMaterials(id: string | null | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.projectEnvMaterials(id ?? ''),
    queryFn: () => projectEnvsApi.getMaterials(id as string),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.status === 'material_pending' ? 3000 : false,
  })
}

export function useCreateProjectEnv() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (data: CreateProjectEnvRequest) => projectEnvsApi.create(data),
    onSuccess: () => {
      invalidate()
      toast.success(t('projectEnvs.toastCreated'))
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)), {
        description: t('projectEnvs.toastCreateFailed'),
      })
    },
  })
}

export function useUpdateProjectEnv() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProjectEnvRequest }) =>
      projectEnvsApi.update(id, data),
    onSuccess: () => {
      invalidate()
      toast.success(t('projectEnvs.toastUpdated'))
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)), {
        description: t('projectEnvs.toastUpdateFailed'),
      })
    },
  })
}

export function useDeleteProjectEnv() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (id: string) => projectEnvsApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('projectEnvs.toastDeleted'))
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)), {
        description: t('projectEnvs.toastDeleteFailed'),
      })
    },
  })
}

// Full rebuild of an existing env under a " (copy)" name (decision ①).
export function useDuplicateProjectEnv() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (data: CreateProjectEnvRequest) => projectEnvsApi.create(data),
    onSuccess: () => {
      invalidate()
      toast.success(t('projectEnvs.toastCopied'))
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)), {
        description: t('projectEnvs.toastCopyFailed'),
      })
    },
  })
}

export function useMockGenerateProjectEnv() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (data: MockGenerateRequest) => projectEnvsApi.mockGenerate(data),
    onSuccess: () => {
      invalidate()
    },
    onError: (error: unknown) => {
      // 422 knowledge_base_empty carries structured guidance text
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.mockGenerateFailed'))
    },
  })
}

export function usePolishBackground() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (data: PolishBackgroundRequest) =>
      projectEnvsApi.polishBackground(data),
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.polishFailed'))
    },
  })
}

export function useReverifyProjectEnv() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (id: string) => projectEnvsApi.reverify(id),
    onSuccess: () => {
      invalidate()
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.reverifyFailed'))
    },
  })
}

// Mock envs only: discard the draft and rebuild everything from the keywords.
export function useRegenerateProjectEnv() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (id: string) => projectEnvsApi.regenerate(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('projectEnvs.regenerateStarted'))
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.regenerateFailed'))
    },
  })
}

// Mock envs only: (re)run the materials/routes candidate generation job.
export function useGenerateProjectEnvMaterials() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (id: string) => projectEnvsApi.generateMaterials(id),
    onSuccess: () => {
      invalidate()
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.materialGenerateFailed'))
    },
  })
}

// Submit the user's material/route selection; the env moves to pending and
// the drafting+verification pipeline takes over.
export function useSubmitProjectEnvMaterials() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ envId, data }: { envId: string; data: MaterialsSubmitRequest }) =>
      projectEnvsApi.submitMaterials(envId, data),
    onSuccess: () => {
      invalidate()
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.materialSubmitFailed'))
    },
  })
}

export function useDismissClaim() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ envId, pointId }: { envId: string; pointId: string }) =>
      projectEnvsApi.dismissClaim(envId, pointId),
    onSuccess: () => {
      invalidate()
      toast.success(t('projectEnvs.claimDismissed'))
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.claimDismissFailed'))
    },
  })
}

export function useRewriteClaim() {
  const invalidate = useInvalidateProjectEnvs()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({
      envId,
      pointId,
      data,
    }: {
      envId: string
      pointId: string
      data: RewriteClaimRequest
    }) => projectEnvsApi.rewriteClaim(envId, pointId, data),
    onSuccess: () => {
      invalidate()
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, (k) => t(k)) || t('projectEnvs.claimRewriteFailed'))
    },
  })
}

// Stateless AI suggestion; the caller renders loading/failed states, so this
// hook deliberately has no toasts of its own.
export function useSuggestClaimRewrite() {
  return useMutation({
    mutationFn: ({ envId, pointId }: { envId: string; pointId: string }) =>
      projectEnvsApi.suggestClaimRewrite(envId, pointId),
  })
}

export function useGenerateGenericParagraph() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (envId: string) =>
      projectEnvsApi.generateGenericParagraph(envId),
    onError: (error: unknown) => {
      toast.error(
        getApiErrorMessage(error, (k) => t(k)) ||
          t('projectEnvs.genericParagraphGenerateFailed')
      )
    },
  })
}

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useProjectEnvs } from '@/lib/hooks/use-project-envs'
import {
  ProjectEnvEmptyState,
  ProjectEnvList,
} from '@/components/project-envs/ProjectEnvList'
import { CreateEnvWizard } from '@/components/project-envs/CreateEnvWizard'
import { EnvDetailDialog } from '@/components/project-envs/EnvDetailDialog'
import { IndustryPoolPanel } from '@/components/ruankao/IndustryPoolPanel'

// wizardSeed 通道：外部带值打开向导的一次性种子（先例供后续段复用）
export interface EnvironmentsWizardSeed {
  industry: string
}

// 原 /project-environments 页面主体原样平移（data-testid 全部不动），
// 追加行业池小节（R2/C1：行业池是本 tab 内小节，不设独立 tab）
export function EnvironmentsPanel() {
  const { t } = useTranslation()
  const { data: envs, isLoading, refetch } = useProjectEnvs('manage')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardEnvId, setWizardEnvId] = useState<string | null>(null)
  const [wizardSeed, setWizardSeed] = useState<EnvironmentsWizardSeed | null>(null)
  // 存 id 而非对象：保存/处置后列表刷新时弹窗数据跟着走，避免 stale snapshot
  const [detailEnvId, setDetailEnvId] = useState<string | null>(null)
  const detailEnv = envs?.find((env) => env.id === detailEnvId) ?? null

  const openVerification = (envId: string) => {
    setWizardEnvId(envId)
    setWizardOpen(true)
  }

  const pickIndustry = (industry: string) => {
    setWizardEnvId(null)
    setWizardSeed({ industry })
    setWizardOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {t('projectEnvs.title')}
          </h2>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setWizardEnvId(null)
            setWizardOpen(true)
          }}
          data-testid="env-create-button"
        >
          <Plus className="h-4 w-4" />
          {t('projectEnvs.create')}
        </Button>
      </div>

      <div className="max-w-5xl">
        <p className="mb-1 text-xs text-muted-foreground">{t('projectEnvs.ruankaoNote')}</p>
        <p className="text-muted-foreground flex items-center gap-2">
          {t('projectEnvs.desc')}
        </p>
      </div>

      {envs && envs.length > 0 ? (
        <ProjectEnvList
          envs={envs}
          isLoading={isLoading}
          onOpenVerification={openVerification}
          onOpenDetail={(env) => setDetailEnvId(env.id)}
        />
      ) : (
        <ProjectEnvEmptyState
          onCreate={() => {
            setWizardEnvId(null)
            setWizardOpen(true)
          }}
        />
      )}

      <IndustryPoolPanel onPickIndustry={pickIndustry} />

      <CreateEnvWizard
        open={wizardOpen}
        onOpenChange={(next) => {
          setWizardOpen(next)
          // 关闭向导即清空种子（一次性语义，不留状态）
          if (!next) setWizardSeed(null)
        }}
        initialEnvId={wizardEnvId}
        preset={wizardSeed}
      />

      <EnvDetailDialog
        env={detailEnv}
        open={!!detailEnv}
        onOpenChange={(next) => {
          if (!next) setDetailEnvId(null)
        }}
      />
    </div>
  )
}

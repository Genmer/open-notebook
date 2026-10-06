'use client'

import { useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
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
import type { ProjectEnv } from '@/lib/types/api'

export default function ProjectEnvironmentsPage() {
  const { t } = useTranslation()
  const { data: envs, isLoading, refetch } = useProjectEnvs('manage')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardEnvId, setWizardEnvId] = useState<string | null>(null)
  const [detailEnv, setDetailEnv] = useState<ProjectEnv | null>(null)

  const openVerification = (envId: string) => {
    setWizardEnvId(envId)
    setWizardOpen(true)
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {t('projectEnvs.title')}
              </h1>
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
            <p className="text-muted-foreground flex items-center gap-2">
              {t('projectEnvs.desc')}
            </p>
          </div>

          {envs && envs.length > 0 ? (
            <ProjectEnvList
              envs={envs}
              isLoading={isLoading}
              onOpenVerification={openVerification}
              onOpenDetail={setDetailEnv}
            />
          ) : (
            <ProjectEnvEmptyState
              onCreate={() => {
                setWizardEnvId(null)
                setWizardOpen(true)
              }}
            />
          )}

          <CreateEnvWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            initialEnvId={wizardEnvId}
          />

          <EnvDetailDialog
            env={detailEnv}
            open={!!detailEnv}
            onOpenChange={(next) => {
              if (!next) setDetailEnv(null)
            }}
          />
        </div>
      </div>
    </AppShell>
  )
}

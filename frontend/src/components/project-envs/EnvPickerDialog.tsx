'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Building2, Check } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useProjectEnvs } from '@/lib/hooks/use-project-envs'

interface EnvPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Currently bound env id (only verified rows are selectable, decision ⑤).
  selectedEnvId?: string | null
  onSelect: (envId: string | null) => void
}

export function EnvPickerDialog({ open, onOpenChange, selectedEnvId, onSelect }: EnvPickerDialogProps) {
  const { t } = useTranslation()
  const { data: envs, isLoading } = useProjectEnvs('selectable')

  const handleSelect = (envId: string | null) => {
    onSelect(envId)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {t('projectEnvs.pickerTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <LoadingSpinner className="mr-2" />
              {t('common.loading')}
            </div>
          ) : !envs?.length ? (
            <EmptyState
              icon={Building2}
              title={t('projectEnvs.pickerEmpty')}
              description=""
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false)
                    window.open('/project-environments', '_blank')
                  }}
                >
                  {t('projectEnvs.pickerEmptyAction')}
                </Button>
              }
            />
          ) : (
            envs.map((env) => {
              const selectable = env.status === 'verified'
              return (
                <button
                  key={env.id}
                  type="button"
                  disabled={!selectable}
                  onClick={() => handleSelect(env.id)}
                  className={
                    'flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm transition-colors ' +
                    (selectable ? 'hover:border-teal/60' : 'cursor-not-allowed opacity-60')
                  }
                  data-testid={`env-picker-row-${env.id}`}
                >
                  <span className="min-w-0 flex-1 truncate">{env.name}</span>
                  {selectedEnvId === env.id ? (
                    <Check className="h-4 w-4 shrink-0 text-fern" />
                  ) : !selectable ? (
                    <Badge variant="outline" className="shrink-0 border-warn/50 text-warn">
                      {t('projectEnvs.statusNeedsReview', { count: env.pending_claims_count })}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 border-fern/40 text-fern">
                      {t('projectEnvs.statusVerified')}
                    </Badge>
                  )}
                </button>
              )
            })
          )}
          {selectedEnvId && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => handleSelect(null)}>
              {t('common.remove')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Building2, Plus, X } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useProjectEnv } from '@/lib/hooks/use-project-envs'
import { isNotFoundError } from '@/lib/utils/error-handler'
import { EnvPickerDialog } from '@/components/project-envs/EnvPickerDialog'

interface ChatProjectEnvProps {
  // Current binding (session's project_env, or the pending one pre-session)
  envId: string | null
  onBind: (env: string | null) => void
  // Creates a fresh session bound to the env (switch-dialog second option)
  onNewSessionWithEnv?: (env: string) => void
  disabled?: boolean
}

export function ChatProjectEnv({
  envId,
  onBind,
  onNewSessionWithEnv,
  disabled,
}: ChatProjectEnvProps) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const { data: env, error } = useProjectEnv(envId)
  const prevEnvRef = useRef<string | null>(envId)

  const dangling = !!envId && isNotFoundError(error)
  // pending + old snapshot: injection falls back to the previous verified
  // version, so the chip flags it as stale.
  const stale = env?.status === 'pending' && env.has_snapshot
  // The injected badge only shows when the backend gate actually injects
  // (verified, or pending with an old snapshot). needs_review/failed/pending
  // without a snapshot inject nothing.
  const injecting = env?.status === 'verified' || stale

  // First-bind boundary statement (decision: only null -> non-null).
  useEffect(() => {
    if (!prevEnvRef.current && envId) {
      toast.info(t('projectEnvs.bindToastTitle'), {
        description: t('projectEnvs.bindToastDesc'),
      })
    }
    prevEnvRef.current = envId
  }, [envId, t])

  const handleSelect = (next: string | null) => {
    if (next && envId && next !== envId) {
      setSwitchTarget(next)
      return
    }
    onBind(next)
  }

  return (
    <div className="border-t px-4 py-2">
      <TooltipProvider delayDuration={200}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            disabled={disabled}
            onClick={() => setPickerOpen(true)}
            data-testid="chat-env-add"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('projectEnvs.addEnv')}
          </Button>

          {envId && !dangling && env && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn('max-w-[220px] gap-1 font-normal', stale && 'border-warn/50')}
                >
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{env.name}</span>
                  {stale && (
                    <span className="text-warn">{t('projectEnvs.staleChip')}</span>
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top">{env.name}</TooltipContent>
            </Tooltip>
          )}
          {envId && !dangling && env && injecting && (
            <Badge variant="secondary" className="gap-1 font-normal">
              {t('projectEnvs.injectBadge')}
            </Badge>
          )}

          {dangling && !bannerDismissed && (
            <div
              className="flex w-full items-center justify-between gap-2 rounded-md border border-warn/50 bg-warn-tint/50 px-2 py-1.5"
              data-testid="chat-env-dangling"
            >
              <div className="min-w-0">
                <p className="font-medium text-warn">{t('projectEnvs.danglingTitle')}</p>
                <p className="text-muted-foreground">{t('projectEnvs.danglingDesc')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onBind(null)}
                >
                  {t('projectEnvs.danglingClear')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={t('common.cancel')}
                  onClick={() => setBannerDismissed(true)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </TooltipProvider>

      <EnvPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedEnvId={envId}
        onSelect={handleSelect}
      />

      <Dialog open={!!switchTarget} onOpenChange={(open) => !open && setSwitchTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('projectEnvs.switchTitle')}</DialogTitle>
            <DialogDescription>{t('projectEnvs.switchDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setSwitchTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="outline"
              disabled={!onNewSessionWithEnv}
              onClick={() => {
                onNewSessionWithEnv?.(switchTarget as string)
                setSwitchTarget(null)
              }}
            >
              {t('projectEnvs.switchNew')}
            </Button>
            <Button
              onClick={() => {
                onBind(switchTarget)
                setSwitchTarget(null)
              }}
            >
              {t('projectEnvs.switchKeep')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

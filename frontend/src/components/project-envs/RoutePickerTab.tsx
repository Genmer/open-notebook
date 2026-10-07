'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { ProjectEnvRouteProposal } from '@/lib/types/api'

// Static literals so the locale unused-key scanner sees the three diff axes.
const ROUTE_DIFF_LABEL_KEYS = [
  'projectEnvs.routeDiffTech',
  'projectEnvs.routeDiffScale',
  'projectEnvs.routeDiffRole',
] as const

function routeDiffValue(
  route: ProjectEnvRouteProposal,
  key: (typeof ROUTE_DIFF_LABEL_KEYS)[number]
): string {
  switch (key) {
    case 'projectEnvs.routeDiffTech':
      return route.tech_stack.join(' / ')
    case 'projectEnvs.routeDiffScale':
      return route.scale
    default:
      return route.role
  }
}

interface RouteCardProps {
  route: ProjectEnvRouteProposal
  checked: boolean
}

function RouteCard({ route, checked }: RouteCardProps) {
  const { t } = useTranslation()
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    // The radio + title row is the label target; the preview collapsible
    // stays outside the <label> so opening it must not change the selection.
    <div
      data-testid={`route-card-${route.id}`}
      className={cn(
        'rounded-lg border bg-card p-3 transition-colors',
        checked ? 'border-fern/60 bg-fern-tint/40' : 'hover:border-fern/40'
      )}
    >
      <label
        htmlFor={`route-radio-${route.id}`}
        className="flex cursor-pointer items-center gap-2"
      >
        <RadioGroupItem id={`route-radio-${route.id}`} value={route.id} />
        <span className="min-w-0 text-sm font-medium break-all">{route.title}</span>
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {ROUTE_DIFF_LABEL_KEYS.map((key) => (
          <Badge
            key={key}
            variant="outline"
            className="max-w-full truncate text-[10px] font-normal"
            title={routeDiffValue(route, key)}
          >
            {t(key)}: {routeDiffValue(route, key)}
          </Badge>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{route.summary}</p>

      <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
        <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-xs text-teal hover:underline">
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', !previewOpen && '-rotate-90')}
          />
          {t('projectEnvs.routePreview')}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1.5 space-y-1.5 rounded-md bg-muted/60 p-2 text-xs">
            <div>
              <p className="font-medium text-muted-foreground">
                {t('projectEnvs.routeDiffTech')}
              </p>
              <p className="break-all">{route.tech_stack.join(' / ')}</p>
            </div>
            {route.highlights.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4">
                {route.highlights.map((highlight) => (
                  <li key={highlight} className="break-all">
                    {highlight}
                  </li>
                ))}
              </ul>
            )}
            {(route.period?.start || route.period?.end) && (
              <p className="text-muted-foreground">
                {route.period?.start} – {route.period?.end}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

interface RoutePickerTabProps {
  routes: ProjectEnvRouteProposal[]
  selectedRouteId: string | null
  onSelectedRouteChange: (id: string | null) => void
  onSubmit: () => void
  submitting?: boolean
}

export function RoutePickerTab({
  routes,
  selectedRouteId,
  onSelectedRouteChange,
  onSubmit,
  submitting,
}: RoutePickerTabProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <RadioGroup
        value={selectedRouteId ?? ''}
        onValueChange={(value) => onSelectedRouteChange(value || null)}
        className="gap-2"
      >
        {routes.map((route) => (
          <RouteCard key={route.id} route={route} checked={route.id === selectedRouteId} />
        ))}
      </RadioGroup>

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 border-t bg-card px-1 pt-3">
        <span className="min-w-0 text-xs text-warn">
          {!selectedRouteId && t('projectEnvs.routeMinHint')}
        </span>
        <Button
          size="sm"
          disabled={!selectedRouteId || submitting}
          onClick={onSubmit}
          data-testid="env-route-submit"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('projectEnvs.routeSubmit')}
        </Button>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { ProjectEnvMaterialItem } from '@/lib/types/api'

// Grouping follows the fixed TEXT_FIELDS order, not the order the LLM
// happened to return; anything else falls into the "other" bucket.
const FIELD_ORDER = [
  'background',
  'tech_background',
  'tuning_process',
  'problems_solutions',
  'my_role',
  'scale',
] as const

function fieldLabel(field: string, t: (k: string) => string): string {
  switch (field) {
    case 'background': return t('projectEnvs.fieldBackground')
    case 'tech_background': return t('projectEnvs.fieldTechBackground')
    case 'tuning_process': return t('projectEnvs.fieldTuning')
    case 'problems_solutions': return t('projectEnvs.fieldProblems')
    case 'my_role': return t('projectEnvs.fieldMyRole')
    case 'scale': return t('projectEnvs.fieldScale')
    default: return t('projectEnvs.fieldOther')
  }
}

interface MaterialGroupProps {
  field: string
  label: string
  items: ProjectEnvMaterialItem[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  // Receives the group's current "all selected" state; the parent flips it.
  onToggleAll: (allSelected: boolean) => void
}

function MaterialGroup({ field, label, items, selectedIds, onToggle, onToggleAll }: MaterialGroupProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const selectedCount = items.filter((item) => selectedIds.has(item.id)).length
  const allSelected = items.length > 0 && selectedCount === items.length

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium outline-none">
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform',
              !open && '-rotate-90'
            )}
          />
          <span>{label}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {selectedCount}/{items.length}
          </span>
        </CollapsibleTrigger>
        {items.length > 0 && (
          <button
            type="button"
            data-testid={`material-toggle-all-${field}`}
            className="text-xs text-teal hover:underline"
            onClick={() => onToggleAll(allSelected)}
          >
            {allSelected
              ? t('projectEnvs.materialDeselectAll')
              : t('projectEnvs.materialSelectAll')}
          </button>
        )}
      </div>
      <CollapsibleContent>
        {items.length ? (
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {items.map((item) => {
              const checked = selectedIds.has(item.id)
              return (
                // Whole card is the checkbox target (label htmlFor); no
                // nested interactive elements besides the checkbox itself.
                <label
                  key={item.id}
                  htmlFor={`material-check-${item.id}`}
                  data-testid={`material-card-${item.id}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border bg-card p-2.5 transition-colors hover:border-teal/60',
                    checked && 'border-teal/60 bg-teal-tint/40'
                  )}
                >
                  <Checkbox
                    id={`material-check-${item.id}`}
                    checked={checked}
                    onCheckedChange={() => onToggle(item.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="mt-0.5 block line-clamp-3 text-xs text-muted-foreground">
                      {item.text}
                    </span>
                    {!!item.tags?.length && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px] font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="mt-1.5 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            {t('projectEnvs.materialGroupEmpty')}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

interface MaterialPickerTabProps {
  items: ProjectEnvMaterialItem[]
  selectedIds: Set<string>
  onSelectedIdsChange: (ids: Set<string>) => void
  onSubmit: () => void
  submitting?: boolean
}

export function MaterialPickerTab({
  items,
  selectedIds,
  onSelectedIdsChange,
  onSubmit,
  submitting,
}: MaterialPickerTabProps) {
  const { t } = useTranslation()

  const groups: { field: string; label: string; items: ProjectEnvMaterialItem[] }[] =
    FIELD_ORDER.map((field) => ({
      field,
      label: fieldLabel(field, t),
      items: items.filter((item) => item.category === field),
    }))
  const otherItems = items.filter(
    (item) => !FIELD_ORDER.includes(item.category as (typeof FIELD_ORDER)[number])
  )
  if (otherItems.length) {
    groups.push({ field: 'other', label: fieldLabel('other', t), items: otherItems })
  }

  const selectedCount = items.filter((item) => selectedIds.has(item.id)).length

  const toggle = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedIdsChange(next)
  }

  const toggleGroup = (groupItems: ProjectEnvMaterialItem[], select: boolean) => {
    const next = new Set(selectedIds)
    for (const item of groupItems) {
      if (select) next.add(item.id)
      else next.delete(item.id)
    }
    onSelectedIdsChange(next)
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <MaterialGroup
          key={group.field}
          field={group.field}
          label={group.label}
          items={group.items}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={(allSelected) => toggleGroup(group.items, !allSelected)}
        />
      ))}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 border-t bg-card px-1 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          {t('projectEnvs.materialSelectedCount', { count: selectedCount })}
          {selectedCount === 0 && (
            <span className="ml-1 text-warn">{t('projectEnvs.materialMinHint')}</span>
          )}
        </span>
        <Button
          size="sm"
          disabled={selectedCount === 0 || submitting}
          onClick={onSubmit}
          data-testid="env-material-submit"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('projectEnvs.materialSubmit')}
        </Button>
      </div>
    </div>
  )
}

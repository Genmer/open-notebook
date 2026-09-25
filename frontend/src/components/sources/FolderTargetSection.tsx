'use client'

import { useEffect, useMemo, useState } from 'react'
import { Folder } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useSourceViews, useViewGroups } from '@/lib/hooks/use-source-views'
import { FILE_TYPE_VIEW_ID } from '@/lib/stores/source-view-store'
import { flattenGroupTree } from '@/lib/utils/group-tree'
import { displayViewName } from '@/lib/utils/view-display'
import { useTranslation } from '@/lib/hooks/use-translation'

export interface FolderTargetValue {
  viewId: string
  groupId: string
}

interface FolderTargetSectionProps {
  value: FolderTargetValue | null
  onChange: (value: FolderTargetValue | null) => void
  /** View highlighted on first open (the sources page passes its active view). */
  defaultViewId?: string
  collapsible?: boolean
}

// AddSourceDialog section: pick view -> folder for newly created sources.
// The file_type tab is a virtual view with no folders, so it is not listed.
export function FolderTargetSection({
  value,
  onChange,
  defaultViewId,
  collapsible = false,
}: FolderTargetSectionProps) {
  const { t } = useTranslation()
  const { data: views } = useSourceViews()
  const groupableViews = useMemo(
    () => (views ?? []).filter((v) => v.id !== FILE_TYPE_VIEW_ID),
    [views]
  )
  const [browseViewId, setBrowseViewId] = useState('')
  const [isExpanded, setIsExpanded] = useState(!collapsible)

  const resolvedViewId =
    browseViewId ||
    value?.viewId ||
    (defaultViewId && defaultViewId !== FILE_TYPE_VIEW_ID ? defaultViewId : '') ||
    groupableViews[0]?.id ||
    ''

  const { data: groups } = useViewGroups(resolvedViewId || null)
  const flat = useMemo(() => flattenGroupTree(groups ?? []), [groups])
  const selectedView = groupableViews.find((v) => v.id === resolvedViewId)
  const isAiView = !!selectedView && (selectedView.is_default || selectedView.view_type.startsWith('ai_'))

  // Browsed folder can be deleted elsewhere while the dialog is open: drop the
  // stale pick instead of filing into nothing. Checked against the flat tree so
  // nested folders count; groups===undefined means still loading, not empty.
  useEffect(() => {
    if (!groups) return
    if (value?.groupId && !flat.some((node) => node.group.id === value.groupId)) {
      onChange(null)
    }
  }, [groups, flat, value, onChange])

  if (collapsible && !isExpanded) {
    const barLabel = value
      ? [
          flat.find((node) => node.group.id === value.groupId)?.group.name,
          groupableViews.find((v) => v.id === value.viewId)
            ? displayViewName(groupableViews.find((v) => v.id === value.viewId)!, t)
            : undefined,
        ]
          .filter(Boolean)
          .join(' · ') || t('sources.grouping.noFolderOption')
      : t('sources.grouping.noFolderOption')

    return (
      <div className="flex items-center gap-2 rounded-md border p-3 text-sm" data-testid="folder-target-bar">
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-muted-foreground">
          {t('sources.grouping.targetFolderLabel')}
        </span>
        <span className="min-w-0 flex-1 truncate" data-testid="folder-target-bar-label">
          {barLabel}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="folder-target-change-button"
          onClick={() => setIsExpanded(true)}
        >
          {t('sources.grouping.selectFolder')}
        </Button>
      </div>
    )
  }

  return (
    <section className="space-y-3 rounded-md border p-4" data-testid="folder-target-section">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t('sources.grouping.saveToFolder')}</h3>
        {collapsible && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="folder-target-done-button"
            onClick={() => setIsExpanded(false)}
          >
            {t('common.done')}
          </Button>
        )}
      </div>

      <Select
        value={resolvedViewId}
        onValueChange={(viewId) => {
          setBrowseViewId(viewId)
          if (value && value.viewId !== viewId) onChange(null)
        }}
      >
        <SelectTrigger data-testid="folder-target-view-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groupableViews.map((view) => (
            <SelectItem key={view.id} value={view.id}>
              {displayViewName(view, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isAiView && (
        <p className="text-xs text-muted-foreground" data-testid="folder-target-ai-hint">
          {t('sources.grouping.aiOverwriteHint')}
        </p>
      )}

      <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-2">
        <FolderOption
          label={t('sources.grouping.noFolderOption')}
          depth={1}
          checked={value === null}
          onSelect={() => onChange(null)}
        />
        {flat.map((node) => (
          <FolderOption
            key={node.group.id}
            label={node.group.name}
            depth={node.depth}
            count={node.group.source_count}
            checked={!!value && value.viewId === resolvedViewId && value.groupId === node.group.id}
            onSelect={() => onChange({ viewId: resolvedViewId, groupId: node.group.id })}
          />
        ))}
        {flat.length === 0 && (
          <p className="px-2 py-1 text-sm text-muted-foreground">{t('sources.grouping.noGroups')}</p>
        )}
      </div>
    </section>
  )
}

function FolderOption({
  label,
  depth,
  count,
  checked,
  onSelect,
}: {
  label: string
  depth: number
  count?: number
  checked: boolean
  onSelect: () => void
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <input
        type="radio"
        className="h-3.5 w-3.5 shrink-0 accent-primary"
        checked={checked}
        onChange={onSelect}
      />
      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
      )}
    </label>
  )
}

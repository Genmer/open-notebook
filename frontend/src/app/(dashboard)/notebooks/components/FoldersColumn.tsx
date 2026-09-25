'use client'

import { Folder } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GroupTree } from '@/components/sources/GroupTree'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'
import {
  useSourceViews,
  useViewGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
} from '@/lib/hooks/use-source-views'
import { useTranslation } from '@/lib/hooks/use-translation'
import { displayViewName } from '@/lib/utils/view-display'

export interface FoldersColumnProps {
  grouping?: NotebookSourceFilters
  onGroupingChange?: (filters: NotebookSourceFilters) => void
}

// 左侧文件夹栏：视图切换 + 文件夹树，点选后经 onGroupingChange 驱动右侧来源列表。
// 未选视图时按 custom 优先解析默认视图，保证树始终有落点（与 SourcesColumn 同一解析规则）。
export function FoldersColumn({ grouping, onGroupingChange }: FoldersColumnProps) {
  const { t } = useTranslation()
  const { foldersCollapsed, toggleFolders } = useNotebookColumnsStore()

  const { data: views } = useSourceViews()
  const resolvedView = grouping?.viewId
    ? views?.find(v => v.id === grouping.viewId)
    : (views?.find(v => v.view_type === 'custom') ?? views?.find(v => v.is_default) ?? views?.[0])
  const resolvedViewId = resolvedView?.id
  const isAiResolvedView = !!resolvedView && (resolvedView.is_default || resolvedView.view_type.startsWith('ai_'))
  const { data: viewGroups } = useViewGroups(resolvedViewId)
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()
  const deleteGroup = useDeleteGroup()

  const collapseButton = createCollapseButton(toggleFolders, t('sources.grouping.folderRailTitle'))

  const customViews = (views ?? []).filter(v => !(v.is_default || v.view_type.startsWith('ai_')))
  const aiViews = (views ?? []).filter(v => v.is_default || v.view_type.startsWith('ai_'))

  return (
    <CollapsibleColumn
      isCollapsed={foldersCollapsed}
      onToggle={toggleFolders}
      collapsedIcon={Folder}
      collapsedLabel={t('sources.grouping.folderRailTitle')}
    >
      <Card className="h-full flex flex-col flex-1 overflow-hidden" data-testid="notebook-folders-column">
        <CardHeader className="pb-3 flex-shrink-0 space-y-2">
          <Select
            value={grouping?.viewId ?? 'none'}
            onValueChange={(value) =>
              onGroupingChange?.({ viewId: value === 'none' ? undefined : value, group: 'all' })
            }
          >
            <SelectTrigger className="h-7 w-full text-xs" aria-label={t('sources.grouping.viewSelectLabel')}>
              <SelectValue placeholder={t('sources.grouping.viewSelectLabel')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('sources.grouping.allViews')}</SelectItem>
              <SelectGroup>
                <SelectLabel>{t('sources.grouping.familyMine')}</SelectLabel>
                {customViews.map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {displayViewName(view, t)}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>{t('sources.grouping.familyAi')}</SelectLabel>
                {aiViews.map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {displayViewName(view, t)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-sage" />
              <Folder className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{t('sources.grouping.folderRailTitle')}</span>
            </CardTitle>
            {collapseButton}
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto min-h-0 px-2 [&>aside]:w-auto">
          {resolvedViewId && (
            <GroupTree
              activeViewId={resolvedViewId}
              groups={viewGroups ?? []}
              selected={grouping?.group ?? 'all'}
              onSelect={(group) => onGroupingChange?.({ viewId: resolvedViewId, group })}
              onCreateGroup={(name, parentId) =>
                createGroup.mutateAsync({ viewId: resolvedViewId, name, parentId })
              }
              onRenameGroup={(id, name) => updateGroup.mutateAsync({ id, name })}
              onMoveGroup={(id, parentId) => updateGroup.mutate({ id, parentId })}
              onDeleteGroup={(id, deleteSources) => {
                deleteGroup.mutate({ id, deleteSources })
                if (grouping?.group === id) {
                  onGroupingChange?.({ viewId: resolvedViewId, group: 'all' })
                }
              }}
              isAiView={isAiResolvedView}
              viewName={resolvedView ? displayViewName(resolvedView, t) : undefined}
            />
          )}
        </CardContent>
      </Card>
    </CollapsibleColumn>
  )
}

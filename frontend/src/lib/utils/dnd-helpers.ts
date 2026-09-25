import { SourceGroupResponse } from '@/lib/types/api'
import { collectDescendantIds } from './group-tree'

// Custom dataTransfer types shared by the sources table and the group tree.
export const DND_SOURCES_TYPE = 'application/x-onb-sources'
export const DND_GROUP_TYPE = 'application/x-onb-group'

// Dragging a row that is part of the multi-selection drags the whole selection.
export function resolveDragIds(draggedId: string, selectedIds: Set<string>): string[] {
  if (selectedIds.has(draggedId) && selectedIds.size > 1) {
    return [...selectedIds]
  }
  return [draggedId]
}

// Front-end pre-check for dropping a folder into itself or one of its descendants;
// the backend re-validates (cycle/depth), this just avoids the doomed request.
export function canDropGroup(
  groups: SourceGroupResponse[],
  dragId: string,
  targetId: string
): boolean {
  if (dragId === targetId) return false
  return !collectDescendantIds(groups, dragId).includes(targetId)
}

/** Chat-context inclusion mode for a notebook source or note. */
export type ContextMode = 'off' | 'insights' | 'full'
export type NoteContextMode = Exclude<ContextMode, 'insights'>

export interface ContextSelections {
  sources: Record<string, ContextMode>
  notes: Record<string, NoteContextMode>
}

/** One source of a notebook as served by the context-tree endpoint. */
export interface ContextTreeSource {
  id: string
  title: string | null
  insights_count: number
  /** Derived from the source_embedding table (source table has no bool column). */
  embedded: boolean
  embedding_status: string | null
}

/** One folder (source group) of a view. */
export interface ContextTreeGroup {
  id: string
  name: string
  parent_id: string | null
}

/** source -> folder membership edge, filtered to the notebook. */
export interface ContextTreeMembership {
  source_id: string
  group_id: string
}

export interface ContextTreeResponse {
  sources: ContextTreeSource[]
  groups: ContextTreeGroup[]
  memberships: ContextTreeMembership[]
}

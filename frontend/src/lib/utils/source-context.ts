import type {
  ContextMode,
  ContextSelections,
  NoteContextMode,
} from '@/lib/types/notebook-context'

/**
 * Bulk context actions for sources:
 * - `include`  → each source's sensible included mode (insights if available, else full)
 * - `insights` → insights when the source has them, otherwise excluded (don't force full)
 * - `full`     → full content for every source
 * - `exclude`  → excluded from context
 *
 * `include` is the implicit default applied on first load; `insights`, `full`
 * and `exclude` are the explicit bulk actions offered in the column header.
 */
export type SourceContextDefault = 'include' | 'insights' | 'full' | 'exclude'

/** The subset of actions surfaced as explicit bulk menu items. */
export type SourceBulkAction = Exclude<SourceContextDefault, 'include'>

interface SourceLike {
  id: string
  insights_count: number
}

/** The "included" context mode for a source: insights when available, else full. */
export function includedMode(insightsCount: number): ContextMode {
  return insightsCount > 0 ? 'insights' : 'full'
}

/** Resolve the context mode a bulk action implies for a single source. */
export function bulkModeForSource(
  mode: SourceContextDefault,
  insightsCount: number,
): ContextMode {
  switch (mode) {
    case 'exclude':
      return 'off'
    case 'full':
      return 'full'
    case 'insights':
      // "insights only" must not force a mode on sources without insights —
      // those are left out of context entirely (#223).
      return insightsCount > 0 ? 'insights' : 'off'
    case 'include':
    default:
      return includedMode(insightsCount)
  }
}

/**
 * Compute chat-context selections for a batch of sources while preserving
 * existing choices.
 *
 * Newly-seen sources adopt `defaultMode`, so a prior bulk action also governs
 * sources that load later via pagination — otherwise a bulk action would
 * silently miss sources loaded after it (#223/#915).
 */
export function computeSourceSelections(
  existing: Record<string, ContextMode>,
  sources: SourceLike[],
  defaultMode: SourceContextDefault = 'include',
): Record<string, ContextMode> {
  const next = { ...existing }
  for (const source of sources) {
    const current = next[source.id]
    if (current === undefined) {
      next[source.id] = bulkModeForSource(defaultMode, source.insights_count)
    } else if (defaultMode === 'include' && current === 'full' && source.insights_count > 0) {
      // Auto-upgrade only under the implicit default: a source included as
      // 'full' (because it had no insights yet) prefers leaner insights once
      // they exist. An explicit 'full' bulk choice is left untouched.
      next[source.id] = 'insights'
    }
  }
  return next
}

/** Apply a uniform bulk context action to every given source. */
export function applyBulkSourceContext(
  existing: Record<string, ContextMode>,
  sources: SourceLike[],
  action: SourceContextDefault,
): Record<string, ContextMode> {
  const next = { ...existing }
  for (const source of sources) {
    next[source.id] = bulkModeForSource(action, source.insights_count)
  }
  return next
}

/**
 * Compute folder-scoped chat-context selections: sources inside the folder
 * default to full inclusion, sources outside the folder stay out of context,
 * and saved per-source preferences override both defaults.
 *
 * The result is rebuilt from scratch (no existing choices carried over): the
 * scope defines the whole context, so selections from a previously browsed
 * folder must not leak. Sources are the full loaded list; `folderSourceIds`
 * marks membership in the browsed folder. `folderDefault` lets a session-level
 * bulk action govern in-folder sources that have no saved preference yet
 * (pagination loaded after a bulk action, cf. #915).
 */
export function scopedFolderSelections(
  sources: SourceLike[],
  folderSourceIds: Set<string>,
  prefs: Record<string, ContextMode>,
  folderDefault: SourceContextDefault = 'full',
): Record<string, ContextMode> {
  const next: Record<string, ContextMode> = {}
  for (const source of sources) {
    const saved = prefs[source.id]
    next[source.id] = saved ?? (folderSourceIds.has(source.id)
      ? bulkModeForSource(folderDefault, source.insights_count)
      : 'off')
  }
  return next
}

// ---------------------------------------------------------------------------
// Notes
//
// Notes have no insights, so their context is binary: included (full) or off.
// ---------------------------------------------------------------------------

/** Bulk context actions for notes. `include` maps to full content. */
export type NoteContextDefault = 'include' | 'exclude'

interface NoteLike {
  id: string
}

/** Resolve the context mode a bulk action implies for a single note. */
export function bulkModeForNote(action: NoteContextDefault): NoteContextMode {
  return action === 'exclude' ? 'off' : 'full'
}

/**
 * Compute chat-context selections for a batch of notes while preserving
 * existing choices. Newly-seen notes adopt `defaultAction` so a prior bulk
 * action also governs notes that load later.
 */
export function computeNoteSelections(
  existing: Record<string, NoteContextMode>,
  notes: NoteLike[],
  defaultAction: NoteContextDefault = 'include',
): Record<string, NoteContextMode> {
  const next = { ...existing }
  for (const note of notes) {
    if (next[note.id] === undefined) {
      next[note.id] = bulkModeForNote(defaultAction)
    }
  }
  return next
}

/** Apply a uniform bulk context action to every given note. */
export function applyBulkNoteContext(
  existing: Record<string, NoteContextMode>,
  notes: NoteLike[],
  action: NoteContextDefault,
): Record<string, NoteContextMode> {
  const next = { ...existing }
  for (const note of notes) {
    next[note.id] = bulkModeForNote(action)
  }
  return next
}

/** The per-id mode payload the chat buildContext API expects. */
export interface ChatContextConfig {
  sources: Record<string, string>
  notes: Record<string, string>
}

/**
 * Chat request payload from the selection maps.
 *
 * Iterates the selections (not a loaded source list) so the context picker can
 * include sources that paginated listings have not loaded yet; ids that are
 * loaded but absent from the map default to "not in" — matching the payload
 * shape produced before the picker existed.
 */
export function buildChatContextConfig(
  selections: ContextSelections,
  loadedSourceIds: string[] = [],
  loadedNoteIds: string[] = [],
): ChatContextConfig {
  const sources: Record<string, string> = {}
  for (const id of loadedSourceIds) {
    sources[id] = 'not in'
  }
  for (const [id, mode] of Object.entries(selections.sources)) {
    if (mode === 'insights') {
      sources[id] = 'insights'
    } else if (mode === 'full') {
      sources[id] = 'full content'
    } else {
      sources[id] = 'not in'
    }
  }

  const notes: Record<string, string> = {}
  for (const id of loadedNoteIds) {
    notes[id] = 'not in'
  }
  for (const [id, mode] of Object.entries(selections.notes)) {
    notes[id] = mode === 'full' ? 'full content' : 'not in'
  }

  return { sources, notes }
}

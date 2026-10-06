import type { ContextSelections } from '@/lib/types/notebook-context'

/**
 * Helpers for notebook-level study artifact generation (study guide / FAQ /
 * flashcards / essay drafts). The artifact command reuses the same
 * context_config protocol as POST /chat/context, so the mapping mirrors
 * useNotebookChat's buildContext exactly ("insights" / "full content" / "not in").
 */

export type ArtifactType =
  | 'study_guide'
  | 'faq'
  | 'flashcards'
  | 'essay_draft'
  | 'comparison'
  | 'mindmap'

export interface ArtifactContextConfig {
  sources: Record<string, string>
  notes: Record<string, string>
}

interface IdLike {
  id: string
}

/** Map page-level context selections to the chat context_config protocol. */
export function buildArtifactContextConfig(
  contextSelections: ContextSelections,
  sources: IdLike[],
  notes: IdLike[],
): ArtifactContextConfig {
  const config: ArtifactContextConfig = { sources: {}, notes: {} }

  sources.forEach(source => {
    const mode = contextSelections.sources[source.id]
    if (mode === 'insights') {
      config.sources[source.id] = 'insights'
    } else if (mode === 'full') {
      config.sources[source.id] = 'full content'
    } else {
      config.sources[source.id] = 'not in'
    }
  })

  notes.forEach(note => {
    const mode = contextSelections.notes[note.id]
    config.notes[note.id] = mode === 'full' ? 'full content' : 'not in'
  })

  return config
}

/** True when at least one source or note is included in the context. */
export function hasIncludedContext(config: ArtifactContextConfig): boolean {
  const statuses = [...Object.values(config.sources), ...Object.values(config.notes)]
  return statuses.some(status => status !== 'not in')
}

/** A single flashcard: prompt on the front, answer on the back. */
export interface Flashcard {
  front: string
  back: string
}

const MAX_FLASHCARDS = 100

/**
 * Parse flashcard note content (a JSON array of {front, back}) into cards.
 * Tolerates a wrapping ```json fence and prose around the array. Returns
 * null for anything that is not a usable flashcard payload, so callers can
 * fall back to regular note rendering.
 */
export function parseFlashcards(content: string | null | undefined): Flashcard[] | null {
  if (!content) return null
  let text = content.trim()
  if (!text.includes('[')) return null

  if (text.startsWith('```')) {
    const firstNewline = text.indexOf('\n')
    if (firstNewline === -1) return null
    text = text.slice(firstNewline + 1)
    if (text.trimEnd().endsWith('```')) {
      text = text.trimEnd().slice(0, -3)
    }
    text = text.trim()
  }

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const cards: Flashcard[] = []
  for (const item of parsed.slice(0, MAX_FLASHCARDS)) {
    if (typeof item !== 'object' || item === null) continue
    const front = String((item as Record<string, unknown>).front ?? '').trim()
    const back = String((item as Record<string, unknown>).back ?? '').trim()
    if (front && back) cards.push({ front, back })
  }
  return cards.length > 0 ? cards : null
}

/** One node of a generated mindmap tree. */
export interface MindmapNode {
  label: string
  children?: MindmapNode[]
}

const MAX_MINDMAP_DEPTH = 6

function sanitizeMindmapNode(raw: unknown, depth: number): MindmapNode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const label = String((raw as Record<string, unknown>).label ?? '').trim()
  if (!label) return null
  const node: MindmapNode = { label }
  const children = (raw as Record<string, unknown>).children
  if (Array.isArray(children) && depth < MAX_MINDMAP_DEPTH) {
    const sanitized = children
      .map(child => sanitizeMindmapNode(child, depth + 1))
      .filter((child): child is MindmapNode => child !== null)
    if (sanitized.length > 0) node.children = sanitized
  }
  return node
}

/**
 * Parse a mindmap note ({"kind":"mindmap","root":{label,children}} written by
 * the generate_artifact command) into a renderable tree. Returns null for
 * anything else so callers fall back to regular note rendering.
 */
export function parseMindmap(content: string | null | undefined): MindmapNode | null {
  if (!content) return null
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (record.kind !== 'mindmap') return null
  return sanitizeMindmapNode(record.root, 0)
}

import apiClient from './client'
import type { Quad } from '@/lib/pdf/annotation-anchor'

/**
 * Client for the source-annotation CRUD + color-semantics settings endpoints
 * (api/routers/source_annotations.py). Conventions follow source-analysis.ts /
 * insights.ts: requests go through the shared axios instance (auth + base URL
 * + 401 redirect live in ./client.ts) and errors propagate to the caller —
 * consumers decide whether a failure is a toast or a silent skip.
 *
 * display_position is deliberately absent from the create/update payloads:
 * the backend normalizes it to NULL for the whole MVP (PDR-003 ruling 9), so
 * the client never sends it.
 */

/** Semantic ink tokens a highlight can wear (globals.css `--anno-<color>`). */
export const ANNOTATION_COLORS = ['gold', 'fern', 'plum', 'slate', 'clay'] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

/** Underline shapes (plan §4.3). */
export const ANNOTATION_LINE_STYLES = ['wavy', 'straight'] as const
export type AnnotationLineStyle = (typeof ANNOTATION_LINE_STYLES)[number]

/** W3C TextQuoteSelector-style anchor for the parsed-text view (plan §5.3). */
export interface SourceAnnotationTextAnchor {
  quote: string
  prefix?: string
  suffix?: string
  start_offset?: number | null
  end_offset?: number | null
  section_title?: string | null
}

/** PDF anchor: user-space quads on a single page (plan §5.3). */
export interface SourceAnnotationPdfAnchor {
  page: number
  quads: Quad[]
}

/** One row of the source_annotation table, as returned by the API. */
export interface SourceAnnotation {
  id: string
  /** Owning source id (record id string on the wire). */
  source: string
  color: AnnotationColor
  line_style: AnnotationLineStyle
  /** Annotation text; null = pure highlight with no note. */
  body: string | null
  display_position: string | null
  /** Redundant quote snapshot for overviews/exports/re-anchoring. */
  quote: string | null
  text_anchor: SourceAnnotationTextAnchor | null
  pdf_anchor: SourceAnnotationPdfAnchor | null
  /** Flattened page number (PDF view filtering/lazy loading). */
  page: number | null
  /** Flattened text offset (parsed view ordering). */
  start_offset: number | null
  created: string
  updated: string
}

/** POST body. At least one anchor (text_anchor or pdf_anchor) is required. */
export interface SourceAnnotationCreateInput {
  source_id: string
  color: AnnotationColor
  line_style: AnnotationLineStyle
  body?: string | null
  quote?: string | null
  text_anchor?: SourceAnnotationTextAnchor | null
  pdf_anchor?: SourceAnnotationPdfAnchor | null
}

/** PATCH-style partial update; only sent fields are applied server-side. */
export interface SourceAnnotationPatch {
  color?: AnnotationColor
  line_style?: AnnotationLineStyle
  body?: string | null
  quote?: string | null
  text_anchor?: SourceAnnotationTextAnchor | null
  pdf_anchor?: SourceAnnotationPdfAnchor | null
}

/** Color-semantics naming singleton (annotation_settings, plan §4.2). */
export interface AnnotationSettings {
  id: string
  /** Custom names per color; missing entries fall back to i18n defaults. */
  color_names: Partial<Record<AnnotationColor, string>>
}

export const sourceAnnotationsApi = {
  /** List annotations for a source, optionally narrowed to one page
   * (PDF lazy loading). Ordered per the backend (page / start_offset).
   * `options.signal` lets callers abort (e.g. the sources page cancels the
   * count fetch when the delete-confirm dialog closes, F9). */
  list: async (
    sourceId: string,
    page?: number,
    options?: { signal?: AbortSignal }
  ): Promise<SourceAnnotation[]> => {
    const response = await apiClient.get<SourceAnnotation[]>('/source-annotations', {
      params: page != null ? { source_id: sourceId, page } : { source_id: sourceId },
      signal: options?.signal,
    })
    return response.data
  },

  /** Count via the full list — there is no dedicated count endpoint, and the
   * rows are small enough that a per-source fetch is cheap (asked-for MVP). */
  count: async (
    sourceId: string,
    options?: { signal?: AbortSignal }
  ): Promise<number> => {
    const annotations = await sourceAnnotationsApi.list(sourceId, undefined, options)
    return annotations.length
  },

  create: async (payload: SourceAnnotationCreateInput): Promise<SourceAnnotation> => {
    const response = await apiClient.post<SourceAnnotation>('/source-annotations', payload)
    return response.data
  },

  update: async (id: string, patch: SourceAnnotationPatch): Promise<SourceAnnotation> => {
    const response = await apiClient.put<SourceAnnotation>(
      `/source-annotations/${encodeURIComponent(id)}`,
      patch
    )
    return response.data
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/source-annotations/${encodeURIComponent(id)}`)
  },

  getSettings: async (): Promise<AnnotationSettings> => {
    const response = await apiClient.get<AnnotationSettings>('/annotation-settings')
    return response.data
  },

  saveSettings: async (
    colorNames: AnnotationSettings['color_names']
  ): Promise<AnnotationSettings> => {
    const response = await apiClient.put<AnnotationSettings>('/annotation-settings', {
      color_names: colorNames,
    })
    return response.data
  },
}

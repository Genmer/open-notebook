'use client'

import { useCallback, useMemo } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  sourceAnnotationsApi,
  type SourceAnnotation,
  type SourceAnnotationCreateInput,
  type SourceAnnotationPatch,
} from '@/lib/api/source-annotations'
import { useTranslation } from '@/lib/hooks/use-translation'

/**
 * Per-page lazy annotation loading (plan §3.5 "611 页大文档" row, MVP task F7).
 *
 * ## Fetch strategy
 *
 * One query per page for the window `currentPage ± bufferPages` (clamped to
 * `[1, max(totalPages, currentPage)]`), via `useQueries`. Each page is its own
 * react-query cache entry keyed `['source-annotations', sourceId, page]`, so:
 * - turning a page fetches only the newly entered pages — already-loaded
 *   pages are served from cache (they stay fresh for
 *   `ANNOTATION_PAGE_STALE_MS`, because every mutation in this hook writes
 *   straight into the page caches and a background refetch of a loaded page
 *   is pure waste on 611-page documents);
 * - the upper clamp uses `max(totalPages, currentPage)` instead of plain
 *   `totalPages`: when a source file was replaced with a shorter one and the
 *   viewer still sits beyond the new end (currentPage > totalPages), the
 *   window must still be fetched so over-range rows can surface as
 *   `orphanedAnnotations` (plan §3.4-C MVP O(1) check: flattened `page`
 *   vs `totalPages`, no quote matching).
 *
 * ## Mutations
 *
 * `create` / `update` / `remove` are optimistic with full rollback and
 * failure toasts baked in (sonner + `sources.annotations.toast.*Failed`) —
 * they rethrow so callers can react beyond the toast. Success stays silent:
 * the annotation appears in place (plan §3.5 快速连续标注). NOTE: the hover
 * card performs its *own* API calls with its own toasts — wire each action
 * through ONE door (either this hook or the card), never both, or a failure
 * double-toasts.
 */

/** Query key for one page slice of a source's annotations. */
export const annotationsPageKey = (sourceId: string, page: number) =>
  ['source-annotations', sourceId, page] as const
const sourceAnnotationsRootKey = (sourceId: string) => ['source-annotations', sourceId] as const

/** See the fetch strategy note above. */
const ANNOTATION_PAGE_STALE_MS = 5 * 60 * 1000

export interface UseAnnotationsOptions {
  sourceId: string
  currentPage: number
  totalPages: number
  /** Pages fetched around the current one (default 1 → current ± 1). */
  bufferPages?: number
}

export interface UseAnnotationsResult {
  /** Only the pages actually held in cache (data keyed by page number). */
  annotationsByPage: Record<number, SourceAnnotation[]>
  /** Flattened union of every loaded page, in canonical order. */
  allLoaded: SourceAnnotation[]
  /** Current page slice, memoized on (data, page) — referentially stable
   * across re-renders that do not change the data (the "索引只算一次"
   * guarantee, plan §3.5 标注索引 memo 化). */
  currentPageAnnotations: SourceAnnotation[]
  /** Loaded rows whose flattened page exceeds totalPages (§3.4-C MVP). */
  orphanedAnnotations: SourceAnnotation[]
  /** Page numbers currently held in cache (the loaded-page union). */
  loadedPages: number[]
  /** True while any window page query is in flight. */
  isFetching: boolean
  /** Optimistic create (page taken from pdf_anchor); rolls back + toasts. */
  create: (input: SourceAnnotationCreateInput) => Promise<SourceAnnotation>
  /** Optimistic partial update; moves the row between page caches if the
   * patch changes its page; rolls back + toasts. */
  update: (id: string, patch: SourceAnnotationPatch) => Promise<SourceAnnotation>
  /** Optimistic delete; rolls back + toasts. */
  remove: (id: string) => Promise<void>
}

/** Canonical order: page, then text offset, then creation time. */
export function compareAnnotations(a: SourceAnnotation, b: SourceAnnotation): number {
  const pageA = a.page ?? Number.POSITIVE_INFINITY
  const pageB = b.page ?? Number.POSITIVE_INFINITY
  if (pageA !== pageB) return pageA - pageB
  const offA = a.start_offset ?? Number.POSITIVE_INFINITY
  const offB = b.start_offset ?? Number.POSITIVE_INFINITY
  if (offA !== offB) return offA - offB
  return a.created.localeCompare(b.created)
}

/** Sorted *copy* — never mutates the query cache's arrays. */
export function sortPageAnnotations(list: SourceAnnotation[]): SourceAnnotation[] {
  return [...list].sort(compareAnnotations)
}

type PageSnapshot = Array<[page: number, data: SourceAnnotation[] | undefined]>

export function useAnnotations({
  sourceId,
  currentPage,
  totalPages,
  bufferPages = 1,
}: UseAnnotationsOptions): UseAnnotationsResult {
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const buffer = Math.max(0, bufferPages)
  const pages = useMemo(() => {
    const maxPage = Math.max(totalPages, currentPage)
    const pageWindow: number[] = []
    for (let p = currentPage - buffer; p <= currentPage + buffer; p++) {
      if (p >= 1 && p <= maxPage) pageWindow.push(p)
    }
    return pageWindow
  }, [currentPage, totalPages, buffer])

  const pageQueries = useQueries({
    queries: pages.map((page) => ({
      queryKey: annotationsPageKey(sourceId, page),
      queryFn: () => sourceAnnotationsApi.list(sourceId, page),
      staleTime: ANNOTATION_PAGE_STALE_MS,
    })),
  })

  // useQueries returns a fresh array every render; its *data* references are
  // cache-stable. Keying the derived memos on this stamp keeps them
  // referentially stable across re-renders (see currentPageAnnotations).
  const dataStamp = pageQueries.map((query) => query.dataUpdatedAt).join('|')

  const annotationsByPage = useMemo(() => {
    const byPage: Record<number, SourceAnnotation[]> = {}
    pages.forEach((page, index) => {
      const data = pageQueries[index]?.data
      if (data) byPage[page] = data
    })
    return byPage
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageQueries is render-unstable by design; dataStamp + pages are the real inputs.
  }, [pages, dataStamp])

  const allLoaded = useMemo(
    () => sortPageAnnotations(Object.values(annotationsByPage).flat()),
    [annotationsByPage]
  )

  const currentPageAnnotations = useMemo(
    () => sortPageAnnotations(annotationsByPage[currentPage] ?? []),
    [annotationsByPage, currentPage]
  )

  const orphanedAnnotations = useMemo(
    () => allLoaded.filter((annotation) => annotation.page != null && annotation.page > totalPages),
    [allLoaded, totalPages]
  )

  const loadedPages = useMemo(() => Object.keys(annotationsByPage).map(Number), [annotationsByPage])

  const isFetching = pageQueries.some((query) => query.isFetching)

  /** All cached page slices for this source, for snapshot/rollback. */
  const snapshotLoadedPages = useCallback((): PageSnapshot => {
    return queryClient
      .getQueriesData<SourceAnnotation[]>({ queryKey: sourceAnnotationsRootKey(sourceId) })
      .map(([key, data]) => {
        const page = key[key.length - 1]
        return [typeof page === 'number' ? page : -1, data] as [number, SourceAnnotation[] | undefined]
      })
      .filter(([page]) => page >= 0)
  }, [queryClient, sourceId])

  const restoreSnapshot = useCallback(
    (snapshot: PageSnapshot) => {
      for (const [page, data] of snapshot) {
        if (data === undefined) {
          queryClient.removeQueries({ queryKey: annotationsPageKey(sourceId, page) })
        } else {
          queryClient.setQueryData(annotationsPageKey(sourceId, page), data)
        }
      }
    },
    [queryClient, sourceId]
  )

  const removeFromPageCaches = useCallback(
    (id: string) => {
      for (const [page, data] of snapshotLoadedPages()) {
        if (!data?.some((annotation) => annotation.id === id)) continue
        queryClient.setQueryData(annotationsPageKey(sourceId, page), data.filter((a) => a.id !== id))
      }
    },
    [queryClient, sourceId, snapshotLoadedPages]
  )

  const upsertIntoPageCache = useCallback(
    (page: number, row: SourceAnnotation) => {
      queryClient.setQueryData<SourceAnnotation[]>(annotationsPageKey(sourceId, page), (prev) =>
        sortPageAnnotations([...(prev ?? []).filter((a) => a.id !== row.id), row])
      )
    },
    [queryClient, sourceId]
  )

  const create = useCallback(
    async (input: SourceAnnotationCreateInput) => {
      const page = input.pdf_anchor?.page ?? null
      const optimisticId = `optimistic:${crypto.randomUUID()}`
      const now = new Date().toISOString()
      const optimistic: SourceAnnotation = {
        id: optimisticId,
        source: input.source_id,
        color: input.color,
        line_style: input.line_style,
        body: input.body ?? null,
        display_position: null,
        quote: input.quote ?? null,
        text_anchor: input.text_anchor ?? null,
        pdf_anchor: input.pdf_anchor ?? null,
        page,
        start_offset: input.text_anchor?.start_offset ?? null,
        created: now,
        updated: now,
      }
      // No page (parsed-view anchor, P1): nothing to optimistically paint in
      // the PDF page caches — the API call below is the whole effect.
      const snapshot = page != null ? snapshotLoadedPages() : []
      if (page != null) upsertIntoPageCache(page, optimistic)
      try {
        const created = await sourceAnnotationsApi.create(input)
        if (page != null) {
          removeFromPageCaches(optimisticId)
          if (created.page != null) upsertIntoPageCache(created.page, created)
        }
        return created
      } catch (error) {
        restoreSnapshot(snapshot)
        toast.error(t('sources.annotations.toast.createFailed'))
        throw error
      }
    },
    [removeFromPageCaches, restoreSnapshot, snapshotLoadedPages, t, upsertIntoPageCache]
  )

  const update = useCallback(
    async (id: string, patch: SourceAnnotationPatch) => {
      const snapshot = snapshotLoadedPages()
      const row = snapshot
        .flatMap(([, data]) => data ?? [])
        .find((annotation) => annotation.id === id)
      let optimistic: SourceAnnotation | null = null
      if (row) {
        optimistic = { ...row, ...patch, updated: new Date().toISOString() }
        removeFromPageCaches(id)
        const targetPage = patch.pdf_anchor?.page ?? optimistic.page
        if (targetPage != null) upsertIntoPageCache(targetPage, optimistic)
      }
      try {
        const updated = await sourceAnnotationsApi.update(id, patch)
        if (row) {
          removeFromPageCaches(id)
          if (updated.page != null) upsertIntoPageCache(updated.page, updated)
        }
        return updated
      } catch (error) {
        restoreSnapshot(snapshot)
        toast.error(t('sources.annotations.toast.updateFailed'))
        throw error
      }
    },
    [removeFromPageCaches, restoreSnapshot, snapshotLoadedPages, t, upsertIntoPageCache]
  )

  const remove = useCallback(
    async (id: string) => {
      const snapshot = snapshotLoadedPages()
      removeFromPageCaches(id)
      try {
        await sourceAnnotationsApi.remove(id)
      } catch (error) {
        restoreSnapshot(snapshot)
        toast.error(t('sources.annotations.toast.deleteFailed'))
        throw error
      }
    },
    [removeFromPageCaches, restoreSnapshot, snapshotLoadedPages, t]
  )

  return {
    annotationsByPage,
    allLoaded,
    currentPageAnnotations,
    orphanedAnnotations,
    loadedPages,
    isFetching,
    create,
    update,
    remove,
  }
}

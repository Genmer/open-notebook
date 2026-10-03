'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  List,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { SaveNoteDialog } from '@/components/sources/SaveNoteDialog'
import { TaskLiveInspector } from '@/components/tasks/TaskLiveInspector'
import AnnotationHoverCard, {
  ANNOTATION_HOVER_TIMING,
  type AnchorRect,
} from '@/components/sources/annotations/AnnotationHoverCard'
import AnnotationSvgOverlay, {
  type OverlayAnnotation,
} from '@/components/sources/annotations/AnnotationSvgOverlay'
import PageTextLayer from '@/components/sources/annotations/PageTextLayer'
import ScanPageNotice from '@/components/sources/annotations/ScanPageNotice'
import SelectionToolbar from '@/components/sources/annotations/SelectionToolbar'
import { sourcesApi } from '@/lib/api/sources'
import {
  sourceAnnotationsApi,
  type AnnotationColor,
  type AnnotationLineStyle,
  type SourceAnnotation,
  type SourceAnnotationCreateInput,
} from '@/lib/api/source-annotations'
import {
  annotationsPageKey,
  sortPageAnnotations,
  useAnnotations,
} from '@/lib/hooks/use-annotations'
import { useSectionAnalysis } from '@/lib/hooks/use-section-analysis'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getPdfjs } from '@/lib/pdf/pdf-loader'
import {
  extractPagesText,
  flattenOutline,
  isPdfBuffer,
  parseTocFromPages,
  sectionEndPage,
  type PdfOutlineEntry,
} from '@/lib/pdf/pdf-utils'
import {
  quoteFromSelectionText,
  quadToDomRect,
  rectsToQuads,
  textAnchorFromSelection,
  type DomRectLike,
  type Quad,
  type TextAnchor,
} from '@/lib/pdf/annotation-anchor'

interface PdfSourceViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceId: string
  /** Original file path — drives the .pdf extension pre-check. */
  filePath?: string | null
  /** Notebook context for the "save analysis as note" flow; hides it when absent (classic page). */
  notebookId?: string
  /**
   * Render embedded in the content pane (no dialog) — the "show source
   * file" toggle replaces the parsed text in place.
   */
  inline?: boolean
}

interface SectionAnalysis {
  markdown: string
  truncated: boolean
}

const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5]

/**
 * F1 spike ruling (2026-10-03, mvp-tasks §6): the 划词 (text-selection) branch
 * is the MVP main path — 100% text pages sampled on the real 611-page exam
 * file, no branch switch. The scan-page notice renders ONLY on this branch
 * (plan §3.1 branch condition: on the rectangle-selection branch its copy
 * would promise "next phase" about the current main path). Flip to false if a
 * re-run of the spike ever switches branches (§5.6).
 */
const ANNOTATION_SELECTION_MAIN_PATH = true

/** Page classification: has a usable pdf.js text layer or not (PDR-003 ruling 1
 * — interaction routes per page, decoupled from the document-wide branch). */
type PageKind = 'text' | 'scan'

/** One page's TextLayer inputs: the pdf.js page proxy, its dpr-free CSS
 * viewport and the pre-fetched text content (classification already done). */
interface PageTextInfo {
  page: PDFPageProxy
  cssViewport: PageViewport
  textContent: TextContent
}

/** Page geometry for the wrapper CSS size + the overlay viewBox space. */
interface PageDims {
  /** PDF user units (viewBox space, y grows upward). */
  userWidth: number
  userHeight: number
  /** CSS pixels — the scaled on-screen page (no devicePixelRatio). */
  cssWidth: number
  cssHeight: number
}

/** Zoom-independent per-page classification cache entry. TextContent identity
 * is kept stable so PageTextLayer never rebuilds on zoom (it `update()`s). */
interface CachedPageText {
  kind: PageKind
  textContent: TextContent
}

/**
 * In-app viewer for uploaded PDF sources. Loads the original file via the
 * download endpoint, renders one page at a time on a single canvas, offers
 * the document outline for navigation and a click-triggered AI analysis per
 * outline section (result savable as a note when a notebook context exists).
 *
 * The rendered page lives in a relative wrapper (data-testid="pdf-page-wrapper")
 * that all page layers share — canvas, pdf.js TextLayer (text pages only) and
 * the SVG annotation overlay — so they can never drift apart by rounding: the
 * wrapper carries the exact dpr-free CSS viewport size and every child fills
 * it (plan §5.3 "same wrapper" guarantee).
 *
 * Annotation flow (plan §3): selection inside the TextLayer → floating
 * toolbar → optimistic annotation (serial submit queue) → hover card with the
 * 150ms open / 300ms grace choreography. Scanned pages (empty text content)
 * route to the inline notice instead of a text layer (PDR-003 ruling 1).
 *
 * Two shells: a modal dialog (default) or `inline` — embedded directly in
 * the source content pane, replacing the parsed text while toggled on.
 *
 * Loaded via next/dynamic + ssr:false (pdf.js is browser-only).
 */
export default function PdfSourceViewer({
  open,
  onOpenChange,
  sourceId,
  filePath,
  notebookId,
  inline = false,
}: PdfSourceViewerProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pageWrapperRef = useRef<HTMLDivElement | null>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'notPdf' | 'failed'>('loading')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [outline, setOutline] = useState<PdfOutlineEntry[] | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(true)
  // True while the printed-TOC fallback is scanning (no PDF bookmarks).
  const [parsingToc, setParsingToc] = useState(false)

  // AI analysis state: results cached per outline entry key; one job in
  // flight (isAnalyzing disables the sibling Sparkles buttons). The job id
  // drives the live progress inspector in the analysis panel.
  const [analysisByKey, setAnalysisByKey] = useState<Record<string, SectionAnalysis>>({})
  const [emptyTextKeys, setEmptyTextKeys] = useState<Record<string, true>>({})
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)

  // ── Annotation layer state ──────────────────────────────────────────────
  // Current-page classification + TextLayer inputs (null on scanned pages).
  const [pageKind, setPageKind] = useState<PageKind | null>(null)
  const [pageInfo, setPageInfo] = useState<PageTextInfo | null>(null)
  const [pageDims, setPageDims] = useState<PageDims | null>(null)
  // The TextLayer container element (queried from the wrapper after mount) —
  // the selection toolbar's containerEl.
  const [textLayerEl, setTextLayerEl] = useState<HTMLElement | null>(null)
  // Per-page classification cache, cleared on document switch.
  const pageTextCacheRef = useRef<Map<number, CachedPageText>>(new Map())

  // Annotation rows for the current page come from the per-page lazy loader
  // (react-query cache; optimistic rows are painted by the hook itself).
  // Rapid successive creations run through a serial queue below (plan §3.5).
  const queryClient = useQueryClient()
  const totalPages = doc?.numPages ?? 0
  const annotations = useAnnotations({ sourceId, currentPage, totalPages })
  // Toolbar defaults: gold is the default color (plan §4.2), the line style
  // only switches the default for *subsequent* annotations (plan §3.1).
  const [defaultColor] = useState<AnnotationColor>('gold')
  const [defaultLineStyle, setDefaultLineStyle] = useState<AnnotationLineStyle>('wavy')
  // Serial submit queue — rapid successive annotations never race (§3.5).
  const submitQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  // Hover-card choreography (AnnotationHoverCard visibility protocol): the
  // open/close delays live here because the underline and the card both
  // participate.
  const [hover, setHover] = useState<{ id: string; rect: AnchorRect } | null>(null)
  const [hoverOpen, setHoverOpen] = useState(false)
  // Opens the card straight into the pinned edit state (comment flow entry);
  // afterwards it mirrors the card's internal flag (onPinnedChange) so the
  // pointer-leave grace can skip closing a pinned card (plan §3.7).
  const [hoverPinned, setHoverPinned] = useState(false)
  const hoverPinnedRef = useRef(false)
  hoverPinnedRef.current = hoverPinned
  const hoverOpenTimerRef = useRef<number | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)

  // Annotations whose flattened page exceeds the document's page count —
  // source file was replaced; O(1) check per row against doc.numPages
  // (PDR-003 ruling 16, MVP lightweight orphaned hint).
  const [orphanedCount, setOrphanedCount] = useState(0)

  const analysis = useSectionAnalysis({
    onCompleted: (key, result) => {
      setAnalysisByKey((prev) => ({
        ...prev,
        [key]: { markdown: result.analysis_markdown, truncated: !!result.truncated },
      }))
      setAnalyzingKey(null)
    },
    onFailed: (key) => {
      setErrorKey(key)
      setAnalyzingKey(null)
    },
  })

  // "still mounted" guard for the async load/extract chains.
  const mountedRef = useRef(true)

  const clearHoverTimers = useCallback(() => {
    if (hoverOpenTimerRef.current != null) {
      window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = null
    }
    if (hoverCloseTimerRef.current != null) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
  }, [])

  const scheduleHoverClose = useCallback(() => {
    if (hoverCloseTimerRef.current != null) window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null
      setHoverOpen(false)
    }, ANNOTATION_HOVER_TIMING.closeGraceMs)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearHoverTimers()
    }
  }, [clearHoverTimers])

  /** Clear the live selection and every piece of transient annotation UI. */
  const clearAnnotationUi = useCallback(() => {
    clearHoverTimers()
    setHoverOpen(false)
    setHover(null)
    setHoverPinned(false)
    setOrphanedCount(0)
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }
  }, [clearHoverTimers])

  const resetState = useCallback(() => {
    setStatus('loading')
    setDoc(null)
    setCurrentPage(1)
    setScale(1)
    setOutline(null)
    setParsingToc(false)
    setAnalysisByKey({})
    setEmptyTextKeys({})
    setAnalyzingKey(null)
    setErrorKey(null)
    setActiveKey(null)
    setSaveDialogOpen(false)
    // Annotation layer: drop per-page classification, page inputs and every
    // in-flight annotation interaction (a new document is loading). The
    // react-query page caches stay — they are keyed per source+page and serve
    // a reopened viewer instantly.
    setPageKind(null)
    setPageInfo(null)
    setPageDims(null)
    setTextLayerEl(null)
    pageTextCacheRef.current.clear()
    submitQueueRef.current = Promise.resolve()
    clearAnnotationUi()
  }, [clearAnnotationUi])

  // Closing the viewer (either shell) must also drop the selection and the
  // annotation UI state — the dialog unmounts its children, but the text
  // selection itself outlives the DOM it lived in.
  useEffect(() => {
    if (open) return
    clearAnnotationUi()
  }, [open, clearAnnotationUi])

  // Load the document while open; destroy the loading task on close/reopen.
  // The ArrayBuffer is transferred to the worker (ownership moves) — never
  // reused across attempts.
  useEffect(() => {
    if (!open || !sourceId) return
    let cancelled = false
    let loadingTask: { destroy: () => Promise<void> | void } | null = null

    resetState()
    void (async () => {
      try {
        const buffer = await sourcesApi.fetchSourceFileBuffer(sourceId)
        if (cancelled) return
        const bytes = new Uint8Array(buffer)
        // Content-Type is always octet-stream; judge by extension first and
        // fall back to the %PDF- magic bytes.
        const looksPdf = (filePath && /\.pdf$/i.test(filePath)) || isPdfBuffer(bytes)
        if (!looksPdf) {
          setStatus('notPdf')
          return
        }
        const pdfjs = await getPdfjs()
        if (cancelled) return
        const task = pdfjs.getDocument({ data: bytes })
        loadingTask = task
        const loaded = await task.promise
        if (cancelled) {
          void task.destroy()
          return
        }
        setDoc(loaded)
        const rawOutline = await loaded.getOutline()
        if (cancelled) return
        // The page renders immediately; the outline (or its printed-TOC
        // fallback parse) fills in asynchronously.
        setStatus('ready')
        if (rawOutline?.length) {
          setOutline(await flattenOutline(loaded, rawOutline))
        } else {
          setOutline([])
          setParsingToc(true)
          try {
            const parsed = await parseTocFromPages(loaded)
            if (cancelled) return
            setOutline(parsed)
          } catch {
            // A failed TOC parse leaves the empty outline in place; the
            // document itself is already viewable.
          } finally {
            if (!cancelled) setParsingToc(false)
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load source file for preview:', err)
          setStatus('failed')
        }
      }
    })()

    return () => {
      cancelled = true
      if (loadingTask) void loadingTask.destroy()
    }
  }, [open, sourceId, filePath, resetState])

  // Render the current page onto the single canvas and classify the page:
  // getTextContent decides whether a TextLayer exists (PDR-003 ruling 1 —
  // per-page routing). Classification is cached per page so zoom only
  // re-renders the canvas and re-layouts the existing spans. Cancel any
  // in-flight render task before a page turn / zoom (effect cleanup).
  useEffect(() => {
    if (!doc || status !== 'ready') return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null

    void (async () => {
      try {
        const page = await doc.getPage(currentPage)
        let cached = pageTextCacheRef.current.get(currentPage)
        if (!cached) {
          const textContent = await page.getTextContent()
          // Non-text items (marked content) and whitespace-only strings carry
          // no selectable text — only a real str counts for classification.
          const hasText = textContent.items.some(
            (item) => typeof (item as TextItem).str === 'string' && (item as TextItem).str.trim().length > 0
          )
          cached = { kind: hasText ? 'text' : 'scan', textContent }
          pageTextCacheRef.current.set(currentPage, cached)
        }
        if (cancelled) return
        // The dpr-free CSS viewport — the one the TextLayer lays out in and
        // every DOM↔user-space conversion goes through (the "dual viewport
        // trap": only the canvas bitmap uses the dpr viewport below).
        const cssViewport = page.getViewport({ scale })
        // User-space page size = CSS size / scale. Derived from the viewport
        // (not page.view) so rotated pages stay consistent with the transform
        // every conversion and the overlay viewBox rely on.
        setPageKind(cached.kind)
        setPageInfo(
          cached.kind === 'text'
            ? { page, cssViewport, textContent: cached.textContent }
            : null
        )
        setPageDims({
          userWidth: cssViewport.width / cssViewport.scale,
          userHeight: cssViewport.height / cssViewport.scale,
          cssWidth: cssViewport.width,
          cssHeight: cssViewport.height,
        })

        const canvas = canvasRef.current
        if (cancelled || !canvas) {
          await page.cleanup()
          return
        }
        // Render at device resolution, lay out at CSS resolution (v6 has no
        // maxCanvasPixels cap — clamp the multiplier instead). The canvas
        // bitmap may floor to integers; its CSS box is 100% of the wrapper,
        // which carries the exact CSS viewport size.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: scale * dpr })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const task = page.render({ canvas, viewport })
        renderTask = task
        await task.promise
        await page.cleanup()
      } catch {
        // Cancelled renders and transient failures are non-fatal; the next
        // interaction re-renders.
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, status, currentPage, scale])

  // Track the mounted TextLayer container element (PageTextLayer owns its
  // DOM) — the selection toolbar scopes to it. pageInfo changes exactly when
  // the layer mounts/unmounts (page turn, text→scan), so a post-commit query
  // is sufficient.
  useEffect(() => {
    if (!pageInfo) {
      setTextLayerEl(null)
      return
    }
    setTextLayerEl(
      pageWrapperRef.current?.querySelector<HTMLElement>('[data-testid="pdf-text-layer"]') ?? null
    )
  }, [pageInfo])

  // A page turn invalidates any open hover card — its anchor rect and row
  // live on the old page; without this, returning to that page would pop the
  // stale card back open.
  useEffect(() => {
    clearHoverTimers()
    setHoverOpen(false)
    setHover(null)
    setHoverPinned(false)
  }, [currentPage, clearHoverTimers])

  const zoomIn = () => setScale((s) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(s) + 1)] ?? s)
  const zoomOut = () => setScale((s) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(s) - 1)] ?? s)

  const entryKey = useCallback((entry: PdfOutlineEntry, index: number) => `${index}:${entry.pageNumber}:${entry.title}`, [])

  const activeEntryIndex = useMemo(
    () => (activeKey == null ? -1 : Number(activeKey.split(':')[0])),
    [activeKey]
  )
  const activeAnalysis = activeKey != null ? analysisByKey[activeKey] : undefined
  const activeEntry = activeEntryIndex >= 0 && outline ? outline[activeEntryIndex] : undefined

  const analyzeSection = useCallback(
    async (entry: PdfOutlineEntry, index: number) => {
      if (!doc || entry.pageNumber == null || analysis.isAnalyzing) return
      const key = entryKey(entry, index)
      if (emptyTextKeys[key]) return // scanned page range: nothing to analyze
      setActiveKey(key)
      setErrorKey(null)

      // Section text runs from this entry's start page to the page before
      // the next sibling/shallower entry (pure helper, unit-tested).
      const startPage = entry.pageNumber
      const endPage = sectionEndPage(outline ?? [], index, doc.numPages)
      const sectionText = await extractPagesText(doc, startPage, endPage)

      if (!mountedRef.current) return
      if (!sectionText) {
        // Scanned section (no text layer): disable further attempts, no LLM call.
        setEmptyTextKeys((prev) => ({ ...prev, [key]: true }))
        return
      }

      setAnalyzingKey(key)
      void analysis.submit({
        key,
        sourceId,
        sectionTitle: entry.title,
        sectionText,
        pageStart: startPage,
        pageEnd: endPage,
      })
    },
    [doc, outline, analysis, emptyTextKeys, entryKey, sourceId]
  )

  // ── Annotation data flow ────────────────────────────────────────────────

  // Current-page rows (server rows + any optimistic rows the hook painted
  // into the page cache). Referentially stable across unrelated re-renders.
  const pageAnnotations = annotations.currentPageAnnotations
  // The hook's optimistic create (stable identity) — captured for the serial
  // submit queue below.
  const createAnnotation = annotations.create

  // Orphaned detection (PDR-003 ruling 16): one full-source fetch when the
  // document is ready, then the per-row check is O(1) — flattened page vs
  // doc.numPages. The hook's own orphanedAnnotations is window-limited
  // (current ± buffer pages) and can never surface an over-range row on its
  // own, so the viewer does this single unfiltered fetch. Best-effort: an
  // API failure just leaves the hint hidden.
  useEffect(() => {
    if (!doc || status !== 'ready' || !sourceId) return
    let cancelled = false
    setOrphanedCount(0)
    sourceAnnotationsApi
      .list(sourceId)
      .then((rows) => {
        if (cancelled) return
        setOrphanedCount(rows.filter((row) => row.page != null && row.page > doc.numPages).length)
      })
      .catch(() => {
        // The orphaned hint is an enhancement, not a gate.
      })
    return () => {
      cancelled = true
    }
  }, [doc, status, sourceId])

  /** Cache-only sync for hover-card mutations. The card performs its own API
   * calls with its own toasts (single-door rule from use-annotations: never
   * route one action through both); these handlers only mirror the outcome
   * into the per-page query caches. */
  const writeAnnotationToCache = useCallback(
    (annotation: SourceAnnotation) => {
      for (const page of annotations.loadedPages) {
        queryClient.setQueryData<SourceAnnotation[]>(annotationsPageKey(sourceId, page), (prev) =>
          prev?.some((row) => row.id === annotation.id)
            ? prev.filter((row) => row.id !== annotation.id)
            : prev
        )
      }
      if (annotation.page != null) {
        queryClient.setQueryData<SourceAnnotation[]>(
          annotationsPageKey(sourceId, annotation.page),
          (prev) =>
            sortPageAnnotations([...(prev ?? []).filter((row) => row.id !== annotation.id), annotation])
        )
      }
    },
    [annotations.loadedPages, queryClient, sourceId]
  )

  const removeAnnotationFromCache = useCallback(
    (id: string) => {
      for (const page of annotations.loadedPages) {
        queryClient.setQueryData<SourceAnnotation[]>(annotationsPageKey(sourceId, page), (prev) =>
          prev?.some((row) => row.id === id) ? prev.filter((row) => row.id !== id) : prev
        )
      }
    },
    [annotations.loadedPages, queryClient, sourceId]
  )

  /** Viewport-coordinate rect covering a set of user-space quads — the hover
   * card's virtual anchor (quadToDomRect is wrapper-relative; offset by the
   * wrapper's client rect to reach fixed/viewport coordinates). */
  const anchorRectFromQuads = useCallback(
    (quads: Quad[]): AnchorRect | null => {
      const wrapper = pageWrapperRef.current
      if (!wrapper || !pageInfo || quads.length === 0) return null
      const wrapperRect = wrapper.getBoundingClientRect()
      const domRects = quads.map((quad) => quadToDomRect(quad, pageInfo.cssViewport))
      const left = Math.min(...domRects.map((r) => r.left)) + wrapperRect.left
      const top = Math.min(...domRects.map((r) => r.top)) + wrapperRect.top
      const right = Math.max(...domRects.map((r) => r.left + r.width)) + wrapperRect.left
      const bottom = Math.max(...domRects.map((r) => r.top + r.height)) + wrapperRect.top
      return { left, top, width: right - left, height: bottom - top }
    },
    [pageInfo]
  )

  const anchorRectForAnnotation = useCallback(
    (annotation: SourceAnnotation): AnchorRect | null =>
      annotation.pdf_anchor?.quads ? anchorRectFromQuads(annotation.pdf_anchor.quads) : null,
    [anchorRectFromQuads]
  )

  /** Open the card for an annotation id at a precomputed anchor rect —
   * preview (underline hover) or pinned edit state (comment flow). */
  const openHoverCard = useCallback(
    (id: string, rect: AnchorRect, pinned: boolean) => {
      clearHoverTimers()
      setHover({ id, rect })
      setHoverPinned(pinned)
      setHoverOpen(true)
    },
    [clearHoverTimers]
  )

  // Overlay hover → card open/close choreography (AnnotationHoverCard
  // visibility protocol: 150ms open delay, 300ms close grace).
  const handleOverlayHover = useCallback(
    (id: string) => {
      const annotation = pageAnnotations.find((row) => row.id === id)
      if (!annotation || !pageInfo) return
      if (hoverCloseTimerRef.current != null) {
        window.clearTimeout(hoverCloseTimerRef.current)
        hoverCloseTimerRef.current = null
      }
      if (hoverOpen && hover?.id === id) {
        // Already showing: refresh the anchor rect (zoom may have moved it).
        const rect = anchorRectForAnnotation(annotation)
        if (rect) setHover((prev) => (prev ? { ...prev, rect } : prev))
        return
      }
      if (hoverOpenTimerRef.current != null) window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = window.setTimeout(() => {
        hoverOpenTimerRef.current = null
        const rect = anchorRectForAnnotation(annotation)
        if (!rect) return
        setHover({ id, rect })
        setHoverPinned(false)
        setHoverOpen(true)
      }, ANNOTATION_HOVER_TIMING.openDelayMs)
    },
    [pageAnnotations, pageInfo, hover?.id, hoverOpen, anchorRectForAnnotation]
  )

  const handleOverlayLeave = useCallback(() => {
    if (hoverOpenTimerRef.current != null) {
      window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = null
    }
    // A pinned (editing) card stays up regardless of the pointer (§3.7).
    if (!hoverPinnedRef.current) scheduleHoverClose()
  }, [scheduleHoverClose])

  /** Selection → anchors → serial optimistic submit (via use-annotations'
   * create, which paints the optimistic row and owns the failure toast +
   * rollback). Rejects over-length quotes (>5000 chars, the quote must stay
   * verbatim) and selections that leave the current page's text layer
   * (cross-page, plan §3.5) with explicit toasts — never a silent
   * truncation. `openPinned` (the [批注] entry) opens the hover card straight
   * into the pinned edit state once the row has landed. */
  const createAnnotationFromSelection = useCallback(
    (color: AnnotationColor, lineStyle: AnnotationLineStyle, openPinned: boolean) => {
      const wrapper = pageWrapperRef.current
      const container = textLayerEl ?? wrapper
      const selection = typeof window !== 'undefined' ? window.getSelection() : null
      if (!pageInfo || !wrapper || !container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return
      }
      // Cross-page guard: every boundary of the selection must live inside
      // the current page's text layer (the single-page viewer cannot anchor
      // anything else; plan §3.5 "跨页内容请分段标注").
      const insideContainer = (node: Node | null): boolean =>
        node != null && (node === container || container.contains(node))
      if (
        !insideContainer(selection.anchorNode) ||
        !insideContainer(selection.focusNode)
      ) {
        toast.error(t('sources.annotations.toast.crossPage'))
        return
      }

      // Selection rects, re-based to the page wrapper (rectsToQuads expects
      // wrapper-relative CSS-pixel rects and the dpr-free viewport).
      const wrapperRect = wrapper.getBoundingClientRect()
      const rects: DomRectLike[] = []
      for (let i = 0; i < selection.rangeCount; i++) {
        for (const rect of selection.getRangeAt(i).getClientRects()) {
          rects.push({
            left: rect.left - wrapperRect.left,
            top: rect.top - wrapperRect.top,
            width: rect.width,
            height: rect.height,
          })
        }
      }
      const quads = rectsToQuads(rects, pageInfo.cssViewport)
      if (quads.length === 0) return

      const textAnchorOrError = textAnchorFromSelection(selection, container)
      if (textAnchorOrError && 'error' in textAnchorOrError && textAnchorOrError.error === 'too_long') {
        toast.error(t('sources.annotations.toast.tooLong'))
        return
      }
      let textAnchor: TextAnchor | null = null
      let quote: string | null = null
      if (textAnchorOrError && !('error' in textAnchorOrError)) {
        textAnchor = textAnchorOrError
        quote = textAnchor.quote
      } else {
        // Selection inside the container but not inside text spans (rare):
        // fall back to the plain selection text as the quote snapshot.
        const fallback = quoteFromSelectionText(selection.toString())
        if (typeof fallback === 'object') {
          toast.error(t('sources.annotations.toast.tooLong'))
          return
        }
        quote = fallback
      }

      const input: SourceAnnotationCreateInput = {
        source_id: sourceId,
        color,
        line_style: lineStyle,
        body: null,
        quote,
        text_anchor: textAnchor,
        pdf_anchor: { page: currentPage, quads },
      }
      // The card anchor rect is computed from the same quads now (the
      // selection is about to be superseded) and reused when the row lands.
      const anchorRect = openPinned ? anchorRectFromQuads(quads) : null

      // Serial queue (plan §3.5 快速连续标注): each create is optimistic in
      // the page cache the moment it runs, but POSTs never overlap. The hook
      // owns rollback + the createFailed toast; the queue only sequences.
      submitQueueRef.current = submitQueueRef.current
        .then(async () => {
          const created = await createAnnotation(input)
          if (openPinned && anchorRect && mountedRef.current) {
            // 落标后立即打开该标注的 pin 态批注卡（plan §3.1 [批注]）。
            openHoverCard(created.id, anchorRect, true)
          }
        })
        .catch(() => {
          // Hook already toasted + rolled the optimistic row back; a pinned
          // card that was pointing at it simply unmounts with the row.
        })
    },
    [
      pageInfo,
      textLayerEl,
      currentPage,
      sourceId,
      t,
      createAnnotation,
      anchorRectFromQuads,
      openHoverCard,
    ]
  )

  if (!open) return null

  const hoverAnnotation = hover ? pageAnnotations.find((row) => row.id === hover.id) : undefined

  // Overlay rows for the current page: persisted + optimistic annotations
  // that carry a PDF anchor here.
  const overlayAnnotations: OverlayAnnotation[] = pageAnnotations
    .filter((row) => row.pdf_anchor?.quads?.length)
    .map((row) => ({
      id: row.id,
      color: row.color,
      lineStyle: row.line_style,
      quads: row.pdf_anchor!.quads,
    }))

  // Shared toolbar/body/save-dialog markup — wrapped by the shell below.
  const viewerBody = (
    <>
        {/* Toolbar */}
        <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setOutlineOpen((v) => !v)}
            aria-label={t('sources.pdfViewer.outline')}
            title={t('sources.pdfViewer.outline')}
            data-testid="pdf-outline-toggle"
            disabled={status !== 'ready'}
          >
            <List className="h-4 w-4" />
            <span className="hidden text-xs sm:inline">{t('sources.pdfViewer.outline')}</span>
          </Button>
          <div className="mx-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={status !== 'ready' || currentPage <= 1}
              aria-label={t('sources.pdfViewer.prevPage')}
              title={t('sources.pdfViewer.prevPage')}
              data-testid="pdf-prev"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-24 text-center text-xs tabular-nums text-muted-foreground">
              {status === 'ready' && totalPages > 0
                ? t('sources.pdfViewer.page', { page: currentPage, total: totalPages })
                : ''}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={status !== 'ready' || currentPage >= totalPages}
              aria-label={t('sources.pdfViewer.nextPage')}
              title={t('sources.pdfViewer.nextPage')}
              data-testid="pdf-next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={zoomOut}
              disabled={status !== 'ready' || scale <= ZOOM_STEPS[0]}
              aria-label={t('sources.pdfViewer.zoomOut')}
              title={t('sources.pdfViewer.zoomOut')}
              data-testid="pdf-zoom-out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={zoomIn}
              disabled={status !== 'ready' || scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              aria-label={t('sources.pdfViewer.zoomIn')}
              title={t('sources.pdfViewer.zoomIn')}
              data-testid="pdf-zoom-in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Page-level annotation notices (below the toolbar, plan §3.1).
            Scanned pages: no text layer → no selection toolbar; the persistent
            role="status" notice explains why (only on the selection-first
            branch — ANNOTATION_SELECTION_MAIN_PATH, F1 ruling). */}
        {status === 'ready' && pageKind === 'scan' && ANNOTATION_SELECTION_MAIN_PATH && (
          <div className="shrink-0 border-b px-3 py-2">
            <ScanPageNotice />
          </div>
        )}
        {status === 'ready' && orphanedCount > 0 && (
          <div
            role="status"
            data-testid="annotation-orphaned-hint"
            className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
          >
            {t('sources.annotations.orphanedHint')}
          </div>
        )}

        {/* Body */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Floating outline panel — overlays the page instead of squeezing
              the canvas width (WPS-style). */}
          {status === 'ready' && outlineOpen && (
            <aside
              className="absolute bottom-0 left-0 top-0 z-10 flex w-64 flex-col border-r bg-background/95 shadow-xl backdrop-blur-sm"
              data-testid="pdf-outline"
              aria-label={t('sources.pdfViewer.outline')}
            >
              <div className="flex h-9 shrink-0 items-center justify-between border-b px-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('sources.pdfViewer.outline')}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setOutlineOpen(false)}
                  aria-label={t('sources.pdfViewer.close')}
                  title={t('sources.pdfViewer.close')}
                  data-testid="pdf-outline-close"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {parsingToc ? (
                  <div className="flex items-center gap-2 px-2 py-6 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('sources.pdfViewer.parsingToc')}
                  </div>
                ) : !outline || outline.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {t('sources.pdfViewer.noOutline')}
                  </p>
                ) : (
                  outline.map((entry, index) => {
                    const key = entryKey(entry, index)
                    const isAnalyzing = analyzingKey === key
                    return (
                      <div
                        key={key}
                        className="group flex items-start gap-1 rounded px-1 py-0.5 hover:bg-accent/50"
                        style={{ paddingLeft: `${8 + entry.depth * 12}px` }}
                      >
                        {entry.pageNumber != null ? (
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left text-xs text-foreground/90 hover:text-primary hover:underline"
                            onClick={() => setCurrentPage(entry.pageNumber as number)}
                            title={entry.title}
                          >
                            <FileText className="mr-1 inline h-3 w-3 text-muted-foreground" />
                            {entry.title}
                          </button>
                        ) : entry.url ? (
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground hover:text-primary hover:underline"
                            title={entry.title}
                          >
                            <Link2 className="mr-1 inline h-3 w-3" />
                            {entry.title}
                          </a>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={entry.title}>
                            {entry.title}
                          </span>
                        )}
                        <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 text-muted-foreground hover:text-primary"
                      onClick={() => void analyzeSection(entry, index)}
                      disabled={
                        entry.pageNumber == null ||
                        analysis.isAnalyzing ||
                        !!emptyTextKeys[key] ||
                        isAnalyzing
                      }
                      aria-label={t('sources.fileView.analyzeSection')}
                      title={
                        emptyTextKeys[key]
                          ? t('sources.noContent')
                          : t('sources.fileView.analyzeSection')
                      }
                      data-testid={`pdf-analyze-${index}`}
                    >
                      {isAnalyzing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                    </Button>
                      </div>
                    )
                  })
                )}
              </div>
            </aside>
          )}

          {/* Canvas / status area */}
          <div className="flex min-w-0 flex-1 items-start justify-center overflow-auto bg-muted/30 p-4">
            {status === 'loading' && (
              <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('sources.pdfViewer.loading')}
              </div>
            )}
            {status === 'notPdf' && (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                {t('sources.pdfViewer.notPdf')}
              </div>
            )}
            {status === 'failed' && (
              <div className="flex h-full w-full items-center justify-center text-sm text-destructive">
                {t('sources.pdfViewer.loadFailed')}
              </div>
            )}
            {status === 'ready' && (
              <div
                ref={pageWrapperRef}
                data-testid="pdf-page-wrapper"
                className="relative shrink-0 rounded shadow-md"
                style={
                  pageDims ? { width: pageDims.cssWidth, height: pageDims.cssHeight } : undefined
                }
              >
                <canvas
                  ref={canvasRef}
                  className="h-full w-full rounded"
                  data-testid="pdf-canvas"
                  aria-label={t('sources.pdfViewer.title')}
                />
                {pageInfo && (
                  <PageTextLayer
                    page={pageInfo.page}
                    cssViewport={pageInfo.cssViewport}
                    textContent={pageInfo.textContent}
                  />
                )}
                {pageInfo && pageDims && overlayAnnotations.length > 0 && (
                  <AnnotationSvgOverlay
                    annotations={overlayAnnotations}
                    userWidth={pageDims.userWidth}
                    userHeight={pageDims.userHeight}
                    cssWidth={pageDims.cssWidth}
                    cssHeight={pageDims.cssHeight}
                    activeId={hoverOpen ? (hover?.id ?? null) : null}
                    onHover={handleOverlayHover}
                    onLeave={handleOverlayLeave}
                  />
                )}
              </div>
            )}
          </div>

          {/* AI analysis panel */}
          {status === 'ready' && activeKey != null && activeEntry && (
            <aside
              className="w-80 min-w-[280px] shrink-0 overflow-y-auto border-l p-3"
              data-testid="pdf-analysis-panel"
            >
              {errorKey === activeKey && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-destructive">{t('sources.fileView.analysisFailed')}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => void analyzeSection(activeEntry, activeEntryIndex)}
                    disabled={analysis.isAnalyzing || !!emptyTextKeys[activeKey]}
                    aria-label={t('sources.fileView.analyzeSection')}
                    title={t('sources.fileView.analyzeSection')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              {emptyTextKeys[activeKey] && !errorKey && (
                <p className="text-xs text-muted-foreground">{t('sources.noContent')}</p>
              )}
              {analyzingKey === activeKey &&
                analysis.activeJob?.key !== activeKey && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('sources.fileView.analyzing')}
                  </div>
                )}
              {analyzingKey === activeKey &&
                analysis.activeJob?.key === activeKey && (
                  <div data-testid="pdf-analysis-live">
                    <TaskLiveInspector
                      embedded
                      variant="compact"
                      job={{
                        jobId: analysis.activeJob.jobId,
                        commandName: 'analyze_source_section',
                        type: 'section_analysis',
                      }}
                    />
                  </div>
                )}
              {activeAnalysis && (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-medium">
                      {t('sources.fileView.analysisTitle', { title: activeEntry.title })}
                    </h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                      onClick={() => setActiveKey(null)}
                      aria-label={t('sources.pdfViewer.close')}
                      title={t('sources.pdfViewer.close')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {activeAnalysis.truncated && (
                    <p className="mb-2 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
                      {t('sources.fileView.analysisTruncated')}
                    </p>
                  )}
                  <div className="prose prose-sm max-w-none text-sm">
                    <MarkdownRenderer>{activeAnalysis.markdown}</MarkdownRenderer>
                  </div>
                  {/* Only when a notebook context is known (classic page hides
                      it — the save dialog needs a notebook target). Goes through
                      SaveNoteDialog so the empty-title LLM guard applies. */}
                  {notebookId && (
                    <div className="mt-3 border-t pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        onClick={() => setSaveDialogOpen(true)}
                        data-testid="pdf-save-analysis"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {t('sources.fileView.saveAnalysis')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </aside>
          )}
        </div>

        {/* Selection floating toolbar (fixed-position; arms only when a text
            layer container exists — scanned pages route to the notice above). */}
        {status === 'ready' && (
          <SelectionToolbar
            containerEl={textLayerEl}
            defaultColor={defaultColor}
            defaultLineStyle={defaultLineStyle}
            onAnnotate={(color, lineStyle) => createAnnotationFromSelection(color, lineStyle, false)}
            onCommentRequest={(color, lineStyle) => createAnnotationFromSelection(color, lineStyle, true)}
            onDefaultsChange={({ lineStyle }) => setDefaultLineStyle(lineStyle)}
          />
        )}

        {/* Hover annotation card (portal-rendered by Radix; anchored on the
            underline's viewport rect). The card performs its own API calls;
            these handlers only mirror outcomes into the page caches. */}
        {status === 'ready' && hover && hoverAnnotation && (
          <AnnotationHoverCard
            annotation={hoverAnnotation}
            anchorRect={hover.rect}
            open={hoverOpen}
            onOpenChange={(next) => {
              if (next) {
                setHoverOpen(true)
              } else {
                clearHoverTimers()
                setHoverOpen(false)
                setHover(null)
                setHoverPinned(false)
              }
            }}
            defaultPinned={hoverPinned}
            onPinnedChange={setHoverPinned}
            onCardPointerEnter={() => {
              if (hoverCloseTimerRef.current != null) {
                window.clearTimeout(hoverCloseTimerRef.current)
                hoverCloseTimerRef.current = null
              }
            }}
            onCardPointerLeave={() => {
              // Pinned (editing) cards ignore the grace — only Esc or an
              // outside click closes them (plan §3.7 layered exit).
              if (!hoverPinnedRef.current) scheduleHoverClose()
            }}
            onUpdated={writeAnnotationToCache}
            onDeleted={(annotation) => removeAnnotationFromCache(annotation.id)}
            onRestored={writeAnnotationToCache}
          />
        )}

        {/* Save-as-note dual-mode dialog (defaults to note mode here). */}
        {notebookId && (
          <SaveNoteDialog
            open={saveDialogOpen}
            onOpenChange={setSaveDialogOpen}
            content={activeAnalysis?.markdown ?? ''}
            notebookId={notebookId}
            initialMode="note"
          />
        )}
    </>
  )

  // Embedded in the content pane: same chrome, no dialog shell.
  if (inline) {
    return (
      <div
        className="flex h-[calc(100vh-16rem)] min-h-[480px] flex-col overflow-hidden rounded-md border"
        data-testid="pdf-viewer-inline"
      >
        {viewerBody}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] sm:max-w-5xl h-[90vh] max-h-[90vh] overflow-hidden p-0 flex flex-col gap-0"
        data-testid="pdf-viewer-dialog"
      >
        <DialogTitle className="sr-only">{t('sources.pdfViewer.title')}</DialogTitle>
        {viewerBody}
      </DialogContent>
    </Dialog>
  )
}

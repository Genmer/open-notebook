/**
 * F11 — end-to-end integration tests for the source-annotation flow
 * (source-annotation-mvp-tasks.md §F11). Only ONE module is mocked:
 * `@/lib/api/source-annotations` — every component (SelectionToolbar,
 * AnnotationSvgOverlay, AnnotationHoverCard, ScanPageNotice), the
 * use-annotations hook, react-query and the annotation-anchor pure functions
 * run real code.
 *
 * The API mock is backed by a tiny in-memory "server" (rows per page), so a
 * fresh mount genuinely re-reads what `create` wrote — that is case 1's
 * persistence assertion: the only road back to the overlay is `list()`.
 *
 * The harness below mirrors the real caller wiring in
 * PdfSourceViewer.tsx (createAnnotationFromSelection :663, hover
 * choreography :627, cache mirroring :550) minus pdf.js: the "text layer" is
 * plain spans, jsdom's zero-size rects are stubbed on a real Range, and the
 * page model is US Letter 612×792 at zoom 1.25 (CSS 765×990, the dpr-free
 * CSS viewport the anchor contract mandates).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import SelectionToolbar, { SELECTION_TOOLBAR_TIMING } from '../SelectionToolbar'
import AnnotationHoverCard, {
  ANNOTATION_HOVER_TIMING,
  type AnchorRect,
} from '../AnnotationHoverCard'
import AnnotationSvgOverlay, { type OverlayAnnotation } from '../AnnotationSvgOverlay'
import ScanPageNotice from '../ScanPageNotice'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  annotationsPageKey,
  sortPageAnnotations,
  useAnnotations,
} from '@/lib/hooks/use-annotations'
import type {
  AnnotationColor,
  AnnotationLineStyle,
  SourceAnnotation,
  SourceAnnotationCreateInput,
  SourceAnnotationPatch,
} from '@/lib/api/source-annotations'
import {
  MAX_QUOTE_CHARS,
  quadToDomRect,
  quoteFromSelectionText,
  rectsToQuads,
  textAnchorFromSelection,
  type DomRectLike,
  type Quad,
  type TextAnchor,
  type ViewportLike,
} from '@/lib/pdf/annotation-anchor'

// ─── Mocked API layer ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
  /** In-memory server state: annotation rows keyed by flattened page. */
  pages: new Map<number, SourceAnnotation[]>(),
  seq: 0,
  toast: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/api/source-annotations', () => ({
  ANNOTATION_COLORS: ['gold', 'fern', 'plum', 'slate', 'clay'],
  ANNOTATION_LINE_STYLES: ['wavy', 'straight'],
  sourceAnnotationsApi: mocks.api,
}))

// Neutral sonner: the callable (delete-undo toast) and toast.error (guards)
// are assertable; every other channel is a no-op.
vi.mock('sonner', () => ({
  toast: Object.assign((...args: unknown[]) => mocks.toast(...args), {
    success: vi.fn(),
    error: (...args: unknown[]) => mocks.toastError(...args),
    info: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn(),
  }),
}))

// ─── In-memory server ────────────────────────────────────────────────────────

const NOW = '2026-10-03T00:00:00.000Z'
const SOURCE_ID = 'source:flow'

function serverRows(): SourceAnnotation[] {
  return [...mocks.pages.values()].flat()
}

function seedServer(row: SourceAnnotation): void {
  const page = row.page ?? 0
  mocks.pages.set(page, [...(mocks.pages.get(page) ?? []), structuredClone(row)])
}

// ─── Page model ──────────────────────────────────────────────────────────────

// US Letter, zoom 1.25. domRectToQuad math for the stubbed line rects:
//   x = left/1.25 · y = (990 − top − height)/1.25 …
const USER_W = 612
const USER_H = 792
const SCALE = 1.25
const CSS_W = USER_W * SCALE
const CSS_H = USER_H * SCALE
const CSS_VIEWPORT: ViewportLike = { height: CSS_H, scale: SCALE }

const LINE_1 = 'Revenue recognized from converged services grew thirty-one percent '
const LINE_2 = 'driven by enterprise demand and annualized contracts.'

const DEFAULT_TEXT_LAYER = (
  <>
    <span data-testid="text-line-1">{LINE_1}</span>
    <span data-testid="text-line-2">{LINE_2}</span>
  </>
)

// ─── Selection stubbing (same pattern as SelectionToolbar.test.tsx) ─────────

/** Plain object cast to DOMRect — the code under test reads the 4 edges. */
function stubRect({ top, left, width, height }: DomRectLike): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * Point `window.getSelection()` at a stubbed selection built on a REAL Range
 * over the harness text layer: the toolbar reads range.getBoundingClientRect,
 * the caller reads range.getClientRects, and textAnchorFromSelection reads
 * the anchor/focus boundaries — all from this one object.
 */
function stubSelection(options: {
  anchorNode: Node
  anchorOffset: number
  focusNode: Node
  focusOffset: number
  lineRects: DomRectLike[]
  selectedText: string
}): void {
  const range = document.createRange()
  range.setStart(options.anchorNode, options.anchorOffset)
  range.setEnd(options.focusNode, options.focusOffset)
  const first = options.lineRects[0]
  range.getBoundingClientRect = () => stubRect(first)
  range.getClientRects = () => options.lineRects.map((r) => stubRect(r)) as unknown as DOMRectList
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: options.anchorNode,
    anchorOffset: options.anchorOffset,
    focusNode: options.focusNode,
    focusOffset: options.focusOffset,
    getRangeAt: () => range,
    toString: () => options.selectedText,
  } as unknown as Selection)
}

// ─── Harness: the caller wiring PdfSourceViewer.tsx performs, minus pdf.js ──

type PageKind = 'text' | 'scan'

interface FlowHarnessProps {
  sourceId?: string
  currentPage?: number
  totalPages?: number
  pageKind?: PageKind
  textLayer?: ReactNode
}

function AnnotationFlowHarness({
  sourceId = SOURCE_ID,
  currentPage = 3,
  totalPages = 10,
  pageKind = 'text',
  textLayer = DEFAULT_TEXT_LAYER,
}: FlowHarnessProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const annotations = useAnnotations({ sourceId, currentPage, totalPages })
  const pageAnnotations = annotations.currentPageAnnotations
  const createAnnotation = annotations.create

  const [textLayerEl, setTextLayerEl] = useState<HTMLDivElement | null>(null)
  const [defaultColor] = useState<AnnotationColor>('gold')
  const [defaultLineStyle, setDefaultLineStyle] = useState<AnnotationLineStyle>('wavy')

  // Hover-card choreography (AnnotationHoverCard visibility protocol).
  const [hover, setHover] = useState<{ id: string; rect: AnchorRect } | null>(null)
  const [hoverOpen, setHoverOpen] = useState(false)
  const [hoverPinned, setHoverPinned] = useState(false)
  const hoverOpenTimerRef = useRef<number | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)

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

  useEffect(() => () => clearHoverTimers(), [clearHoverTimers])

  // Cache mirroring for hover-card mutations (single-door rule: the card owns
  // the API calls; these only reflect outcomes into the per-page caches).
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

  /** Viewport rect covering user-space quads. jsdom's wrapper client rect is
   * (0,0), so the wrapper offset the real caller adds is a no-op here. */
  const anchorRectFromQuads = useCallback((quads: Quad[]): AnchorRect | null => {
    if (quads.length === 0) return null
    const domRects = quads.map((quad) => quadToDomRect(quad, CSS_VIEWPORT))
    const left = Math.min(...domRects.map((r) => r.left))
    const top = Math.min(...domRects.map((r) => r.top))
    const right = Math.max(...domRects.map((r) => r.left + r.width))
    const bottom = Math.max(...domRects.map((r) => r.top + r.height))
    return { left, top, width: right - left, height: bottom - top }
  }, [])

  const openHoverCard = useCallback(
    (id: string, rect: AnchorRect, pinned: boolean) => {
      clearHoverTimers()
      setHover({ id, rect })
      setHoverPinned(pinned)
      setHoverOpen(true)
    },
    [clearHoverTimers]
  )

  const handleOverlayHover = useCallback(
    (id: string) => {
      const annotation = pageAnnotations.find((row) => row.id === id)
      if (!annotation) return
      if (hoverCloseTimerRef.current != null) {
        window.clearTimeout(hoverCloseTimerRef.current)
        hoverCloseTimerRef.current = null
      }
      if (hoverOpenTimerRef.current != null) window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = window.setTimeout(() => {
        hoverOpenTimerRef.current = null
        const rect = anchorRectFromQuads(annotation.pdf_anchor?.quads ?? [])
        if (!rect) return
        setHover({ id, rect })
        setHoverPinned(false)
        setHoverOpen(true)
      }, ANNOTATION_HOVER_TIMING.openDelayMs)
    },
    [pageAnnotations, anchorRectFromQuads]
  )

  const handleOverlayLeave = useCallback(() => {
    if (hoverOpenTimerRef.current != null) {
      window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = null
    }
    if (hoverCloseTimerRef.current != null) window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null
      setHoverOpen(false)
    }, ANNOTATION_HOVER_TIMING.closeGraceMs)
  }, [])

  /** Selection → anchors → optimistic create via use-annotations (mirrors
   * PdfSourceViewer.createAnnotationFromSelection, minus the serial queue).
   * Rejects over-length quotes with a toast instead of truncating. */
  const createAnnotationFromSelection = useCallback(
    (color: AnnotationColor, lineStyle: AnnotationLineStyle, openPinned: boolean) => {
      const container = textLayerEl
      const selection = typeof window !== 'undefined' ? window.getSelection() : null
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return
      }
      const insideContainer = (node: Node | null): boolean =>
        node != null && (node === container || container.contains(node))
      if (!insideContainer(selection.anchorNode) || !insideContainer(selection.focusNode)) {
        return
      }

      const wrapperRect = (container.parentElement ?? container).getBoundingClientRect()
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
      const quads = rectsToQuads(rects, CSS_VIEWPORT)
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
      const anchorRect = openPinned ? anchorRectFromQuads(quads) : null
      void createAnnotation(input)
        .then((created) => {
          if (openPinned && anchorRect) openHoverCard(created.id, anchorRect, true)
        })
        .catch(() => {
          // The hook already toasted + rolled the optimistic row back.
        })
    },
    [textLayerEl, sourceId, currentPage, t, createAnnotation, anchorRectFromQuads, openHoverCard]
  )

  const overlayAnnotations: OverlayAnnotation[] = pageAnnotations
    .filter((row) => row.pdf_anchor?.quads?.length)
    .map((row) => ({
      id: row.id,
      color: row.color,
      lineStyle: row.line_style,
      quads: row.pdf_anchor?.quads as Quad[],
    }))

  const hoverAnnotation = hover ? pageAnnotations.find((row) => row.id === hover.id) : undefined

  return (
    <div data-testid="annotation-flow-root">
      {pageKind === 'scan' ? (
        <ScanPageNotice />
      ) : (
        <div
          data-testid="page-wrapper"
          style={{ position: 'relative', width: CSS_W, height: CSS_H }}
        >
          <div
            ref={setTextLayerEl}
            data-testid="page-text-layer"
            style={{ position: 'absolute', inset: 0 }}
          >
            {textLayer}
          </div>
          <AnnotationSvgOverlay
            annotations={overlayAnnotations}
            userWidth={USER_W}
            userHeight={USER_H}
            cssWidth={CSS_W}
            cssHeight={CSS_H}
            activeId={hoverOpen ? (hover?.id ?? null) : null}
            onHover={(id) => handleOverlayHover(id)}
            onLeave={() => handleOverlayLeave()}
          />
        </div>
      )}

      {pageKind === 'text' && (
        <SelectionToolbar
          containerEl={textLayerEl}
          defaultColor={defaultColor}
          defaultLineStyle={defaultLineStyle}
          onAnnotate={(color, lineStyle) => createAnnotationFromSelection(color, lineStyle, false)}
          onCommentRequest={(color, lineStyle) => createAnnotationFromSelection(color, lineStyle, true)}
          onDefaultsChange={({ lineStyle }) => setDefaultLineStyle(lineStyle)}
        />
      )}

      {hover && hoverAnnotation && (
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
          onCardPointerEnter={() => {
            if (hoverCloseTimerRef.current != null) {
              window.clearTimeout(hoverCloseTimerRef.current)
              hoverCloseTimerRef.current = null
            }
          }}
          onCardPointerLeave={handleOverlayLeave}
          onUpdated={writeAnnotationToCache}
          onDeleted={(annotation) => removeAnnotationFromCache(annotation.id)}
          onRestored={writeAnnotationToCache}
        />
      )}
    </div>
  )
}

/** Fresh render = fresh react-query cache: only the in-memory server survives. */
function renderFlow(props?: FlowHarnessProps) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapped = (p: FlowHarnessProps) => (
    <QueryClientProvider client={queryClient}>
      <AnnotationFlowHarness {...p} />
    </QueryClientProvider>
  )
  const view = render(wrapped(props ?? {}))
  return { ...view, rerenderFlow: (next: FlowHarnessProps) => view.rerender(wrapped(next)) }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ─── Server bootstrap ────────────────────────────────────────────────────────

const seededRow: SourceAnnotation = {
  id: 'source_annotation:row-seed',
  source: SOURCE_ID,
  color: 'gold',
  line_style: 'wavy',
  body: null,
  quote: 'seeded quote',
  text_anchor: null,
  pdf_anchor: { page: 3, quads: [{ x1: 40, y1: 130.5, x2: 240, y2: 160.5 }] },
  display_position: null,
  page: 3,
  start_offset: null,
  created: NOW,
  updated: NOW,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.pages.clear()
  mocks.seq = 0

  mocks.api.list.mockImplementation(async (_sourceId: string, page?: number) =>
    structuredClone(page == null ? serverRows() : (mocks.pages.get(page) ?? []))
  )
  mocks.api.create.mockImplementation(async (input: SourceAnnotationCreateInput) => {
    mocks.seq += 1
    const row: SourceAnnotation = {
      id: `source_annotation:row-${mocks.seq}`,
      source: input.source_id,
      color: input.color,
      line_style: input.line_style,
      body: input.body ?? null,
      display_position: null,
      quote: input.quote ?? null,
      text_anchor: input.text_anchor ?? null,
      pdf_anchor: input.pdf_anchor ?? null,
      page: input.pdf_anchor?.page ?? null,
      start_offset: input.text_anchor?.start_offset ?? null,
      created: NOW,
      updated: NOW,
    }
    seedServer(row)
    return structuredClone(row)
  })
  mocks.api.update.mockImplementation(async (id: string, patch: SourceAnnotationPatch) => {
    for (const rows of mocks.pages.values()) {
      const index = rows.findIndex((row) => row.id === id)
      if (index === -1) continue
      rows[index] = { ...rows[index], ...patch, updated: NOW }
      return structuredClone(rows[index])
    }
    throw new Error(`update: unknown annotation ${id}`)
  })
  mocks.api.remove.mockImplementation(async (id: string) => {
    for (const [page, rows] of mocks.pages) {
      const index = rows.findIndex((row) => row.id === id)
      if (index === -1) continue
      rows.splice(index, 1)
      mocks.pages.set(page, rows)
      return
    }
    throw new Error(`remove: unknown annotation ${id}`)
  })
  mocks.api.getSettings.mockResolvedValue({
    id: 'open_notebook:annotation_settings',
    color_names: {},
  })
  mocks.api.saveSettings.mockResolvedValue({
    id: 'open_notebook:annotation_settings',
    color_names: {},
  })
})

// ─── Cases ───────────────────────────────────────────────────────────────────

describe('annotations flow (F11 integration)', () => {
  it('1 · selection → toolbar → use-annotations.create persists anchors → survives a fresh mount', async () => {
    // Two stubbed line rects (zoom 1.25, viewport height 990):
    const line1 = { left: 100, top: 200, width: 300, height: 16 }
    const line2 = { left: 60, top: 220, width: 240, height: 16 }

    const first = renderFlow()
    const line1Text = screen.getByTestId('text-line-1').firstChild as Text
    const line2Text = screen.getByTestId('text-line-2').firstChild as Text
    stubSelection({
      anchorNode: line1Text,
      anchorOffset: 0,
      focusNode: line2Text,
      focusOffset: LINE_2.length,
      lineRects: [line1, line2],
      selectedText: LINE_1 + LINE_2,
    })

    // mouseup → 150ms arm → the floating bar is up.
    fireEvent.mouseUp(document)
    expect(await screen.findByTestId('selection-toolbar')).toBeInTheDocument()

    // Color-dot click → one-step highlight with the current defaults.
    fireEvent.click(screen.getByTestId('selection-toolbar-color-gold'))
    // The bar hides at once so the next drag-select is never blocked.
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()

    await waitFor(() => expect(mocks.api.create).toHaveBeenCalledTimes(1))
    const payload = mocks.api.create.mock.calls[0][0] as SourceAnnotationCreateInput
    expect(payload.source_id).toBe(SOURCE_ID)
    expect(payload.color).toBe('gold')
    expect(payload.line_style).toBe('wavy')
    // pdf_anchor: one user-space quad per selected line (hand-computed
    // domRectToQuad values at scale 1.25 / height 990).
    expect(payload.pdf_anchor?.page).toBe(3)
    expect(payload.pdf_anchor?.quads).toEqual([
      { x1: 80, y1: 619.2, x2: 320, y2: 632 }, // (100,200,300×16) → 990−216=774/1.25
      { x1: 48, y1: 603.2, x2: 240, y2: 616 }, // (60,220,240×16) → 990−236=754/1.25
    ])
    // text_anchor: verbatim quote across both spans + absolute page offsets.
    expect(payload.text_anchor).toEqual({
      quote: LINE_1 + LINE_2,
      prefix: '',
      suffix: '',
      start_offset: 0,
      end_offset: LINE_1.length + LINE_2.length,
    })
    expect(payload.quote).toBe(LINE_1 + LINE_2)

    // The overlay paints the persisted row (the hook swapped its optimistic
    // row for the server row — id from the in-memory server).
    expect(await screen.findByTestId('anno-overlay-source_annotation:row-1')).toBeInTheDocument()

    // Persistence: unmount, then a FRESH mount with a fresh query cache —
    // the row must come back through list(), the only road to the overlay.
    first.unmount()
    renderFlow()
    expect(await screen.findByTestId('anno-overlay-source_annotation:row-1')).toBeInTheDocument()
    expect(mocks.api.list).toHaveBeenCalledWith(SOURCE_ID, 3)
  })

  it('2 · hover opens the card, pin edits color via update, Esc saves a dirty body first', async () => {
    seedServer(seededRow)
    renderFlow()

    const group = await screen.findByTestId('anno-overlay-source_annotation:row-seed')
    fireEvent.mouseEnter(group)

    // 150ms open delay (ANNOTATION_HOVER_TIMING.openDelayMs) → card appears.
    expect(await screen.findByTestId('annotation-hover-card')).toBeInTheDocument()
    expect(screen.getByTestId('annotation-hover-quote')).toHaveTextContent('seeded quote')

    // Pin the card into its edit state.
    fireEvent.click(screen.getByTestId('annotation-hover-edit'))
    expect(screen.getByTestId('annotation-hover-body-input')).toBeInTheDocument()

    // Color change while pinned → immediate update with just { color }.
    fireEvent.click(screen.getByTestId('annotation-hover-color-fern'))
    await waitFor(() =>
      expect(mocks.api.update).toHaveBeenCalledWith('source_annotation:row-seed', { color: 'fern' })
    )

    // Dirty body + Esc: the draft is committed before collapsing to preview.
    fireEvent.change(screen.getByTestId('annotation-hover-body-input'), {
      target: { value: 'note via esc' },
    })
    fireEvent.keyDown(screen.getByTestId('annotation-hover-card'), { key: 'Escape' })
    await waitFor(() =>
      expect(mocks.api.update).toHaveBeenLastCalledWith('source_annotation:row-seed', {
        body: 'note via esc',
      })
    )
    expect(screen.queryByTestId('annotation-hover-body-input')).not.toBeInTheDocument()
    // Layered exit: Esc collapsed the edit state, the card itself stays open.
    expect(screen.getByTestId('annotation-hover-card')).toBeInTheDocument()
  })

  it('3 · delete removes the row, the undo toast re-creates the original payload', async () => {
    seedServer(seededRow)
    renderFlow()

    fireEvent.mouseEnter(await screen.findByTestId('anno-overlay-source_annotation:row-seed'))
    await screen.findByTestId('annotation-hover-card')

    fireEvent.click(screen.getByTestId('annotation-hover-delete'))

    await waitFor(() =>
      expect(mocks.api.remove).toHaveBeenCalledWith('source_annotation:row-seed')
    )
    // Card closed and the underline left the overlay (cache mirror).
    await waitFor(() =>
      expect(screen.queryByTestId('annotation-hover-card')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('anno-overlay-source_annotation:row-seed')
      ).not.toBeInTheDocument()
    )

    // 8s undo toast offering the restore action.
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    const [message, options] = mocks.toast.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ]
    expect(message).toBe('sources.annotations.hover.deleted')
    expect(options.duration).toBe(ANNOTATION_HOVER_TIMING.undoToastMs)
    expect(options.action.label).toBe('sources.annotations.hover.undo')

    options.action.onClick()

    // Undo re-creates the annotation with the ORIGINAL payload.
    await waitFor(() => expect(mocks.api.create).toHaveBeenCalledTimes(1))
    expect(mocks.api.create).toHaveBeenCalledWith({
      source_id: SOURCE_ID,
      color: 'gold',
      line_style: 'wavy',
      body: null,
      quote: 'seeded quote',
      text_anchor: null,
      pdf_anchor: seededRow.pdf_anchor,
    })

    // The restored row (new id) repaints the overlay via onRestored.
    expect(await screen.findByTestId('anno-overlay-source_annotation:row-1')).toBeInTheDocument()
  })

  it('4 · lazy loading: the fetch window is currentPage ± 1 and turning requests only the new page', async () => {
    const view = renderFlow({ currentPage: 5, totalPages: 10 })

    await waitFor(() => {
      expect(new Set(mocks.api.list.mock.calls.map((call) => call[1]))).toEqual(
        new Set([4, 5, 6])
      )
    })

    // Turn one page: 5 and 6 stay fresh in cache → only page 7 is asked.
    view.rerenderFlow({ currentPage: 6, totalPages: 10 })
    await waitFor(() => {
      const pages = mocks.api.list.mock.calls.map((call) => call[1] as number)
      expect(new Set(pages)).toEqual(new Set([4, 5, 6, 7]))
      expect(pages).toHaveLength(4) // no page was requested twice
    })
  })

  it('5 · a 5001-char selection is rejected before create (too_long guard)', async () => {
    renderFlow({
      textLayer: <span data-testid="text-long">{'x'.repeat(MAX_QUOTE_CHARS + 1)}</span>,
    })

    const longText = screen.getByTestId('text-long').firstChild as Text
    stubSelection({
      anchorNode: longText,
      anchorOffset: 0,
      focusNode: longText,
      focusOffset: MAX_QUOTE_CHARS + 1,
      lineRects: [{ left: 100, top: 200, width: 300, height: 16 }],
      selectedText: 'x'.repeat(MAX_QUOTE_CHARS + 1),
    })

    fireEvent.mouseUp(document)
    expect(await screen.findByTestId('selection-toolbar')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('selection-toolbar-color-gold'))

    // textAnchorFromSelection returns { error: 'too_long' } → the caller
    // guard refuses to persist (the quote must stay verbatim) and surfaces
    // the rejection via the too-long toast key.
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('sources.annotations.toast.tooLong')
    )
    expect(mocks.api.create).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[data-testid^="anno-overlay-"]')).toHaveLength(0)
  })

  it("6 · scanned page: persistent notice renders, selection toolbar doesn't mount", async () => {
    renderFlow({ pageKind: 'scan' })

    expect(screen.getByRole('status')).toHaveAttribute('data-testid', 'scan-page-notice')
    expect(screen.getByTestId('scan-page-notice-text')).toBeInTheDocument()

    // No toolbar now, and none can appear: it is never mounted on scan pages.
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
    fireEvent.mouseUp(document)
    // Wrapped in act: react-query's page fetches land during this window.
    await act(async () => {
      await sleep(SELECTION_TOOLBAR_TIMING.armDelayMs + 100)
    })
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument()
  })
})

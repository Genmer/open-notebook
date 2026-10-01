'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
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
import { sourcesApi } from '@/lib/api/sources'
import { useSectionAnalysis } from '@/lib/hooks/use-section-analysis'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getPdfjs } from '@/lib/pdf/pdf-loader'
import {
  extractPagesText,
  flattenOutline,
  isPdfBuffer,
  sectionEndPage,
  type PdfOutlineEntry,
} from '@/lib/pdf/pdf-utils'

interface PdfSourceViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceId: string
  /** Original file path — drives the .pdf extension pre-check. */
  filePath?: string | null
  /** Notebook context for the "save analysis as note" flow; hides it when absent (classic page). */
  notebookId?: string
}

interface SectionAnalysis {
  markdown: string
  truncated: boolean
}

const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5]

/**
 * In-app viewer for uploaded PDF sources. Loads the original file via the
 * download endpoint, renders one page at a time on a single canvas, offers
 * the document outline for navigation and a click-triggered AI analysis per
 * outline section (result savable as a note when a notebook context exists).
 *
 * Loaded via next/dynamic + ssr:false (pdf.js is browser-only).
 */
export default function PdfSourceViewer({
  open,
  onOpenChange,
  sourceId,
  filePath,
  notebookId,
}: PdfSourceViewerProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'notPdf' | 'failed'>('loading')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [outline, setOutline] = useState<PdfOutlineEntry[] | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(true)

  // AI analysis state: results cached per outline entry key; one request in
  // flight (hook isPending disables the sibling Sparkles buttons).
  const [analysisByKey, setAnalysisByKey] = useState<Record<string, SectionAnalysis>>({})
  const [emptyTextKeys, setEmptyTextKeys] = useState<Record<string, true>>({})
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)

  const analysis = useSectionAnalysis()

  // "still mounted" guard for the async load/extract chains.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const resetState = useCallback(() => {
    setStatus('loading')
    setDoc(null)
    setCurrentPage(1)
    setScale(1)
    setOutline(null)
    setAnalysisByKey({})
    setEmptyTextKeys({})
    setAnalyzingKey(null)
    setErrorKey(null)
    setActiveKey(null)
    setSaveDialogOpen(false)
  }, [])

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
        setOutline(rawOutline ? await flattenOutline(loaded, rawOutline) : [])
        setStatus('ready')
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

  // Render the current page onto the single canvas. Cancel any in-flight
  // render task before a page turn / zoom (effect cleanup).
  useEffect(() => {
    if (!doc || status !== 'ready') return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null

    void (async () => {
      try {
        const page = await doc.getPage(currentPage)
        const canvas = canvasRef.current
        if (cancelled || !canvas) {
          await page.cleanup()
          return
        }
        // Render at device resolution, lay out at CSS resolution (v6 has no
        // maxCanvasPixels cap — clamp the multiplier instead).
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: scale * dpr })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
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

  const totalPages = doc?.numPages ?? 0
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
      if (!doc || entry.pageNumber == null || analysis.isPending) return
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
      analysis.mutate(
        {
          sourceId,
          sectionTitle: entry.title,
          sectionText,
          pageStart: startPage,
          pageEnd: endPage,
        },
        {
          onSuccess: (result) => {
            setAnalysisByKey((prev) => ({
              ...prev,
              [key]: { markdown: result.analysis_markdown, truncated: result.truncated },
            }))
            setAnalyzingKey(null)
          },
          onError: () => {
            setErrorKey(key)
            setAnalyzingKey(null)
          },
        }
      )
    },
    [doc, outline, analysis, emptyTextKeys, entryKey, sourceId]
  )

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] sm:max-w-5xl h-[90vh] max-h-[90vh] overflow-hidden p-0 flex flex-col gap-0"
        data-testid="pdf-viewer-dialog"
      >
        <DialogTitle className="sr-only">{t('sources.pdfViewer.title')}</DialogTitle>

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

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Outline sidebar */}
          {status === 'ready' && outlineOpen && (
            <aside
              className="w-64 shrink-0 overflow-y-auto border-r bg-muted/20 p-2"
              data-testid="pdf-outline"
            >
              {!outline || outline.length === 0 ? (
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
                        analysis.isPending ||
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
              <canvas
                ref={canvasRef}
                className="rounded shadow-md"
                data-testid="pdf-canvas"
                aria-label={t('sources.pdfViewer.title')}
              />
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
                    disabled={analysis.isPending || !!emptyTextKeys[activeKey]}
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
              {analyzingKey === activeKey && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('sources.fileView.analyzing')}
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
                      className="h-6 w-6 shrink-0 text-muted-foreground"
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
      </DialogContent>
    </Dialog>
  )
}

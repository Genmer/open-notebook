'use client'

import { useEffect, useRef } from 'react'
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import { getPdfjs } from '@/lib/pdf/pdf-loader'

interface PageTextLayerProps {
  page: PDFPageProxy
  /** CSS-pixel viewport (no devicePixelRatio) — the one TextLayer lays out in. */
  cssViewport: PageViewport
  /** Pre-fetched text content (the caller already read it to classify the page). */
  textContent: TextContent
}

type TextLayerInstance = {
  render: () => Promise<void>
  update: (opts: { viewport: PageViewport }) => void
  cancel: () => void
}

/**
 * pdf.js text layer over the rendered canvas: transparent absolutely
 * positioned spans that carry the native text selection the annotation
 * toolbar anchors on. Rendering happens once per page; zoom calls
 * `update({viewport})` to re-layout the same spans in place (no rebuild).
 */
export default function PageTextLayer({
  page,
  cssViewport,
  textContent,
}: PageTextLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<TextLayerInstance | null>(null)

  // Build once per page. The instance lives on a ref so the zoom effect can
  // reach it without re-running this build.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false

    void (async () => {
      try {
        const pdfjs = await getPdfjs()
        if (cancelled) return
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container,
          viewport: cssViewport,
        }) as TextLayerInstance
        instanceRef.current = textLayer
        await textLayer.render()
        if (cancelled) return
        // The lib sets this too; pin it explicitly because the CSS
        // font-size chain resolves through it on the container.
        container.style.setProperty('--total-scale-factor', String(cssViewport.scale))
      } catch {
        // A failed text layer leaves the canvas readable; selection
        // annotation is simply unavailable for this page.
      }
    })()

    return () => {
      cancelled = true
      instanceRef.current?.cancel()
      instanceRef.current = null
      container.textContent = ''
    }
    // textContent identity is stable per page load (the parent refetches it
    // on page turn only); zoom changes cssViewport and must NOT rebuild —
    // the update effect below handles re-layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, textContent])

  // Zoom on the same page: re-layout in place. A page turn swaps the page
  // object and the build effect above constructs with the fresh viewport —
  // this update then lands on the new instance harmlessly (same viewport).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.style.setProperty('--total-scale-factor', String(cssViewport.scale))
    instanceRef.current?.update({ viewport: cssViewport })
  }, [cssViewport])

  return <div ref={containerRef} className="textLayer" data-testid="pdf-text-layer" />
}

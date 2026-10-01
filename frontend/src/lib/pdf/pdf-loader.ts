/**
 * Lazily load pdf.js (ESM-only in v6) in the browser and configure the worker
 * from the static copy in public/ (see scripts/copy-pdf-worker.js).
 *
 * - `await import('pdfjs-dist')` inside a singleton keeps the ~1.3MB library
 *   out of the initial bundle; consumers render via next/dynamic + ssr:false
 *   (same pattern as markdown-editor.tsx).
 * - workerSrc points at the public asset because Turbopack does not rewrite
 *   webpack-style `new URL(..., import.meta.url)` worker references.
 *   CDNs are banned (privacy-first, self-hostable product).
 */

type PdfjsModule = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfjsModule> | null = null

export function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      return pdfjs
    })
  }
  return pdfjsPromise
}

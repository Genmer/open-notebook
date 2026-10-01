/**
 * Copy the pdf.js worker into public/ so it can be served as a static asset.
 *
 * Turbopack (Next 16) does not rewrite webpack-style
 * `new URL('./pdf.worker.min.mjs', import.meta.url)` worker references, so the
 * community-standard approach applies: ship the worker from public/ and point
 * GlobalWorkerOptions.workerSrc at the static path at runtime.
 *
 * Wired as `predev` / `prebuild` in package.json so the file is always fresh.
 * The artifact is gitignored (1.27MB) — the Dockerfile COPYs public/ into the
 * production image.
 */
const { copyFileSync, existsSync, mkdirSync } = require('node:fs')
const { dirname, join } = require('node:path')

const root = join(__dirname, '..')
const src = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const destDir = join(root, 'public')
const dest = join(destDir, 'pdf.worker.min.mjs')

if (!existsSync(src)) {
  console.error(
    '[copy-pdf-worker] node_modules/pdfjs-dist/build/pdf.worker.min.mjs not found — run `npm install` first.'
  )
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
console.log('[copy-pdf-worker] copied pdf.worker.min.mjs -> public/')

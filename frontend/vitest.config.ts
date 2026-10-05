import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // jsdom doesn't paint, so tests never need real CSS/style computation - and
  // without this, importing a component that bundles its own .css (e.g.
  // @uiw/react-markdown-preview) fails to resolve this project's Tailwind v4
  // postcss.config.mjs (string-form plugin list) outside of Next.js's own
  // build pipeline. `test.css: false` alone doesn't prevent Vite from trying
  // to resolve the postcss config; this bypasses it outright.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    // Cap the forks pool. The default spawns ~1 worker per logical core (20
    // on the dev box); each fork is a full Node+jsdom process, and the peak
    // RSS across all forks can exceed the free Windows commit limit under
    // load — Node then aborts mid-suite (exit 134) with zero failing tests.
    // 8 workers keeps peak memory well inside the observed headroom while
    // keeping the suite fast.
    maxWorkers: 8,
    setupFiles: ['./src/test/setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src')
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
      // Note: reportsDirectory is NOT specified - vitest 4.x uses default location
    }
  }
})

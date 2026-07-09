import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000 },
  envDir: resolve(__dirname, '../..'),
  // App version/build, injected at build time for the HD-3 diagnostics readout.
  // Version is the single source of truth in package.json; build time is the
  // ISO instant of the build. Neither is a secret.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@area-code/shared': resolve(__dirname, '../../packages/shared'),
    },
  },
  build: {
    // Emit dist/.vite/manifest.json so scripts/check-bundle-budget.mjs can tell
    // initial entry chunks (isEntry + static imports) from lazy/dynamic chunks
    // and enforce the consumer Bundle_Budget in CI (R9.3).
    manifest: true,
    // Bundle_Budget R9.4 decision: we do NOT raise chunkSizeWarningLimit. Real
    // splitting is done below (heavy vendors carved out; the Phosphor icon
    // barrel was replaced by a curated tree-shaken registry). After that, the
    // only chunk over Vite's 500 kB warning is mapbox-gl (~1.7 MB), a single
    // third-party module that is already loaded via dynamic import() and cannot
    // be split further. That one warning is accepted and expected; it never
    // ships on first paint. The enforced regression gate is the initial-gzip
    // ceiling in scripts/check-bundle-budget.mjs (R9.3), not this dev-time nag.
    rollupOptions: {
      output: {
        // Real vendor splits (R9.4): keep every INITIAL chunk small by carving
        // the heavy, always-loaded vendors into their own chunks. Deliberate
        // splitting, NOT raising build.chunkSizeWarningLimit to hide the size.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Mapbox GL is loaded via dynamic import() in useMapInit, so Rollup
          // already isolates it into its own lazy chunk. Never fold it into an
          // initial vendor chunk or the Bundle_Budget regression (R9.1) returns.
          if (id.includes('mapbox-gl')) return
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) {
            return 'react-vendor'
          }
          if (id.includes('@tanstack')) return 'query-vendor'
          if (id.includes('i18next')) return 'i18n-vendor'
          return 'vendor'
        },
      },
    },
  },
})

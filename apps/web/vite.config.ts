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
    rollupOptions: {
      output: {
        // Real vendor splits (R9.4): keep no single initial chunk above Vite's
        // chunk-size warning limit by carving the heavy, always-loaded vendors
        // into their own chunks. This is deliberate splitting, NOT raising
        // build.chunkSizeWarningLimit to hide the size.
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

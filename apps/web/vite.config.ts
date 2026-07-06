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
})

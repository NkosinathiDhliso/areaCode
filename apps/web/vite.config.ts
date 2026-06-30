import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { getBuildId } from '../../scripts/build-id.mjs'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000 },
  define: { __APP_BUILD_ID__: JSON.stringify(getBuildId()) },
  envDir: resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@area-code/shared': resolve(__dirname, '../../packages/shared'),
    },
  },
})

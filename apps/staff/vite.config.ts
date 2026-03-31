import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3002 },
  build: { outDir: 'dist' },
  envDir: resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@area-code/shared': resolve(__dirname, '../../packages/shared'),
    },
  },
})

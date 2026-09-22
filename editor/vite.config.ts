import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react({ jsxImportSource: '@emotion/react' })],
  build: { target: 'esnext', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@banou/opencv-wasm'] },
  test: { include: ['tests/**/*.test.ts'] },
  lint: { rules: { 'no-var': 'error', 'prefer-const': 'error' } },
})

import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Keep Emscripten's optional single-file WASM fallback out of Vite's asset graph.
// The worker always supplies the verified chunk bytes through wasmBinary.
const nativeRuntime = () => ({
  name: 'opencv-chunked-runtime',
  apply: 'build' as const,
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (source === './opencv.mjs' && importer?.replaceAll('\\', '/').endsWith('/@banou/opencv-wasm/lib/index.js')) {
      const manifest = JSON.parse(readFileSync(new URL('./src/wasm.generated.json', import.meta.url), 'utf8'))
      return { id: `/editor/runtime/opencv-${manifest.sha256}.mjs`, external: true }
    }
  },
})

export default defineConfig(({ mode }) => ({
  base: '/editor/',
  // Hosted builds never copy the developer's optional clips or project folders.
  publicDir: mode === 'site' ? false : 'public',
  plugins: [react({ jsxImportSource: '@emotion/react' })],
  build: { target: 'esnext', assetsInlineLimit: 0 },
  worker: { format: 'es', plugins: () => [nativeRuntime()] },
  resolve: { dedupe: ['@banou/opencv-wasm'] },
  optimizeDeps: { exclude: ['@banou/opencv-wasm', 'cadence'] },
  test: { include: ['tests/**/*.test.ts'] },
  lint: { ignorePatterns: ['vendor/cadence-regional/**'], rules: { 'no-var': 'error', 'prefer-const': 'error' } },
}))

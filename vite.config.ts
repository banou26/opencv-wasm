import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'lib',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: ['./opencv.mjs'] },
  },
})

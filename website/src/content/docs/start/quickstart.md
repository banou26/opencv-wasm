---
title: Browser quickstart
description: Install the built package, load its WASM asset in Vite, and run a typed image-processing pipeline.
---

The package is currently distributed as a local tarball from the private repository. It is named `@banou/opencv`; the repository is named `opencv-wasm`.

## Install a built package

From the library repository, run `npm pack` after building it. In your application:

```sh
npm install /path/to/banou-opencv-0.0.6.tgz
npm install --save-dev typescript vite
```

Use TypeScript 5.9 or later and Node 22 or later for the application tooling:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "lib": ["ESNext", "DOM"],
    "types": ["vite/client"],
    "noEmit": true
  }
}
```

## Load the engine and process pixels

Vite’s `?url` import supplies the actual emitted asset URL. Keep one initialized instance for a pipeline instead of loading a new engine for every image.

```ts title="main.ts"
import { createOpenCV, matFromImageData, toImageData } from '@banou/opencv'
import wasmUrl from '@banou/opencv/opencv_js.wasm?url'

const cv = await createOpenCV({ wasmUrl })
const canvas = document.querySelector<HTMLCanvasElement>('#image')!
const context = canvas.getContext('2d')!

using source = matFromImageData(cv, context.getImageData(0, 0, canvas.width, canvas.height))
using gray = new cv.Mat()
using edges = new cv.Mat()
cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)
cv.Canny(gray, edges, 50, 150)
context.putImageData(toImageData(cv, edges), 0, 0)
```

Draw an image onto the canvas before running the pipeline. A canvas created without content contains transparent black pixels, so it produces no useful edges. The [image lab](/lab/) provides a complete working example.

## Serve the assets

Serve WASM with `Content-Type: application/wasm`. A current browser with WebAssembly SIMD is required. This single-threaded build does not require SharedArrayBuffer or cross-origin isolation.

For an unbundled application, serve the built `lib/` directory intact and import `index.js`. The loader then finds the adjacent `opencv_js.wasm`. If your application already has the bytes, pass `wasmBinary` to `createOpenCV` instead.

## Release resources

`using` disposes native handles when their block exits, including exceptions. The runtime must provide `Symbol.dispose`, or you can call `delete()` in a `finally` block. Ordinary objects such as `{ width, height }` and numeric result fields need no disposal.

Move expensive pipelines to [a worker](/guides/workers/) to keep rendering and input responsive.

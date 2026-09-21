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
import { Canny, COLOR_RGBA2GRAY, cvtColor, initOpenCV, Mat, matFromImageData, toImageData } from '@banou/opencv'
import wasmUrl from '@banou/opencv/opencv_js.wasm?url'

await initOpenCV({ wasmUrl })
const canvas = document.querySelector<HTMLCanvasElement>('#image')!
const context = canvas.getContext('2d')!

using source = matFromImageData(context.getImageData(0, 0, canvas.width, canvas.height))
using gray = new Mat()
using edges = new Mat()
cvtColor(source, gray, COLOR_RGBA2GRAY)
Canny(gray, edges, 50, 150)
context.putImageData(toImageData(edges), 0, 0)
```

Draw an image onto the canvas before running the pipeline. A canvas created without content contains transparent black pixels, so it produces no useful edges. The [image lab](/lab/) provides a complete working example.

## Named imports and initialization

Classes, functions, constants and module APIs are named exports. For example, import `Mat`, `GaussianBlur`, `CV_8UC3`, `dnn_readNetFromONNX` or `ml_SVM` directly. Module-specific APIs keep their flat prefixes so similarly named operations remain unambiguous. Class factories and instance methods still belong to their classes, such as `Mat.zeros(...)`, `ORB.create(...)` and `image.copyTo(...)`.

Importing the package does not fetch WASM. Call and await `initOpenCV` once before using native exports, including reading constants. Concurrent calls share the same promise, subsequent calls reuse the instance, and a failed load can be retried. The first successful call determines asset and logging options; later calls do not replace the engine. Each worker initializes its own shared instance.

`Mat` works as both a constructor and a TypeScript instance type:

```ts
import { initOpenCV, Mat, CV_8UC3 } from '@banou/opencv'

await initOpenCV()
using image: Mat = new Mat(480, 640, CV_8UC3)
```

For applications that need multiple independent engines, `createOpenCV(options)` remains available. Use the constructors, functions and explicit-instance helper overloads from that returned instance. Creating an isolated instance never changes named imports. Keep native handles with the engine that created them. Advanced code can obtain the shared engine from `await initOpenCV()` to access its current heap views; heap views are not named exports because memory growth replaces them.

## Serve the assets

Serve WASM with `Content-Type: application/wasm`. A current browser with WebAssembly SIMD is required. This single-threaded build does not require SharedArrayBuffer or cross-origin isolation.

For an unbundled application, serve the built `lib/` directory intact and import `index.js`. The loader then finds the adjacent `opencv_js.wasm`. If your application already has the bytes, pass `wasmBinary` to `initOpenCV` instead.

## Release resources

`using` disposes native handles when their block exits, including exceptions. The runtime must provide `Symbol.dispose`, or you can call `delete()` in a `finally` block. Ordinary objects such as `{ width, height }` and numeric result fields need no disposal.

Move expensive pipelines to [a worker](/guides/workers/) to keep rendering and input responsive.

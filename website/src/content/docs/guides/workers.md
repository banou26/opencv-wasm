---
title: Workers and responsiveness
description: Keep expensive vision processing off the UI thread and transfer pixel copies instead of native handles.
---

Native OpenCV operations are synchronous. A promise around the call does not move its computation off the UI thread. Create the OpenCV instance inside an ES module worker when processing frames interactively.

```ts title="vision.worker.ts"
import { createOpenCV, matFromArray, toImageData } from '@banou/opencv'
import wasmUrl from '@banou/opencv/opencv_js.wasm?url'

const cv = await createOpenCV({ wasmUrl })
self.onmessage = ({ data }) => {
  using rgba = matFromArray(cv, data.height, data.width, cv.CV_8UC4, data.pixels)
  using gray = new cv.Mat()
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
  const result = toImageData(cv, gray)
  self.postMessage({ pixels: result.data, width: result.width, height: result.height }, {
    transfer: [result.data.buffer],
  })
}
```

```ts title="main.ts"
const worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' })
const image = context.getImageData(0, 0, canvas.width, canvas.height)
worker.postMessage({ pixels: image.data, width: image.width, height: image.height }, [image.data.buffer])
```

Transferring the array buffer detaches the sender’s copy. Only transfer ordinary image buffers; a native matrix belongs to the WASM instance that created it.

## Keep a bounded queue

For a live preview, process one frame at a time and retain at most the newest waiting frame. A queue of every captured frame turns temporary slowness into growing latency. Offline video processing may need a different policy that preserves every frame.

Workers isolate synchronous computation from rendering, but each OpenCV instance consumes its own heap. Multiple workers are not free native parallelism. Benchmark the memory and throughput of the actual pipeline before adding workers.

The [image laboratory](/lab/) implements this pattern, including cleanup, error reporting and parameter changes while a frame is running.

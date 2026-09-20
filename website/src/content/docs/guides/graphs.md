---
title: Graph pipelines
description: Describe OpenCV computations as typed graphs, execute them on CPU, and adapt frame streams.
---

G-API describes a computation before it receives actual images. A graph node is a placeholder for a value; executing the computation produces native results.

```ts
using inputNode = new cv.GMat()
using outputNode = cv.gapi.BGR2Gray(inputNode)
using inputs = cv.GIn([inputNode])
using outputs = cv.GOut([outputNode])
using graph = new cv.GComputation(inputs, outputs)

const result = graph.apply([image])
const gray = result[0]
if (!(gray instanceof cv.Mat)) throw new Error('Expected a matrix')
try {
  const pixels = gray.data.slice()
} finally {
  gray.delete()
}
```

Graphs support matrices, scalars, typed arrays and opaque values. Typed custom kernels use TypeScript metadata and execution callbacks. Their input handles are borrowed; their output matrices are preallocated. Mixed port tuples retain precise callback and node types.

## Frame streams

`compileStreaming()` returns the package’s serial asynchronous graph executor. It accepts synchronous or asynchronous frame producers and preserves native output ownership. It does not enable OpenCV’s parallel native streaming scheduler or `desync` regions.

```ts
await using stream = graph.compileStreaming()
stream.setSource([[image], [nextImage]])
stream.start()
for (;;) {
  const batch = await stream.pull()
  if (batch === null) break
  for (const value of batch) {
    if (value instanceof cv.Mat) value.delete()
  }
}
```

Other native handles, including handles nested in arrays, also need disposal. Input frames remain borrowed unless their producer supplies a release callback. Stop a stream before replacing its source. A producer waiting on external data should honor cancellation so stopping can complete.

## Graph inference

The `cv.gapi.dnn` adapter executes network nodes with OpenCV DNN. OpenVINO and ONNX Runtime graph backends are not linked. Compile arguments carry network and kernel packages; create a new computation when changing a cached compiled configuration.

The repository’s graph guides contain longer examples for typed kernels, inference regions, output lists and frame metadata. The API browser includes the helper signatures and their ownership notes.

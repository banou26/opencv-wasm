---
title: Matrices and ownership
description: Understand pixel depth, channel order, WASM memory views and native resource lifetime.
---

An OpenCV `Mat` combines a shape, an element type and storage. A three-channel 16-bit image contains three unsigned 16-bit components for every pixel. Channel order is a convention of the producer; it is not encoded by the matrix type.

| Producer | Typical order | Depth |
| --- | --- | --- |
| Canvas `ImageData` | RGBA | 8-bit unsigned |
| Native image decoder | BGR or BGRA | Preserved when `IMREAD_UNCHANGED` is requested |
| Grayscale conversion | One luminance-like channel | Usually follows input depth |
| DNN input tensor | Model-specific | Usually float32 |

## Construct and inspect

```ts
import { CV_16UC3, initOpenCV, matFromArray } from '@banou/opencv-wasm'
await initOpenCV()
using image = matFromArray(2, 2, CV_16UC3, new Uint16Array(12))
console.log(image.rows, image.cols, image.channels(), image.depth())
```

Use named constants. OpenCV 5 expands the depth field, so hardcoded OpenCV 4 type codes are wrong. This build supports additional unsigned, signed, boolean and floating depths; not every algorithm accepts every depth.

## Borrowed views and owned copies

`data`, `data16U`, `data32F` and the other typed views point into WASM memory. They can become invalid after the heap grows, and must not be used after the matrix is disposed.

```ts
const retainedPixels = image.data16U.slice() // JavaScript-owned copy
using copiedImage = image.mat_clone()       // Independent native pixel storage
using anotherHandle = image.clone()         // Another handle to the same native object
```

The inherited `clone()` retains the same object. Use `mat_clone()` when you intend to copy pixels. A region of interest can share the underlying storage and have a row stride larger than its visible width; do not assume every matrix is continuous.

## Who releases a result?

- A matrix, vector, algorithm object, or other native handle you create is yours to dispose.
- A native handle returned from a function or a vector’s `get()` also needs disposal, even when nested inside a result object.
- DNN and graph callbacks receive borrowed handles. Keep them only by making an appropriate independent copy.
- Ordinary JavaScript values, typed array copies, points, sizes and numbers are managed by JavaScript.

```ts
import { MatVector } from '@banou/opencv-wasm'
using values = new MatVector()
values.push_back(image)
using element = values.get(0)
```

`using` is convenient when the ownership is lexical. For a handle held across events, dispose it deliberately when the owning UI or worker closes. Do not pass native handles between instances or threads.

## Alpha has a meaning

OpenCV filters each channel according to the operation; it does not automatically premultiply straight-alpha RGB. Before interpolating transparent imagery, multiply RGB by alpha, resample colour and alpha with the same maps, and unpremultiply only when required. Hidden RGB under zero alpha must not leak into visible edges.

An alpha channel can also represent missing observations. Preserve that meaning instead of replacing unobserved pixels with apparently valid black pixels.

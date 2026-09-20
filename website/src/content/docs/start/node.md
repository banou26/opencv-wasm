---
title: Node.js quickstart
description: Read an image, run OpenCV 5 in Node, and write an output without Python or a DOM.
---

The same built package runs in Node 22 or later as ESM. With an installed tarball and an unbundled Node entry point, the default loader finds the adjacent WASM automatically.

```ts title="edges.ts"
import { readFile, writeFile } from 'node:fs/promises'
import { createOpenCV, decodeImage, encodeImage } from '@banou/opencv'

const cv = await createOpenCV()
using image = decodeImage(cv, await readFile('input.png'), cv.IMREAD_UNCHANGED)
using gray = new cv.Mat()
using edges = new cv.Mat()

if (image.channels() === 4) cv.cvtColor(image, gray, cv.COLOR_BGRA2GRAY)
else if (image.channels() === 3) cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
else image.copyTo(gray)

// Canny expects an 8-bit input. Convert explicitly if the decoded image is 16-bit.
using gray8 = new cv.Mat()
gray.convertTo(gray8, cv.CV_8U, image.depth() === cv.CV_16U ? 1 / 257 : 1)
cv.Canny(gray8, edges, 50, 150)
await writeFile('edges.png', encodeImage(cv, '.png', edges))
```

Run TypeScript with your existing build or a runner such as `tsx`. Use `module: "NodeNext"`, `moduleResolution: "NodeNext"`, strict checking and a library set containing `ESNext` and `DOM` for the package’s shared browser types. The Node processing path does not need a DOM implementation.

## Native files and host files

Node’s filesystem and `cv.FS` are separate. `readFile` returns host file bytes. Native model loaders expect paths inside `cv.FS`:

```ts
cv.FS.writeFile('/model.onnx', await readFile('model.onnx'))
using net = cv.dnn.readNetFromONNX('/model.onnx')
cv.FS.unlink('/model.onnx')
```

See [files and codecs](/guides/files/) for format support, and [matrices and ownership](/start/matrices/) before retaining arrays across native calls.

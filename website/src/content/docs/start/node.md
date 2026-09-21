---
title: Node.js quickstart
description: Read an image, run OpenCV 5 in Node, and write an output without Python or a DOM.
---

The same built package runs in Node 22 or later as ESM. With an installed tarball and an unbundled Node entry point, the default loader finds the adjacent WASM automatically.

```ts title="edges.ts"
import {
  Canny,
  COLOR_BGR2GRAY,
  COLOR_BGRA2GRAY,
  CV_16U,
  CV_8U,
  cvtColor,
  decodeImage,
  encodeImage,
  IMREAD_UNCHANGED,
  initOpenCV,
  Mat
} from '@banou/opencv'
import { readFile, writeFile } from 'node:fs/promises'
await initOpenCV()
using image = decodeImage(await readFile('input.png'), IMREAD_UNCHANGED)
using gray = new Mat()
using edges = new Mat()

if (image.channels() === 4) cvtColor(image, gray, COLOR_BGRA2GRAY)
else if (image.channels() === 3) cvtColor(image, gray, COLOR_BGR2GRAY)
else image.copyTo(gray)

// Canny expects an 8-bit input. Convert explicitly if the decoded image is 16-bit.
using gray8 = new Mat()
gray.convertTo(gray8, CV_8U, image.depth() === CV_16U ? 1 / 257 : 1)
Canny(gray8, edges, 50, 150)
await writeFile('edges.png', encodeImage('.png', edges))
```

Run TypeScript with your existing build or a runner such as `tsx`. Use `module: "NodeNext"`, `moduleResolution: "NodeNext"`, strict checking and a library set containing `ESNext` and `DOM` for the package’s shared browser types. The Node processing path does not need a DOM implementation.

## Native files and host files

Node’s filesystem and `FS` are separate. `readFile` returns host file bytes. Native model loaders expect paths inside `FS`:

```ts
import { dnn_readNetFromONNX, FS } from '@banou/opencv'
FS.writeFile('/model.onnx', await readFile('model.onnx'))
using net = dnn_readNetFromONNX('/model.onnx')
FS.unlink('/model.onnx')
```

See [files and codecs](/guides/files/) for format support, and [matrices and ownership](/start/matrices/) before retaining arrays across native calls.

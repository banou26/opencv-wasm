# @banou/opencv-wasm

OpenCV 5.0.0 and opencv_contrib compiled directly from C++ to WebAssembly, with generated TypeScript declarations, ESM loading, worker support and native image codecs. No Python runtime and no dependency on an existing OpenCV.js npm package.

Version 0.0.6 targets Python OpenCV 5. See the [migration notes](docs/opencv-5.md) for changed matrix type codes, new pixel types, tensor shapes and module names.

The [documentation website](website/README.md) includes a searchable API reference, 94 visual algorithm guides, and an image laboratory that runs real OpenCV in a browser worker. After building the package, run `npm ci --prefix website` and `npm run docs:dev` to open it locally.

This build includes 56 CPU modules, including G-API, video I/O, FreeType, HDF5, Tesseract OCR and SFM with Ceres. It supports custom graph kernels with mixed matrix, scalar, array and opaque ports, and generated JSDoc in the shipped TypeScript declarations. There are 69 execution scenarios checked in Node and Chromium. The API uses TypeScript and native matrices, with direct named imports and factory aliases. It does not emulate NumPy or Python calling conventions. Read [coverage](docs/coverage.md) for the measured Python inventory, remaining gaps and module limits.

## Install

```sh
npm install @banou/opencv-wasm
```

For a local build, run `npm pack` in this repository and install the resulting
`banou-opencv-wasm-<version>.tgz` in your application. See
[publishing](docs/publishing.md) for the GitHub Actions release workflow and its
one-time npm setup.

## Vite and TypeScript

```ts
import { COLOR_RGBA2GRAY, cvtColor, initOpenCV, Mat, matFromImageData, toImageData } from '@banou/opencv-wasm'
import wasmUrl from '@banou/opencv-wasm/opencv_js.wasm?url'

await initOpenCV({ wasmUrl })

using input = matFromImageData(context.getImageData(0, 0, width, height))
using gray = new Mat()
cvtColor(input, gray, COLOR_RGBA2GRAY)
context.putImageData(toImageData(gray), 0, 0)
```

Use TypeScript 5.9 or later with `strict: true`, `lib: ["ESNext", "DOM"]`, and `moduleResolution: "Bundler"` or `"NodeNext"`. Vite's `vite/client` types declare `?url` asset imports. `using` requires runtime support for `Symbol.dispose`; explicit `delete()` works as well.

Pass an explicit `wasmUrl` when bundling. For an unbundled deployment, serve `lib/` intact and import `lib/index.js`; the default loader resolves the colocated WASM. Serve `.wasm` as `application/wasm`. A current browser with WebAssembly SIMD is required. Cross-origin isolation and SharedArrayBuffer are not required.

```ts
import { CV_8UC1, decodeImage, encodeImage, initOpenCV, matFromArray } from '@banou/opencv-wasm'
await initOpenCV()
using image = matFromArray(2, 2, CV_8UC1, [0, 80, 160, 255])
const png = encodeImage('.png', image)
using decoded = decodeImage(png)
```

This last example also runs in Node 22+ after installing the tarball. `wasmBinary: Uint8Array` is available for loading bytes yourself.

## API conventions

- Import native classes, functions and constants directly, then await `initOpenCV(options)` once. Imports do not fetch WASM. Concurrent initialization shares one load, later calls reuse it, and failed loads can be retried. Each worker has its own shared engine. Module APIs retain flat names such as `dnn_readNetFromONNX` and `ml_SVM`.
- `createOpenCV(options)` remains the isolated-instance API. It never changes named imports. Keep handles with their owning instance; image helpers accept an explicit instance as their first argument when needed. The shared instance returned by `initOpenCV` exposes current heap views for advanced memory access.
- Editor hovers include JSDoc for native types, overloads, parameters, results and TypeScript helpers. Documentation is generated from the pinned OpenCV headers with package-specific ownership notes. See [API documentation](docs/api-documentation.md) for generation, checks and the audit of terse upstream descriptions.
- Algorithms use C++ argument order and explicit destination matrices. This is not a drop-in replacement for Python's NumPy API.
- Constructors, inherited factories and nested classes are typed: `Mat`, `SIFT.create()`, `TrackerCSRT_Params` and `ml_SVM.create()`. `Mat` is also its instance type. Unrelated native classes retain distinct TypeScript handle types.
- Native matrices and algorithm objects own native resources. Use `using` or `try/finally` with `delete()`. Vectors and objects returned from vector `get()` also need disposal. A `cv::Ptr` return is typed as nullable; check it before use.
- Different C++ overload families use suffixes such as `train1`, `findHomography1`, and `from1` for alternative constructors. Each suffix has its own precise signatures. The unsuffixed name is the first upstream overload family. Optional trailing arguments are emitted as overloads.
- Scalar output arguments become named result fields. `getTextSize(...).value` is a `Size`, and `.baseLine` is a number. Returned matrices inside result objects must also be disposed.
- `Mat.data`, `data32F`, and the other typed views reference WASM memory. Copy with `.slice()` before transferring or retaining pixels across memory growth. `mat.mat_clone()` copies pixels; the inherited `clone()` duplicates a handle to the same object.
- Native image codecs use BGR/BGRA ordering. Canvas `ImageData` uses RGBA. `matFromImageData` creates an RGBA matrix; `toImageData` accepts grayscale, BGR/RGB, or RGBA. Pass `'bgra'` for decoded images with alpha.
- Files passed to native model loaders and codecs belong to `FS`, the instance's memory filesystem. `imread('/photo.png')` reads this filesystem. Canvas helpers have separate names.

## DNN

```ts
import { dnn_blobFromImage, dnn_readNetFromONNX, FS } from '@banou/opencv-wasm'
FS.writeFile('/model.onnx', modelBytes)
using net = dnn_readNetFromONNX('/model.onnx')
FS.unlink('/model.onnx')
using blob = dnn_blobFromImage(image, 1 / 255, { width: 224, height: 224 })
net.setInput(blob)
using predictions = net.forward()
const values = predictions.data32F.slice()
```

Models are supplied by the application. Inference uses the CPU WASM backend. DNN being compiled does not mean every model operator is supported by OpenCV.

`dnn_registerLayer(name, factory)` registers a synchronous TypeScript layer. The factory receives typed parameters and borrowed model blobs, and returns `getMemoryShapes(inputs)` and `forward(inputs, outputs)`. Write into the preallocated output matrices in `forward`. Borrowed handles are released after each callback, including failures; clone a matrix if you need to keep it. Integer layer parameters are `bigint`. Delete networks before releasing any application-owned state used by their callbacks. `dnn_unregisterLayer(name)` removes the factory for future layer creation.

## CPU graphs

```ts
import { gapi_BGR2Gray, GComputation, GIn, GMat, GOut, Mat } from '@banou/opencv-wasm'
using inputNode = new GMat()
using outputNode = gapi_BGR2Gray(inputNode)
using inputs = GIn([inputNode])
using outputs = GOut([outputNode])
using graph = new GComputation(inputs, outputs)
const results = graph.apply([image])
const gray = results[0]
if (!(gray instanceof Mat)) throw new Error('Expected a matrix result')
try {
  const pixels = gray.data.slice()
} finally { gray.delete() }
```

Graph execution supports matrix, scalar, typed array and opaque value nodes. `GArray_Point2f()`, `GOpaque.Int()` and the other typed factories construct nodes; `GArray_Prim()` accepts drawing primitives created with `GDrawPrim.fromRect(...)` and related factories. Use `compile_args(...)` for kernel and network packages. Graph outputs containing native handles require disposal. OpenCV caches a computation's compiled configuration; create a new computation to change its network or kernel configuration.

Custom matrix kernels execute inside the native CPU graph. Metadata callbacks return ordinary layout values; execution callbacks borrow native matrices and fill the preallocated outputs:

```ts
import { bitwise_not, compile_args, GComputation, GIn, GMat, GOut, kernel as createKernel, op } from '@banou/opencv-wasm'
using operation = op('app.invert', {
  inputs: 1,
  outputs: 1,
  outMeta: inputs => inputs,
})
using kernel = createKernel(operation, (inputs, outputs) => {
  bitwise_not(inputs[0]!, outputs[0]!)
})
using node = new GMat()
using inverted = operation.on([node])[0]!
using graphInputs = GIn([node])
using graphOutputs = GOut([inverted])
using computation = new GComputation(graphInputs, graphOutputs)
using options = compile_args(kernel)
const result = computation.apply([image], options)
```

Use a unique operation ID for each signature and implementation. The returned matrices in `result` need disposal. `kernels(...packages)` combines kernel packages, and `descr_of(...matrices)` returns layout values. Typed port tuples additionally support mixed matrices, scalars, arrays and opaque values, with exact callback and node types. Python decorators and arbitrary Python objects are not emulated. See [custom graph kernels](docs/custom-graph-kernels.md) for signatures, validation and ownership.

## Graph inference

`GInferInputs`, `GInferOutputs`, `GInferListInputs`, `GInferListOutputs`, `gapi_infer` and `gapi_infer2` now use native G-API operations. The browser backend executes them with OpenCV DNN:

```ts
import {
  compile_args,
  dnn_readNetFromONNX,
  gapi_dnn_Params,
  gapi_infer,
  GComputation,
  GIn,
  GInferInputs,
  GMat,
  GOut,
  Mat,
  networks as cvNetworks
} from '@banou/opencv-wasm'
using network = dnn_readNetFromONNX('/model.onnx')
using parameters = new gapi_dnn_Params('classifier', network)
parameters.cfgInput('input', {
  size: { width: 224, height: 224 },
  scale: 1 / 255,
  swapRB: true,
})
using inputNode = new GMat()
using bindings = new GInferInputs()
bindings.setInput('input', inputNode)
using predictions = gapi_infer('classifier', bindings)
using outputNode = predictions.at('output')
using inputs = GIn([inputNode])
using outputs = GOut([outputNode])
using graph = new GComputation(inputs, outputs)
using networks = cvNetworks(parameters)
using options = compile_args(networks)
const results = graph.apply([image], options)
for (const result of results) if (result instanceof Mat) result.delete()
```

Use your model's input and output names. Omit `cfgInput` for raw `CV_32FC1` tensors. Multiple named inputs and outputs, single rectangles, rectangle lists and mixed rectangle/tensor lists are supported. List results contain owned matrices that each need disposal. The network configuration is specific to this OpenCV DNN backend; OpenVINO and ONNX Runtime backends are not linked. See [graph inference](docs/graph-inference.md) for signatures, ownership and model limits.

## Frame streams

```ts
import { Mat } from '@banou/opencv-wasm'
await using stream = computation.compileStreaming(options)
stream.setSource([[image], [nextImage]])
stream.start()
for (;;) {
  const output = await stream.pull()
  if (output === null) break
  for (const value of output) {
    if (value instanceof Mat) {
      try { consume(value) } finally { value.delete() }
    }
  }
}
```

This executor applies the native graph serially to each frame. It accepts synchronous and asynchronous iterables, or a `GraphSource` with `pull(signal)` and optional `close()`. It does not use OpenCV's parallel native streaming executor, queued prefetch or `desync` regions. Each `pull()` returns owned graph outputs. Input values remain borrowed unless a frame supplies `{ values, release }`, whose synchronous release callback runs after processing, including failures. Other native output handles, including handles nested in arrays, also need disposal.

`gapi_wip_make_capture_src(path, backend)` streams videos from `FS`. `make_js_src(iterable)` and `get_streaming_source(source)` adapt application frame producers. Call `await stream.stop()` before replacing a source; concurrent pulls are rejected. Sources waiting for external data should honor the supplied abort signal so stopping can finish promptly. Streams retain the computation and compile arguments and support `await using` or `await stream.delete()`. Run long computations in a worker to keep the UI responsive.

`gapi_streaming_seq_id(inputNode)`, `seqNo(inputNode)` and `timestamp(inputNode)` create native metadata outputs of type `bigint`. Streams assign each batch a sequence starting at zero and a Unix timestamp in microseconds, with millisecond clock precision. A frame can override either using `{ values, metadata: { seqId, timestamp } }`. These values apply to the batch's input nodes; use metadata operations on those nodes. Values must fit signed 64-bit integers. A new source resets the default sequence. For direct execution, `graph.applyWithMetadata(values, { seqId, timestamp }, options?)` supplies metadata explicitly.

## Files, fonts, OCR and reconstruction

- `VideoCapture` and `VideoWriter` read and write MJPEG AVI files in `FS` using `CAP_OPENCV_MJPEG`. Image sequences are available through `CAP_IMAGES`. Browser camera frames come from browser media APIs. General video containers need an external decoder.
- Write a TTF/OTF file to `FS`, then call `freetype_createFreeType2()` and `loadFontData(path, 0)`. The `loadFontData1(bytes, index)` overload borrows a native byte vector: keep it alive and unchanged until the font object is disposed.
- `text_OCRTesseract_create('/tessdata', 'eng', '', 1, 7)` runs the Tesseract LSTM engine. Supply the matching `eng.traineddata` under `/tessdata` first. Language data and fonts are application assets and are not bundled.
- `hdf_open(path)` reads and writes HDF5 datasets and attributes. This build supports uncompressed datasets; gzip and SZIP filters are not compiled. Use `close()` before reading the completed file bytes from `FS`.
- `sfm` includes triangulation and the libmv/Ceres reconstruction pipeline. `sfm_SFMLibmvEuclideanReconstruction_create(cameraOptions, reconstructionOptions)` constructs the pipeline. Its `getPoints` and `getCameras` outputs are native `MatVector` objects.

## Workers

Import the package and call `initOpenCV` inside an ES module worker. Send image bytes or ordinary data between threads; native handles belong to the instance that created them. The [worker test](tests/worker.mjs) is a runnable example. Each instance has its own heap and filesystem.

## Build and verify

Prerequisites: Node 22+, npm, Python 3.12+, Docker, curl, tar and sha256sum. Linux is the verified build host.

```sh
git clone git@github.com:banou26/opencv-wasm.git
cd opencv-wasm
npm ci
npm run build
npm test
npm run test:package
```

`npm run build:wasm` downloads SHA-256-checked OpenCV/contrib and dependency sources and uses a pinned Emscripten image. The default build runs six compile jobs; set `BUILD_JOBS=4` to reduce concurrency. Build artifacts and compiler caches stay in ignored directories. `npm run build:js` rebuilds the TypeScript package using the existing native artifact and the downloaded headers, including JSDoc regeneration. `npm run docs` regenerates declarations and their documentation without recompiling WASM. OCR tests fetch a pinned language model into `.cache`; tests also use a font from the downloaded HarfBuzz sources.

For browser tests, set `CHROMIUM_EXECUTABLE` to a local Chromium/Chrome executable, or install Playwright Chromium. Tests use a headless, muted browser.

`npm run test:package` creates the tarball, installs it into an isolated consumer, checks strict NodeNext types and Node loading, then builds a Vite application and runs it in Chromium.

`npm run parity` compares the loaded runtime with the captured `opencv-contrib-python-headless==5.0.0.93` inventory and writes `lib/python-parity.json`. `bash scripts/capture-python-reference.sh` recreates the inventory and numeric test fixtures in Docker. Python is only a build/reference tool; it is never used by the shipped runtime. Symbol presence and matching constants do not prove matching signatures or algorithm behavior. [Execution coverage](docs/testing.md) lists the actual checks and their limits.

The generator consumes the same annotated C++ declarations as Python. It generates wrappers for classes, overloads, value types, vectors and output results. Emscripten emits declarations from those registered bindings; a finishing step supplies exact types for memory views and the filesystem, preserves C++ method hiding, and rejects unresolved `any` declarations. The build fails when a registered native type has no binding. Coverage records generation exclusions and omitted modules separately.

See [architecture](docs/architecture.md) for the boundary implementation and [third-party notices](THIRD_PARTY_NOTICES.md) for the sources included in the binary.

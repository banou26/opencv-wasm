# Native graph inference

The graph inference bindings call OpenCV 5.0.0's actual `GInferInputs`, `GInferOutputs`, `GInferListInputs`, `GInferListOutputs`, `gapi::infer` and `gapi::infer2`. A custom native backend runs these operations through OpenCV DNN and delegates scheduling and buffer allocation to G-API's CPU executor. There is no JavaScript inference callback or second model runtime.

## Network configuration

Load a `cv.dnn.Net` using the existing model readers, then construct `new cv.gapi.dnn.Params(tag, net)`. The parameters retain the model and select the OpenCV CPU backend on the shared network. `cv.gapi.networks(...parameters)` copies the configurations into a native network package, and `cv.gapi.compile_args(networks)` creates compile arguments. Different networks require different tags; duplicate tags in a package throw.

Both OpenCV 5 engines are supported. Pass `cv.dnn.ENGINE_NEW` or `cv.dnn.ENGINE_CLASSIC` to `readNetFromONNX` to select one explicitly. The default reader uses upstream `ENGINE_AUTO`. The bridge resolves input/output names and output shapes according to the selected engine.

Call `parameters.cfgInput(name, options)` to treat an input as an image. Options have the following types:

```ts
type GraphDNNInputOptions = {
  size: { width: number, height: number }
  scale?: number
  mean?: [number, number, number, number]
  swapRB?: boolean
  crop?: boolean
}
```

Preprocessing calls native `dnn::blobFromImage`. The destination size is required and positive. Defaults are scale 1, zero mean, no channel swap and no center crop. Images may be 8-bit or float with one, three or four channels. Pixel values and channel order follow `blobFromImage`, including mean subtraction and scaling. Inputs without preprocessing must be single-channel float tensors, normally created with `cv.matWithShape` or `cv.dnn.blobFromImage`.

Configure parameters before packaging them. OpenCV caches a computation's compiled configuration; passing different compile arguments to an already compiled computation does not reconfigure its network. Construct another computation when changing models, preprocessing or kernels. Input dimensions can change when the model and its shape inference support them.

## Operation signatures

| Operation | Inputs | Outputs |
| --- | --- | --- |
| `cv.gapi.infer(tag, inputs)` | Named `GMat` nodes in `GInferInputs` | `GInferOutputs.at(name)` returns `GMat` |
| `cv.gapi.infer(tag, region, inputs)` | `GOpaque.Rect()` plus a single named image input | `GInferOutputs.at(name)` returns `GMat` |
| `cv.gapi.infer(tag, regions, inputs)` | `GArray.Rect()` plus a single named image input | `GInferListOutputs.at(name)` returns `GArray_Mat` |
| `cv.gapi.infer2(tag, image, inputs)` | Image `GMat` plus named lists in `GInferListInputs` | `GInferListOutputs.at(name)` returns `GArray_Mat` |

`GInferInputs.setInput(name, node)` accepts `GMat`. `GInferListInputs.setInput(name, node)` accepts `GArray.Rect()` or `GArray.Mat()`. Setters return `void`. An input name can be replaced before building the inference operation. Request all output nodes with `at(name)` before constructing the `GComputation`.

Region inference requires explicit image preprocessing for the model input. Rectangles must be positive and contained in the source image. `infer2` pairs elements with the same index across its input lists; unequal lengths throw. Rectangles are cropped from the shared image and preprocessed. Matrix list elements are already prepared float tensors and bypass image preprocessing. Empty lists produce empty output arrays.

For example, this computes a single-input network over selected regions:

```ts
using imageNode = new cv.GMat()
using regionsNode = cv.GArray.Rect()
using bindings = new cv.GInferInputs()
bindings.setInput('input', imageNode)
using predictions = cv.gapi.infer('classifier', regionsNode, bindings)
using scoresNode = predictions.at('output')
using inputs = cv.GIn([imageNode, regionsNode])
using outputs = cv.GOut([scoresNode])
using graph = new cv.GComputation(inputs, outputs)
const results = graph.apply([image, [
  { x: 0, y: 0, width: 64, height: 64 },
  { x: 64, y: 0, width: 64, height: 64 },
]], options)
const scores = results[0]
if (!Array.isArray(scores)) throw new Error('Expected tensor list')
try {
  for (const tensor of scores) {
    if (tensor instanceof cv.Mat) consume(tensor.data32F)
  }
} finally {
  for (const tensor of scores) if (tensor instanceof cv.Mat) tensor.delete()
}
```

Here `options` contains a `classifier` network configured for image input, and `image` contains both regions. `consume` must copy any pixels it wants to retain.

## Ownership and limits

Network packages retain their model. Streams retain compile arguments and their computation. Deleting the original parameter and model handles after configuring a stream does not unload that stream's model. Native graph nodes, packages, input maps and output maps still need normal `using` or `delete()` disposal.

Every returned matrix is owned by the caller, including matrices nested in list outputs. Each list item receives a separate pixel copy because DNN reuses internal buffers between forward passes. Results remain valid across subsequent runs.

The backend supports CPU float outputs and models understood by OpenCV DNN. Dense output shapes must be derivable from input shapes; outputs whose dimensions depend on tensor values are not supported in dense graphs. List outputs can have different shapes between elements. Raw tensor inputs must use `CV_32FC1`. MediaFrame inputs, quantized outputs, OpenVINO/ONNX Runtime graph backends, asynchronous inference and serialization of this backend's configuration are not implemented. This does not establish support for every ONNX operator or production model.

Tests execute two small ONNX models in Node and Chromium. They check input and output ordering, reshaping, image preprocessing, single regions, region lists, mixed lists, empty lists, invalid inputs, output ownership and streaming retention. Selected outputs are compared with OpenCV's pinned native Python DNN implementation.

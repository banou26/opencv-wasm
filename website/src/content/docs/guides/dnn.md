---
title: DNN models
description: Load model assets, prepare typed tensors and run the CPU inference engine.
---

This package uses OpenCV’s DNN engine on the CPU WASM backend. WebGPU, WebNN, CUDA and OpenCL acceleration are not enabled. A supported file format does not guarantee support for every operator inside a model.

## Load and execute

```ts
cv.FS.writeFile('/model.onnx', modelBytes)
using net = cv.dnn.readNetFromONNX('/model.onnx')
cv.FS.unlink('/model.onnx')

using input = cv.dnn.blobFromImage(image, 1 / 255, { width: 224, height: 224 })
net.setInput(input)
using predictions = net.forward()
const values = predictions.data32F.slice()
```

The preprocessing above is an example, not a universal model recipe. Use the model’s specified image size, RGB/BGR order, scale, mean, tensor layout and output interpretation. Some models require a crop, letterbox padding, extra inputs or named outputs.

## Debug a model in stages

1. Load the model and confirm the expected input and output names.
2. Compare the preprocessed input tensor with a known implementation.
3. Run a small known input and compare raw output tensors.
4. Add postprocessing only after raw outputs agree.

A detection model can require confidence filtering, coordinate scaling, class interpretation and [non-maximum suppression](/algorithms/nms/). Those steps are part of the model contract.

## Custom layers

`cv.dnn_registerLayer(name, factory)` registers a synchronous TypeScript implementation with shape and forward callbacks. Forward callbacks write into preallocated outputs and receive borrowed native handles. Integer layer parameters use `bigint`. Async native callbacks are not supported.

Use `cv.dnn_unregisterLayer(name)` to remove the factory for future layer creation. Dispose networks before releasing application state their callbacks use. The generated API reference describes the exact callback types.

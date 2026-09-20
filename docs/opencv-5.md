# OpenCV 5 migration

Package 0.0.6 targets OpenCV and opencv_contrib 5.0.0. The Python reference is `opencv-contrib-python-headless==5.0.0.93`. The source archives, build configuration, declarations, header documentation and comparison inventory all use this version. See the [upstream migration guide](https://github.com/opencv/opencv/wiki/OpenCV-4-to-5-migration) for the native changes.

## Matrix types

OpenCV 5 changes matrix type encoding. Use this runtime's constants and `cv.CV_MAKETYPE(depth, channels)` rather than saved numeric values from OpenCV 4. For example, `CV_8UC3` is now 64. The supported channel range is 1 through 128.

`matFromArray` accepts all thirteen scalar depths. The new storage types are:

| Depth | Input values | Pixel view |
| --- | --- | --- |
| `CV_32U` | `number` | `data32U: Uint32Array` |
| `CV_64S` | signed 64-bit `bigint` | `data64S: BigInt64Array` |
| `CV_64U` | unsigned 64-bit `bigint` | `data64U: BigUint64Array` |
| `CV_Bool` | `boolean` or numeric values, normalized to 0/1 | `data: Uint8Array` |
| `CV_16BF` | `number`, converted to bfloat16 | `data16U` contains raw bits |

`CV_16F` also accepts numbers through native conversion. Integer 64-bit input rejects values outside its range and requires bigint to avoid precision loss. Pixel views borrow WASM memory and share the matrix's lifetime. Supporting a storage depth does not mean every image-processing algorithm accepts it; consult each function's JSDoc.

## Shapes and modules

`cv.MatShape` is now a native shape object used by DNN APIs. Construct it from an `IntVector`, or call `cv.MatShape.scalar()` for a scalar shape. Dispose both shape and vector handles. `size()` counts dimensions; `total()` counts elements. A scalar has zero dimensions and one element, while an empty shape contains no elements.

`cv.matWithShape(sizes, type)` preserves one-dimensional tensors. An empty extent vector constructs a zero-dimensional scalar. Code that assumed every vector became a two-dimensional column matrix must choose its dimensions explicitly.

The build includes the new `geometry`, `calib`, `stereo`, `ptcloud` and `features` modules. Upstream module boundaries have changed, and JavaScript namespaces follow Python-visible names rather than CMake module names. For example, `depthTo3d` is now at `cv.depthTo3d`; AKAZE, BRISK and KAZE live under `cv.xfeatures2d`. The contrib stereo module is now `xstereo`. The old native APIs removed by OpenCV 5 are not retained as compatibility shims.

## DNN

Model readers accept OpenCV 5's engine selection, including `cv.dnn.ENGINE_NEW` and `cv.dnn.ENGINE_CLASSIC`. Direct inference retains the upstream default `ENGINE_AUTO`. G-API inference supports both CPU engines, with input and output names mapped through the selected engine's native graph. Its existing float tensor, image preprocessing, region and list contracts remain in place.

The classic engine supports the typed custom-layer adapter. New-engine model operators come from the compiled upstream implementation; every operator and model has not been tested. GPU, WebGPU, OpenVINO and ONNX Runtime backends are not included.

`filter2Dp` exposes `Filter2DParams`, including the border scalar. OpenCV 5.0 currently rejects a nonzero `borderValue`; this upstream restriction is preserved and tested.

The [coverage report](coverage.md) measures Python 5 names and constants. The [test inventory](testing.md) separately records executed behavior in Node and Chromium.

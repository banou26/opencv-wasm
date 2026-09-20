---
title: Compatibility and limits
description: Measured Python inventory, compiled modules, supported runtimes, and explicit exclusions.
---

This build targets OpenCV and opencv_contrib **5.0.0**, with **56 configured CPU modules**. It runs in current SIMD-capable browsers, ES module workers and Node 22 or later. The binary is single-threaded, begins with 128 MiB of native memory and can grow to 1 GiB.

## Python name inventory

The reference is `opencv-contrib-python-headless==5.0.0.93`. The wheel itself does not contain every possible contrib module; this package additionally includes areas such as FreeType, HDF5 and SFM.

| Measurement | Count |
| --- | ---: |
| Reference symbols | 4,899 |
| Matching names, kinds and constant values | 4,543 |
| Adapted names | 3 |
| Missing in-scope names | 16 |
| Excluded GPU, desktop, backend or packaging names | 337 |
| Missing same-named class methods | 2 |

This is **4,546 / 4,562 in-scope names, or 99.6%**. It is not 99.6% behavioral parity. Signatures, destination arguments, NumPy behavior, resource ownership and some graph interfaces differ. Every algorithm and overload has not been exercised.

## Deliberate boundaries

- CPU WASM SIMD is supported. CUDA, accelerated OpenCL, WebGPU and WebNN are not enabled.
- Native desktop windows and native camera devices are not exposed. Use browser UI and media APIs.
- Video I/O covers MJPEG AVI and image sequences; general containers need a separate decoder.
- DNN and graph inference use OpenCV DNN. OpenVINO and ONNX Runtime graph backends are absent.
- Graph streaming is the package’s serial asynchronous adapter, not the native parallel streaming executor.
- Python decorators, dynamic graph types, arbitrary Python objects, keyword arguments and NumPy semantics are not emulated.
- HDF5 compression filters, AVIF, some font dependencies and application model assets are not included.

`datasets`, `dnn_objdetect`, `superres` and `videostab` are compiled targets with limited exposed APIs because most of their C++ algorithms lack the binding annotations used by this generator.

## What has actually been tested

The package suite executes real WASM in Node and Chromium, including worker loading, codecs, features, optical flow, ML, DNN, contrib modules, graphs, OCR, fonts, HDF5 and SFM. Separate type fixtures check both accepted and rejected calls. Package tests install a tarball into a fresh consumer and run a Vite production bundle.

This documentation site adds browser checks for the image lab, reference navigation and interactive diagrams. Cadence adds comparisons with Python fixtures and real 16-bit source footage. Firefox, Safari, every model operator and maximum-memory workloads remain unverified.

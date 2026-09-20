# Coverage

This release builds OpenCV and opencv_contrib **5.0.0** with **56 configured CPU modules**. It uses a custom native binding generator and typed JavaScript adapters. It is not a drop-in implementation of Python's `cv2` API.

The [native manifest](../lib/coverage.json) records configured modules, generated declarations and unbound signatures. The [Python comparison](../lib/python-parity.json) records individual names, constants, adapted factories and missing methods against `opencv-contrib-python-headless==5.0.0.93`. That wheel is a concrete reference, not the union of all possible Python builds; this build additionally includes FreeType, HDF5 and SFM.

## Python inventory

| Category | Count |
| --- | ---: |
| Reference symbols | 4,899 |
| Names with matching kinds and constant values | 4,543 |
| Adapted graph factories and functions | 3 |
| Missing symbols | 16 |
| Symbols with different constant values | 0 |
| Excluded GPU, desktop, backend or Python packaging symbols | 337 |
| Missing same-named class methods | 2 |
| Excluded NumPy and GPU class methods | 56 |

Counts concern names, not behavioral or signature parity. Modules, constants, aliases and constructors all contribute to the inventory. Native destination matrices, vectors, positional arguments, suffixed overloads and explicit disposal differ from Python. Adaptations cover `GArray`/`GOpaque`, custom typed kernels, matrix metadata, JavaScript frame sources and network packaging for the OpenCV DNN graph backend. `GComputation.compileStreaming` returns a serial asynchronous `GraphStreamHandle`. The native `GStreamingCompiled.setSource` and `.pull` methods remain unbound. See the JSON report for the complete missing-symbol list.

Supported and adapted names cover **4,546 / 4,562 in-scope symbols (99.6%)**, or **92.8% of the complete reference inventory**. Some graph adapters are additional APIs absent from the Python 5 wheel and therefore do not increase these counts. The 16 missing names concern dynamic graph types, native streaming/GStreamer/Python source adapters and upstream utility helpers. See [OpenCV 5 migration](opencv-5.md) for the breaking changes from package 0.0.5.

## Included CPU functionality

Core, image processing and codecs, calibration, features, FLANN, ML, photo processing, video algorithms, object detection, stitching, alpha matting, ArUco, background subtraction, retina models, omnidirectional calibration, DNN, super-resolution DNN models, face algorithms, fuzzy processing, hierarchical segmentation, image hashing, intensity transforms, line descriptors, color checking, optical flow, phase unwrapping, plotting, image quality, pose tracking, registration, RGB-D, saliency, shapes, signal processing, stereo, structured light, surface matching, text, tracking, WeChat QR detection, and xfeatures2d/ximgproc/xobjdetect/xphoto.

SIFT and SURF are included, with `OPENCV_ENABLE_NONFREE=ON`. Native image codecs include PNG, JPEG, WebP, TIFF, JPEG 2000 and OpenEXR, plus OpenCV's built-in formats. UMat uses CPU storage.

| Added area | Implemented boundary | Limits |
| --- | --- | --- |
| G-API | CPU graphs, typed values, drawing, custom TypeScript matrix/scalar/array/opaque kernels, DNN tensor/region/list inference, serial asynchronous streams and native frame metadata | No native parallel streaming, desync regions or OpenVINO/ONNX Runtime backends |
| Video I/O | MJPEG AVI files and image sequences in the virtual filesystem | No FFmpeg, GStreamer or native camera backend |
| FreeType/HarfBuzz | Font loading, shaping, drawing and metrics | Compressed/bitmap font dependencies such as PNG, Brotli and bzip2 are disabled |
| Tesseract/Leptonica | Native OCR, including LSTM recognition | App supplies language data; Leptonica's own file codecs and command line tools are disabled |
| HDF5 | Datasets, attributes, indexed reads/writes and file persistence | No gzip/SZIP filters, network filesystem, parallel HDF5 or HDF5 C++ API |
| SFM/Ceres | Multi-view geometry and libmv reconstruction with bundle adjustment | CPU Eigen solver; no SuiteSparse, LAPACK or CUDA acceleration |
| Custom DNN layers | Typed synchronous factory, shape and forward callbacks | Callback matrices are borrowed and outputs are preallocated |

The additional `datasets`, `dnn_objdetect`, `superres` and `videostab` targets are configured and compiled, but most of their C++ algorithms lack Python binding annotations and are not exposed by this generator. A configured target does not imply that all its C++ APIs are callable.

## Remaining exclusions

- CUDA, accelerated OpenCL, WebGPU and WebNN. Computation runs on the CPU with WASM SIMD.
- Desktop windows and event loops, native camera devices, ovis, viz and cvv. `highgui` is linked as a calibration dependency; its window API is not exposed.
- G-API's Python-specific dynamic types and decorators, native parallel streaming and GStreamer sources, plus a few upstream utility/test helpers. OpenVINO and ONNX Runtime graph backends are not linked. Graph inference uses OpenCV DNN, with float tensors and the limits described in [graph inference](graph-inference.md).
- AVIF images and general video containers requiring FFmpeg or GStreamer.
- Python/NumPy object behavior, keyword arguments, Python exception classes and general Python callbacks. DNN callbacks have an explicitly typed JavaScript adapter.

The binary is single-threaded, starts with 128 MiB of memory, and can grow to 1 GiB. Native resources require explicit disposal. Models, training data and fonts are supplied by applications. Leptonica can print warnings about its disabled file codecs while initializing OCR; the tested LSTM recognition path works with OpenCV matrices.

## Verification

Tests execute real WASM in Node and Chromium, including an ES module worker. They cover image conversion and all six listed image codecs, SIFT/SURF/ORB descriptors, SVM training/prediction, ONNX inference, ArUco generation, thinning, optical flow, background subtraction, FLANN, CPU UMat, EMD, omnidirectional projection, QR bytes, native files and output result objects.

The parity tests additionally check graph pixel and scalar results, graph drawing, MJPEG AVI round trips, Python aliases, custom TypeScript DNN layers, callback failure cleanup/recovery, font glyphs, OCR text, HDF5 matrix/attribute persistence, SFM triangulation and Ceres reconstruction. Additional cases execute 16 contrib modules, compare ten of them with native Python fixtures, and exercise custom G-API kernels, asynchronous frame streams, cancellation, source replacement and handle retention. New graph inference checks cover multi-input/output ONNX models, tensor reshaping, preprocessing, cropped regions, mixed region/tensor lists, empty lists, failure recovery and streaming model ownership, with selected results compared to native Python DNN. Frame metadata and disposal after release failures are also tested. Typed custom kernel checks execute every supported port kind, native drawing primitives, 64-bit boundaries, malformed callback results and cleanup after callbacks mutate their argument arrays. Type fixtures accept valid calls and reject incompatible native handles, asynchronous native callbacks, incorrect pixel arrays, invalid scalar shapes and unknown API members. See [the execution test inventory](testing.md).

Package verification compares declared native exports/methods against the runtime. A separate consumer installs the tarball, checks strict NodeNext declarations with `skipLibCheck: false`, loads it in Node, then bundles and runs a Vite production app in Chromium.

Every algorithm, model operator and overload has not been behaviorally tested. Firefox, Safari, large production models, maximum-memory operation and performance relative to native Python remain unverified.

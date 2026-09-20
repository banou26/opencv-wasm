---
title: Files, codecs and assets
description: Move bytes between your application and OpenCV's virtual filesystem, with explicit format and asset limits.
---

Each OpenCV instance owns an in-memory filesystem, `cv.FS`. Native paths refer to this filesystem. They are not host paths, URLs or browser file handles.

```ts
const response = await fetch('/assets/model.onnx')
if (!response.ok) throw new Error(`Model request failed: ${response.status}`)
cv.FS.writeFile('/model.onnx', new Uint8Array(await response.arrayBuffer()))
using model = cv.dnn.readNetFromONNX('/model.onnx')
cv.FS.unlink('/model.onnx')
```

## Image formats

Native image codecs include PNG, JPEG, WebP, TIFF, JPEG 2000 and OpenEXR, plus OpenCV’s built-in formats. AVIF is not included. Use `decodeImage` and `encodeImage` when the application already owns the bytes.

Decoded colour images use BGR or BGRA. The helpers can preserve 16-bit pixels; a round trip through an 8-bit canvas cannot. Be deliberate about precision when porting scientific images or reconstruction pipelines.

## Video

Native `VideoCapture` and `VideoWriter` support MJPEG AVI files in `cv.FS` using `cv.CAP_OPENCV_MJPEG`, and image sequences through `cv.CAP_IMAGES`. FFmpeg, GStreamer and native camera devices are not linked.

In a browser, obtain camera frames with browser media APIs. Decode other video containers with a separate media pipeline, then give OpenCV the decoded frames. In Node, applications such as Cadence can use FFmpeg externally for video packaging.

## Fonts, OCR and data files

| Feature | Application asset | Important limit |
| --- | --- | --- |
| FreeType text | TTF or OTF file | Some compressed and bitmap font dependencies are disabled |
| Tesseract OCR | Matching `.traineddata` language files | Language data is not bundled |
| DNN | Model files and any required auxiliary data | Operator support varies by model |
| HDF5 | Dataset file in `cv.FS` | This build omits gzip/SZIP filters and parallel HDF5 |

Close HDF5 files before reading their final bytes. Some native APIs borrow an asset buffer; follow the parameter’s lifetime note instead of disposing it immediately after loading.

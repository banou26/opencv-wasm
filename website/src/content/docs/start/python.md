---
title: Coming from Python
description: Translate cv2 and NumPy patterns into typed OpenCV handles and explicit JavaScript arrays.
---

Examples use named imports after one `await initOpenCV()` call. See the [initialization guide](/start/quickstart/#named-imports-and-initialization).

The algorithms are compiled from OpenCV 5 C++. The JavaScript interface follows native argument order, destination matrices and explicit resource lifetime. Python names are widely available, but NumPy behavior and Python calling conventions are not emulated.

| Python pattern | TypeScript pattern |
| --- | --- |
| `gray = cv2.cvtColor(image, code)` | `using gray = new Mat(); cvtColor(image, gray, code)` |
| `np.array(...)` | `matFromArray(rows, cols, type, typedArray)` |
| Array slicing for an image region | Native ROI or an explicit JavaScript copy, with attention to row stride |
| Returned tuples | Named result fields, such as `getTextSize(...).value` and `.baseLine` |
| Garbage-collected NumPy arrays | `using` or explicit `delete()` for native handles |
| Keyword arguments | Positional arguments from the exact TypeScript overload |
| `cv2.imread(hostPath)` | Read bytes yourself and `decodeImage`, or put a file in `FS` |

## Factories and namespaces

Both familiar aliases and native class factories are typed. OpenCV 5 also moves some feature algorithms into `xfeatures2d`; inspect the actual reference instead of assuming the OpenCV 4 layout.

```ts
import { KeyPointVector, Mat, SIFT_create } from '@banou/opencv-wasm'
using detector = SIFT_create()
if (!detector) throw new Error('SIFT was not created')
using points = new KeyPointVector()
using descriptors = new Mat()
using noMask = new Mat()
detector.detectAndCompute(image, noMask, points, descriptors)
```

## Overload families

Some native overload groups have separate names, such as `findHomography1`, `train1` or `from1`. The suffix identifies a binding family, not a quality level. Read its signatures to see the accepted types and returned fields.

## Preserve numeric intent

JavaScript arithmetic uses double precision. Assigning to a `Float32Array` rounds to float32; `Math.fround` can reproduce an intermediate float32 operation when a migration needs it. NumPy integer casts, OpenCV saturated conversions and JavaScript typed-array casts do not have identical behavior.

For a faithful port, compare masks, shapes, coverage and numeric outputs with native fixtures. Small floating-point differences can cross a discrete threshold and alter a connected region or crop boundary. A name-coverage percentage cannot establish this behavior.

See [compatibility](/reference/compatibility/) for the measured Python inventory.

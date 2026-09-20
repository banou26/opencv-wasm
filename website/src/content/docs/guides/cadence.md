---
title: 'Case study: Cadence'
description: Port a real 16-bit image reconstruction workflow from Python to TypeScript and measure the differences.
---

Cadence reconstructs a translating background and held foreground drawings from source footage. The initial TypeScript migration covers the core `test/` workflow: image reconstruction, extraction, alpha-aware composition, scoring, support diagnostics, comparison video and contact sheets. The larger collection of research scripts is still being migrated.

## Preserve the evidence

The footage uses 16-bit BGR images. The port keeps that precision through native PNG decoding, typed arrays and matrix construction. It stores JavaScript-owned copies when pixels must survive a native heap change.

Background alpha records observation coverage. Unobserved pixels stay unknown and are counted separately in scores. Premultiplied colour and alpha use the same sampling maps, preventing hidden RGB from bleeding across transparent edges.

## Compare behavior with Python

Frozen Python fixtures test image filtering, remapping, connected regions, morphology, distance transforms, temporal median selection, mask splitting and compositing. SciPy’s exact distance transform and its nearest-pixel tie behavior required an explicit TypeScript implementation.

A complete 117-frame, 1920×1080 extraction ran in TypeScript and found the same four layers and 78 held drawings as the native Python reference. It was not pixel-identical: subpixel motion differences can change thresholds, masks and bounding boxes. Those differences are reported instead of being hidden by a name-parity percentage.

## Separate correctness from speed

The first complete WASM extraction took 1,210 seconds. After improving typed-array upload, pixel copying and median selection, an isolated rerun took 373 seconds. Its decoded images, manifest and evidence arrays were identical to that first WASM run. The native Python extraction took 216 seconds on the same machine. These are individual wall-clock measurements, not a controlled hardware benchmark; other validation jobs ran concurrently.

The workload exposed avoidable overhead in matrix construction: copying a numeric typed array element-by-element. Bulk upload improved a measured 1080p float32 upload microbenchmark by about 24×. This does not imply that the whole reconstruction pipeline is 24× faster.

The lesson is practical: validate image semantics, coverage, numeric tolerances and end-to-end outputs, then profile the actual bottlenecks. Native API availability alone does not establish a successful application migration.

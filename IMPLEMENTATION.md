# OpenCV edition

The 2026-09-22 request resumes the September design with `@banou/opencv-wasm`.
`PLAN.md` is retained as the original design; this note records the changed runtime.

- Keep the five starter nodes, typed ports, independent graph engine, selected-node
  inspection, frame-exact WebCodecs access and explicit range baking.
- Run native OpenCV operations inside one module worker using named imports.
  Cached frame payloads own native Mats. The engine owns their lifetime through
  leases and a byte-bounded LRU; WebGPU owns only the presentation texture.
- OpenCV 0.0.6 runs on the CPU. WebGPU presentation does not make its algorithms
  GPU accelerated. Native calls finish atomically; cancellation is checked between
  operations and frames, and superseded requests never replace newer previews.
- Video decoding initially produces 8-bit RGBA. Existing 16-bit source PNGs are
  not silently treated as equivalent to the playable MP4 previews.
- No interpolation, segmentation or motion-estimation pipeline is included in
  this milestone. The node interface is where those experiments will be added.

The app is local: selected files remain in the browser. Sample scenes are copied
from the neighbouring Cadence checkout into an ignored directory for development.

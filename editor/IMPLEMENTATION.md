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
- The owner's follow-up requires the complete video-in / generated-frames /
  video-out loop. Add global translation estimation and source-pixel warping as
  an explicit example, plus subframe inspection and a streamed H.264 MP4 bake.
  This is a camera-motion experiment, not a finished layer interpolator.
- Baking maps the chosen output rate onto rational source-frame times and
  encodes incrementally. It retains compressed samples under a 512 MiB limit,
  replacing the old plan's 1 GiB raw-frame store. Playback uses the generated
  video; it never runs the graph in real time. Audio is not part of the graph.

The app is local: selected files remain in the browser. Sample scenes are copied
from the neighbouring Cadence checkout into an ignored directory for development.

Later owner steering, implemented in this iteration:

- Favor primitive operations over an opaque interpolation node. Translation is
  split into X and Y primitives. The provided Translate node is an editable custom
  definition, and the camera prefab wires explicit Time and Multiply nodes.
- Custom nodes have named typed inputs/outputs, shared definitions, independent
  instance values, nested graphs and editor tabs. Internal previews bind to the
  actual parent instance. Definitions expand into the primitive execution plan.
- Enable optional previews above the nodes themselves; selected-node inspection
  remains useful for larger images, zoom and pixel values.
- Add nodes through a cursor-positioned right-click menu or Shift A, with categories
  and typo-tolerant search across names, native algorithms and parameter labels.
- Preserve reusable prefabs as editable ordinary graphs, and allow grouping a
  selected subgraph into a real reusable custom node with a typed interface.

- Attach media to individual Video Source nodes. Canvas drops create sources;
  drops on a source replace its clip. Queue multi-file imports and retain stable
  source identities for saved graphs and isolated native cache entries.
- Use Chrome's File System Access API for project folders: debounced graph sync,
  streamed source-media copies, explicit artifact exports and reopen support.
  Open the folder picker on the first save, retain earlier exports, and detect
  outside edits instead of silently replacing them. No download fallback remains.
- Desktop Chrome remains the supported browser. WebGPU presentation is required;
  file controls remain accessible during engine startup, and initialization
  failures are surfaced with a reload action.

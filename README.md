# Cadence Editor

A local visual workbench for building anime layer-interpolation experiments from
small, typed operations. Open a video, inspect frames and intermediate results,
compose your own processing graph, generate frames at a different rate, then
watch and save the resulting video.

Native processing uses the published **`@banou/opencv-wasm@0.0.6`** package inside
an isolated worker. WebGPU displays the large preview; OpenCV runs on the CPU.

## Run

```sh
npm ci
npm run samples  # optional: copy the six recovered clips from ../cadence/work/peek
npm run dev
```

Open **http://localhost:4560** in desktop Chrome on your normal graphics session.
Node 24+ is required for the toolchain. The browser needs WebGPU and WebCodecs.
Files stay on your machine. Recovered scenes, uploaded media and generated outputs
are not included in Git.

For a production build, use `npm run build` and `npm run preview`. The static
output is `dist/`. Its OpenCV WASM asset is approximately 46 MiB, so the host must
accept that asset size. The development preview runs on port 4561.

## Work in the graph

- The editor fits the browser window: the graph and inspector share the available
  space, with the timeline and render controls docked below. Drag the divider to
  resize the panels. Narrow windows use **Node graph / Inspector** buttons.
- **Node preview / Rendered video** switches the inspector between the selected
  node and the last movie. Rendering opens the video view when it finishes;
  **View video** also opens it. **About this step** opens a scrollable explanation
  above its toggle, without shrinking the image. Custom interfaces and long lists
  scroll inside their panels, rather than moving the entire page.
- **Drop video files onto the canvas** to create one Video Source per file. Drop a
  file onto an existing source to replace that clip, or use its **Open file** button.
  Each source keeps its own media; the source dropdown can reuse an already loaded
  clip. File selection is available while the engine starts.
- **Right-click** empty space or press **Shift A** to add a node at that location.
  Browse categories or search names, native algorithms and properties. Searches
  such as `gausian`, `raduis` and `transalte` tolerate spelling mistakes.
- Drag between matching colored sockets. Image, number and motion connections
  are distinct. An input accepts one connection; a new connection replaces it.
  Type mismatches and cycles are rejected by both the UI and the execution engine.
  Sockets have enlarged hit areas: hovering lights up the dot and its row. While
  wiring, a green destination accepts the connection; a red one rejects it.
- **Right-click a wire → Disconnect wire**, or select it and press **Delete**.
  Selected wires also show a **Disconnect wire** button below the graph.
  **Right-click an input socket → Disconnect input** works without finding the
  wire. Output sockets list each branch and can disconnect all outputs together.
  Nodes stay in place, and **Ctrl Z** restores the removed connections.
- Drag the node title, preview bar, or preview image to move it. Buttons and
  parameter fields stay interactive.
- Numeric parameters update the graph and preview as you type a valid value;
  there is no need to press Enter or leave the field. Incomplete or out-of-range
  input keeps the last valid value until you finish typing.
- Click a node to select it for editing. The large inspector keeps its current
  target while you select, move, add or duplicate nodes. **Right-click → Select for
  preview** changes that target. Select an output socket in the inspector for
  nodes that produce several values. The inspector step buttons also explicitly
  choose a preview; each editor tab remembers its own preview target.
- **Show/Hide** on a node toggles its preview above its controls. **Show all
  previews** enables the active graph's previews together. They evaluate at the
  current source time and share the native result cache.
- Scroll over the large image to zoom around the cursor, drag to pan, hover to
  inspect pixels, or pin the pixel readout. **Fit**, **1:1** and PNG export are
  available. View gain helps reveal small differences and does not affect MP4s.
- Shift-select multiple nodes; **Delete** removes them. **Ctrl C/V** copies and
  pastes a subgraph within the editor; **Ctrl D** duplicates it. **Ctrl Z** and
  **Ctrl Shift Z** undo and redo graph edits. Layout dragging is not recorded in
  the undo history.
- After Shift-clicking nodes or Shift-dragging a selection box, right-click a
  selected node, the selection box, or empty canvas for **Delete selected nodes**,
  duplicate, grouping and prefab actions. Deletion removes attached wires too;
  one **Ctrl Z** restores the whole batch. Custom-node boundary nodes stay in place.

## Make reusable custom nodes

Select operations and press **Ctrl G**, or right-click and choose **Make custom
node**. Cadence replaces the selection with an instance, exposes its boundary
connections as typed ports, and opens its implementation in another editor tab.

Inside the custom node, **Group Inputs** supplies the instance's external values;
**Group Outputs** exposes your results. Rename the utility and add, rename,
remove or retype its ports in the interface panel. Connect those ports to the
internal operations as you would any other nodes. Numeric inputs have a fallback
value on each instance; a connection overrides it.

Double-click a custom node, click **Edit internal nodes**, or press **Tab** with
it selected to enter it. The main graph and nested custom nodes remain accessible
as tabs. Internal previews use the inputs of the instance you entered. Definitions
are shared: editing their internal flow updates every instance. Values on each
instance remain independent. Recursive custom definitions are rejected.

The included **Translate** utility is an ordinary custom definition:

```text
Group Inputs.Image → Translate X → Translate Y → Group Outputs.Image
Group Inputs.X ──────↑              ↑
Group Inputs.Y ─────────────────────┘
```

There is no special Translate execution kernel. It is built from the same
`Translate X` and `Translate Y` primitives available in the add menu. Each axis
uses spatial bilinear sampling and leaves uncovered pixels black.

Built-in **prefabs** expand into normal nodes, including the camera example:

```text
frame N, frame N+1 → Estimate Translation → Δx, Δy
Time.Fraction × Δx → Translate.X
Time.Fraction × Δy → Translate.Y
frame N ──────────→ Translate.Image → Output
```

This example estimates one global translation. It is a starting graph to inspect
and change, not a finished layer interpolator. Other prefabs demonstrate filtering,
frame comparison and a changed-pixel mask.

**Save graph** includes the custom-node library. **Open graph** replaces the
working project. **Save prefab** in the node context menu saves the selection;
**Insert prefab** imports it as independent nodes and merges its definitions.
Changing a port's type or removing it disconnects incompatible wires; Undo restores
the previous interface and connections. An exported graph records clip identities
and filenames; reattach missing clips in their source nodes after opening it.

## Save a project folder

In desktop Chrome, choose **Project folder…** once and grant folder access. Saving
a graph, PNG, prefab or MP4 also opens this picker when no folder is selected. New
folders save the current graph; a folder containing `cadence-graph.json` opens
that project and reloads its media before autosave starts.

- `cadence-graph.json` includes the graph, layout, custom-node definitions and
  media references. Edits autosave after a short pause; **Save now** flushes them.
- `media/` contains one copy of each attached clip used by the saved graph. Clips
  are streamed to disk, without reading the entire file into JavaScript memory.
- `exports/` receives PNGs, saved prefabs and MP4s when you click their save buttons.
  Repeated exports receive numbered filenames instead of overwriting older ones.

Reopen the same folder after a browser restart. Folder access uses Chrome's
[File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
on localhost or HTTPS. The folder status shows pending writes and errors. Outside
edits to the JSON file block autosave until you reopen the folder; the editor does
not merge concurrent edits. Saves always use the project folder; there is no
download fallback. To save the current graph into another project, choose a new
folder; an existing project must be opened explicitly instead of overwritten.
Autosave keeps graph edits; it does not automatically rerender or export a movie.
Old media copies are retained when you remove nodes, so you can recover earlier work.

## Available building blocks

| Purpose | Nodes |
| --- | --- |
| Inputs and time | Video Source, Number, Time, Frame Offset, Extract Frame |
| Image preparation | Grayscale, Gaussian Blur |
| Measurements | Frame Delta, Estimate Translation |
| Numeric operations | Multiply |
| Pixel transforms | Translate X, Translate Y |
| Masks and layers | Threshold Mask, Masked Composite |
| Results | Output, custom-node inputs and outputs |

`Time` exposes source-frame time, its fractional remainder and seconds.
`Frame Offset` changes the requested time throughout its upstream branch.
`Extract Frame` pins its upstream branch to an absolute, zero-based frame index,
independent of the timeline. Add it with **Right-click → Time → Extract Frame**
or search for its name. **Frame N (from 0)** updates the result as you type.

For an arbitrary frame-pair comparison, connect one Video Source to two Extract
Frame nodes (for example, N = 2 and N = 7), then connect them to Frame Delta's A
and B inputs. Both frames remain fixed as you scrub; even Delta's default B offset
does not move a pinned frame. An out-of-range index produces an explicit error.
Filters before extraction run at the chosen time, and upstream Frame Offset nodes
still apply their own offsets.
`Frame Delta` produces an image and mean absolute luma difference.
`Estimate Translation` produces X/Y displacements, a diagnostic response and an
arrow preview. Its arrows repeat a **single global vector**, enlarged 4× for
visibility; they are not a dense motion field. Regions is a reserved interface
type; this initial node set does not yet produce region collections.

## Generate and preview video

1. Open an MP4 and wire an image into an Output node.
2. Scrub the source-frame timeline. Use **Between frames** to inspect fractional
   times, which your graph can use through the Time node.
3. Choose a root Output, inclusive source-frame range and output frame rate.
4. Render, play the generated video, and save its MP4 to the project folder.

Output timestamps are mapped to source time using rational rates, including
24000/1001. The source node holds its earlier integer frame; your graph explicitly
creates any intermediate positions. Rendering encodes incrementally rather than
retaining every raw output frame. **Stop and keep completed frames** finalizes a
playable partial movie when any frames have completed. An existing movie is a
snapshot; editing the graph does not silently update it.

Current limits:

- This is a working editor foundation, not automatic layer extraction or finished
  anime interpolation. Difference masks mark changes; they do not establish scene
  ownership. Camera translation fails on cuts, parallax and independent motion.
- Input uses an MP4 video track decoded to 8-bit RGBA, then normalized float32
  OpenCV matrices. It is not the precision path for the recovered 16-bit PNGs.
  Export is silent H.264 MP4; audio is not processed. Remux MKV before loading.
- The timeline uses frame indices and a nominal source frame rate. Use constant
  frame rate clips for meaningful timing. Sources keep separate clips and align
  by frame index; the **Timeline reference** sets the frame rate used for time and
  rendering. There is no automatic rate conversion between input clips. Unbound
  prefab sources follow the reference clip until you attach their own media.
- Temporal branches need valid source frames. An N+1 graph cannot render the last
  source drawing without another drawing after it. No hidden frame clamping occurs.
- Native calls finish atomically; cancellation occurs between operations and frames.
  Rendering is offline, not a promise of real-time 60 fps processing.
- The native result cache is 512 MiB. That is not a total process-memory limit:
  decoder frames, scratch matrices, WebGPU textures and the WASM heap also use
  memory. Encoded exports have a separate 512 MiB budget.

## Verify

```sh
npm run typecheck
npm test
npm run lint
npm run check:manifest
npm run smoke
```

The browser smoke requires `ffmpeg`, `ffprobe`, the system `google-chrome-stable`
wrapper and a working graphics session. It starts a muted Chrome with a temporary
profile and connects through CDP, preserving the normal GPU/video configuration.
Set `CHROME_BIN` to another system Chrome wrapper if needed. `APP_URL` and
`CDP_URL` can point to an already-running production preview and disposable test
browser. Avoid Playwright's default browser launch flags for these GPU tests.
Artifacts and generated fixtures are written to ignored `build-smoke/`.
Pixel checks compare native outputs against independent calculations and FFmpeg,
including backward/open-GOP seeks. Browser checks exercise custom ports, nested
tabs, previews, file drops, per-source bindings, MP4 playback and partial renders.
Layout checks cover six window sizes, docked controls, expanded interfaces and
switching between image/video previews without replacing the WebGPU canvas.
Folder tests use real browser filesystem handles and streams from OPFS, substituting
only the native OS folder picker; they check media copies, autosave, reopening,
exports and protection against outside edits.

## Code layout

- `src/engine/`: browser-independent graph validation, typed definitions, custom
  node expansion, time demands, search, scheduling and owned LRU results.
- `src/video/`: indexed MP4/WebCodecs input and incremental H.264/MP4 output.
- `src/worker/`: native OpenCV primitives, result ownership and request processing.
- `src/gpu/`: WebGPU presentation of the selected native result.
- `src/ui/`: React Flow editor, context menu, custom-node tabs, preview and render UI.
- `tests/`: engine and ownership checks; `scripts/smoke.mjs`: real browser/pixel tests.

To add a primitive, declare its ports, parameters and explanation in `specs.ts`,
then implement its kernel. Native results must have one cache owner and release
all temporary matrices, including on failure. A custom node needs no new kernel:
its interface expands into ordinary operations before execution.

`PLAN.md` is the original archived design. `IMPLEMENTATION.md` records the owner's
subsequent changes to that design.

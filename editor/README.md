# opencv-wasm editor

A browser visual workbench for building OpenCV and video-interpolation experiments from
small, typed operations. Open a video, inspect frames and intermediate results,
compose your own processing graph, generate frames at a different rate, then
watch and save the resulting video.

Native processing uses the published **`@banou/opencv-wasm@0.0.6`** package inside
an isolated worker. WebGPU displays the large preview; OpenCV runs on the CPU.

## Run

```sh
npm ci
npm run samples  # optional: copy local clips from a neighboring cadence checkout
npm run dev
```

Open **http://localhost:4560/editor/** in desktop Chrome on your normal graphics session.
Node 24+ is required for the toolchain. The browser needs WebGPU and WebCodecs.
Files stay on your machine. Recovered scenes, uploaded media and generated outputs
are not included in Git.

The deployed editor is **https://opencv.banou.dev/editor/**, beside the docs.
From the repository root, `npm run docs:build` builds both into `website/dist/`.
The existing Cloudflare Pages build command and output directory stay the same.
Native WASM is downloaded in verified 16 MiB chunks, shared with the documentation
runtime when their package versions match. Hosted builds exclude all local samples.

For a standalone build, use `npm run build` and `npm run preview`, then visit
`http://localhost:4561/editor/`. Serve `dist/` under `/editor/`, not at the site root.
`npm run build:site` is for the combined docs build and expects `/runtime/` at the
site root; `website/scripts/stage-editor.mjs` assembles that layout.

### Engine download recovery

Runtime generation publishes complete files with atomic replacement and skips
unchanged bytes. It no longer deletes the served runtime directory before writing
chunks; that created a window where an open editor could receive missing assets,
HTML fallbacks or incomplete downloads during a build. Previous content-addressed
chunks and unrelated files are retained during in-place regeneration.

Each failed HTTP, truncated or HTML chunk response gets one cache-bypassing retry.
The complete binary must still pass SHA-256 verification. Persistent errors name
the failing URL and, for incomplete responses, expected and received byte counts.
A fatal engine error clears pending imports and the `Indexing clip...` indicator,
stops the worker, and rejects new processing until **Reload engine** is selected.
After reloading, reselect any clip whose import had not completed.

For missing local assets, run `npm run generate`, then reload. Do not serve the
combined `build:site` output as a standalone editor: its `/runtime/` paths require
the assembled website layout described above. Tests for download failures and
import cleanup run with `npm test`; atomic-publication tests run from this folder
with `node --test ../tests/runtime-assets.test.mjs`.
With the local dev server running, `node scripts/engine-startup-smoke.mjs`
checks transient failures, fatal cleanup and reload/import recovery in real Chrome.

The full original Cadence Editor history is preserved as a merge parent. Use
`git log --all --graph` from the repository root to browse both histories. The
original standalone checkout can remain as a backup; development now happens here.

## Work in the graph

- The editor fits the browser window: the graph and inspector share the available
  space, with the timeline and render controls docked below. Drag the divider to
  resize the panels. Narrow windows use **Node graph / Inspector** buttons.
  At 600px and narrower, the page scrolls vertically to preserve preview space;
  timeline and render controls remain accessible below it.
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
- Drag between matching colored sockets. Video, frame, number, boolean, text,
  vector, rectangle, frame-list and record connections are distinct. Socket labels
  show their types as well as their colors. An input accepts one connection; a new connection replaces it.
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

Hover the **ⓘ** button on any node to read its description. Click to pin it open,
or press Escape to dismiss it. Text stays readable when zooming out.

Press **< / >** (or **comma / period**) to step backward or forward in the active
preview. Node previews advance the source timeline; rendered videos pause and step
at their own output frame rate, including while the player or its controls have
focus. Typing in a field keeps the shortcuts inactive.

The rendered-output player displays exact decoded frames on a canvas. Its worker
decodes keyframes and dependencies privately, then presents only the requested
frame; the previous image stays visible while a seek finishes. Both source and
output decoders reuse recent decoded frames in either direction, retaining up to
128 MiB or 256 frames per reader. A single requested frame can exceed that budget;
decoder surfaces and frames currently being displayed are additional memory.
Seeking outside this cache still decodes from an earlier keyframe. Use its frame
number field or draggable timeline to jump, **Space** to play/pause when the
image has focus, and the speed, loop and fullscreen controls for playback.
Playback can skip frames to keep up with elapsed time; paused stepping always
selects a single frame. The exported MP4 is unchanged.

## Make reusable custom nodes

Select operations and press **Ctrl G**, or right-click and choose **Make custom
node**. The editor replaces the selection with an instance, exposes its boundary
connections as typed ports, and opens its implementation in another editor tab.

Inside the custom node, **Group Inputs** supplies the instance's external values;
**Group Outputs** exposes your results. Rename the utility and add, rename,
remove or retype its ports in the interface panel. Connect those ports to the
internal operations as you would any other nodes. Number, boolean and text inputs
have fallback values on each instance; a connection overrides them.

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

Built-in **prefabs** expand into normal nodes. **Camera in-betweens** reads frame
N and N+1 explicitly, estimates their global translation, and moves the earlier
drawing by `fraction × delta`. Its **Fill revealed borders** group aligns the
next drawing with `(fraction − 1) × delta`, then fills the uncovered strip:

```text
Previous frame → Translate(fraction × delta) ───────────→ background
Next frame → Translate((fraction − 1) × delta) ─────────→ foreground
White masks → same transforms → (next − previous) > 0 ─→ fill mask
                                                        ↓
                                                Masked Composite → Output
```

The masks measure canvas coverage, so real black pixels inside the source are
preserved. Where the previous frame covers the image at least as well, its pixels
stay unchanged. Where the next frame covers more, its aligned pixels replace them.
Comparing both masks also avoids replacing a partly covered corner with a wholly
unknown next-frame pixel. This avoids temporal blending. The group exposes the
filled frame, previous coverage, aligned next frame and fill mask for inspection.
Open it to edit the ordinary Multiply, Math, Translate, Subtract, Threshold and
Composite nodes. If neither source covers a corner, it stays empty. Cuts,
parallax, independent movement or a wrong motion estimate can still produce a
seam; this is a global camera experiment, not automatic layer interpolation.

**Process a region** demonstrates Rectangle → Crop Frame → Gaussian Blur → Paste
Region. Separate Rectangle wires the region’s X/Y back into Paste Region, so
editing the crop also updates where it is placed. The surrounding base pixels
remain unchanged. **Explore Laplacian
pyramids** uses an editable group of Pyramid Down, Frame Size, Pyramid Up and
Subtract Frames, followed by reconstruction. Both Gaussian and Laplacian
three-level groups are available in the Custom category. Their internals are
ordinary nodes, and the native pyramid nodes support a variable number of levels.

**Save graph** includes the custom-node library. **Open graph** replaces the
working project. **Save prefab** in the node context menu saves the selection;
**Insert prefab** imports it as independent nodes and merges its definitions.
Changing a port's type or removing it disconnects incompatible wires; Undo restores
the previous interface and connections. An exported graph records clip identities
and filenames; reattach missing clips in their source nodes after opening it.

## Whole-scene regional analysis

The **Whole-scene regional analysis** prefab is an evidence experiment, not a
finished layer extractor. Its ordinary typed nodes expose each actual stage:

```text
Scene Range -> Scene Dense Motion -> Multiscale Motion Cells
            -> Whole-Scene Motion Groups -> Motion-History Grouping
            -> Regional Drawing Events
```

Scene Range decodes a fixed inclusive range, independent of scrubbing. The prefab
defaults to the full clip through Video Info; disconnect Last frame to select a
shorter range. Use a single shot: cuts are not automatically segmented here.
The default longest side is 320 pixels, adjustable up to 640. A range exceeding
500 frames or ten million analysis pixels is refused before decoding.

Inspectors have a separate **Display max side** control, defaulting to 960 pixels
per panel, capped to the source dimensions. A 1920 x 1080 source therefore produces
a 1920 x 1080 four-panel review instead of 640 x 360. The source, family and event
panels use freshly decoded original artwork, not enlarged analysis pixels. Only
the current displayed frame is decoded on an inspector cache miss; full-resolution
frames are not retained for the whole scene. The flow and colored support still
come from the analysis grid, mapped without smoothing or invented fine boundaries.
Changing display size does not rerun scene analysis. Set it to 0 for the original
analysis-sized view, or up to 1280 per panel for larger output within the bounded
cache. Timing, velocity and conflict charts keep their own layout and do not decode video.
Saved graphs automatically acquire the new default; explicit display settings
are preserved. Re-render existing videos to use the new size.
On the same 117-frame market shot, the source-backed HD review exported all 293
frames at 60 fps in 6.33 seconds after 9.48 seconds of initial scene analysis.
Auto used one worker, with 244 MiB estimated cache storage before export. The
larger display adds per-frame decoding and rendering cost, not another full-scene
analysis for every frame.

Eleven separate inspector branches expose source pixels, motion, validity, cells,
original groups, motion families, velocity histories, motion conflicts, drawing
events, a timing timeline and the four-panel review. Only these
inspectors connect to Time. Analysis results are cached by the clip, range and
parameters, not accumulated as frames are visited. The final source frame has no
outgoing pair. Memory accounting includes retained JavaScript arrays as well as
native matrices; the usual cache budget still applies. Shared data is counted
once by allocation identity across cached stages, including typed-array backing
buffers. This prevents later stages from evicting earlier stages merely because
they retain the same scene data. Output images remain independently owned and
evictable. The byte count is an estimate of retained data, not a browser heap cap.

The 2026-09-23 cache regression used the real market shot (117 source frames,
320 x 180 analysis, 640 x 360 four-panel review, high-quality 60 fps export).
Previously, duplicate accounting reported 501 MiB with only seven cache entries
and reran the entire scene analysis for each exported frame. Counting shared
allocations once retained all stages at 216 MiB with 15 entries. In a one-worker
comparison, exporting the same 13 output frames fell from 137.08 seconds to
0.06 seconds after an approximately 11-second initial analysis. Decoded video
SHA-256 matched exactly:
`83c646770eb0dd1163d1bdeb5b3987a9ca3996e6531500cf18458637faffb53f`.
A full 293-frame export took 1.69 seconds with one worker and 12.64 seconds with
two workers; both produced the same decoded pixels. The final Auto check selected
one worker and took 1.40 seconds after 9.30 seconds of scene analysis, again with
identical decoded pixels. Each additional worker owns
its cache and must do its own initial scene analysis. These are local measurements,
not a throughput guarantee. Resolution, thresholds and analysis algorithms were
unchanged. Unit tests cover shared allocation lifetimes and failed insertions;
the native integration test forces output eviction while checking that analysis
executes once, pixels match an unconstrained cache, and parameter edits invalidate
the appropriate stages.

Reproduce the real-clip export benchmark from `editor/` after `npm run build`:

```sh
node scripts/regional-render-benchmark.mjs /path/to/single-shot.mp4
```

It opens the regional prefab in an isolated browser, exports the full clip with
Auto workers at 60 fps, and overwrites `build-smoke/regional-render.mp4` and
`build-smoke/regional-render.json`, plus a review screenshot. The report separates initial scene analysis
from rendering and verifies output frame count, dimensions, frame rate, browser
errors and decoded-video SHA-256. Set `BENCH_LAST=4` for the short comparison,
`BENCH_WORKERS=1` or `2` for explicit comparisons, `BENCH_OUTPUT` for an output
filename prefix, and `EXPECTED_HASH` to require identical decoded pixels.
`BENCH_DISPLAY_MAX_SIDE=0` reproduces the analysis-sized cache benchmark above;
the default now tests the source-backed HD display. `EXPECTED_WIDTH` and
`EXPECTED_HEIGHT` can assert the encoded dimensions.
`BENCH_PROXIMITY_WEIGHT=0` disables the local prior for an exact motion-only
control; the default uses the prefab's 0.25. The report records the selected
weight and full family summary alongside the video hash.

The 2026-09-23 market check exported 293 frames at 1920x1080/60fps. With weight
0, the decoded SHA-256 exactly matched the previous review:
`56ba952ae8d446a55e41ca1d18d2a77109d594b6b5cbd1735b4f23bfccfae971`.
At 0.25, analysis took 9.66s and rendering 6.54s (Auto, one worker), with hash
`be51c009a4dc644cfed7f7274c55b9df5b682d440521d0c3467c68a7ad07f193`.
Both have 16 original regions and seven families. The main background family
retains regions `1,8,11,12,15`; smaller-family assignments change. This browser
decode differs slightly from the frozen FFmpeg replay used in Cadence's
`tests/regional-proximity.ts`; its manual character IDs must not be reused here.
The new review still shows fragmented character support and identity changes.

- **Flow:** hue is direction, saturation is magnitude; white is supported zero
  motion, purple checkerboard is unknown. Validity shows supported pixels white.
  The texture floor scales with spatial grain estimates at several radii; weak
  or very fine genuine artwork may conservatively remain unknown as well.
- **Cells:** 96, 48, 24, 12 and 8 pixels pool the same dense field. Amber marks
  mixed evidence. These scales are not independent measurements or votes.
- **Groups:** colored cells share supported motion histories. Co-moving objects,
  texture holes, occlusion, brief tracks and subcell boundaries remain unresolved.
  A colored cell is not a pixel-accurate silhouette or a recovered layer.
- **Motion families:** disconnected original regions share a color only when
  their velocities agree at matching times, not merely on average. Default
  tolerance is 0.75 analysis pixels per source pair with at least four shared
  pairs. The comparison uses measured regional velocity summaries, not a
  per-pixel error bound. Every pair of constituent regions must agree, preventing a compatible
  bridge from merging contradictory or unobserved histories. Acceleration and
  reversal are allowed when simultaneous velocities still agree. The union
  contains exactly the original supported cells; sky and texture holes are not
  filled. Matching motion is not proof of identical layer ownership. The
  Evidence summary lists full membership and currently observed members.
  **Proximity weight** defaults to 0.25 (range 0 to 4): among already compatible
  proposals, nearby support gets a weak ordering preference. The score is mean
  velocity error minus `tolerance * weight * max(0, 1 - distanceCells / 4)`.
  Distance uses symmetric median-nearest support separation over shared pairs,
  measured in cell widths. At four cell widths and beyond the bonus is zero;
  distant fragments can still merge. Proximity cannot override conflicting
  velocities, missing overlap, or pairwise family consistency. Set weight to 0
  for motion-only proposal ordering. Saved root and custom-node graphs acquire
  the new default only when the parameter is absent; explicit values survive.
  Changing it invalidates grouping and downstream results, not decoded scenes,
  dense motion, cells or original tracks. This is not a silhouette refinement.
- **Velocity histories:** teal is horizontal velocity, amber is vertical
  velocity; each row is a motion family and each column a source-frame pair.
  Group page selects eight families, with a common vertical scale for that page.
  Unobserved values remain gaps, not zero motion. The summary contains full
  numeric histories and membership. Family velocities summarize the currently
  observed members, not an inferred trajectory through missing data.
- **Motion conflicts:** eight region pairs per Group page, limited to pairs
  rejected by the raw maximum-velocity disagreement. Rows are sorted by mean
  error, then maximum error and region IDs. Bar height is simultaneous velocity
  error in analysis pixels per source pair; the amber guide is the unchanged
  tolerance. Red means both drawing events changed, green both held, gray a
  mixed/unknown/missing event. Missing motion remains a gap, not zero error.
  The source cursor marks the outgoing pair; the final frame has no cursor.
  The summary lists each pair's current families, veto count, every shared
  velocity measurement and both event statuses, with absolute source-frame
  numbers. Missing timing is explicitly `null (not measured)`, distinct from
  an observed `unknown` event. This is a diagnostic correlation, not permission
  to ignore redraws, alter flow, relax a veto or merge more families. It reads
  the existing timing/history branch and leaves the default review unchanged.
- **Events:** green is held, red is changed, gray is unknown. The first pair is
  intentionally unknown without independent prior support. Drawing comparison
  uses a regional translation, not a deforming optical-flow warp.
- **Timeline:** rows are motion-group IDs; columns are source-frame pairs.
  Group page selects 32 rows at a time. The Evidence summary output
  includes complete H/C/? patterns, absolute change frames and completed hold
  lengths. Unknown intervals break holds; no on-2s/on-3s cadence is imposed.
- **Review:** top left source, top right flow, bottom left motion families,
  bottom right original-region drawing events. Family grouping never merges
  drawing-event identities. Existing saved graphs without Motion-History
  Grouping retain the old motion-group panel and continue to run. These
  analysis-resolution diagnostics are not artwork exports.

`npm run typecheck` and `npm test` cover stage contracts, shared-core parity,
unchanged per-region timing, preserved support and unknown intervals. With the
editor server running, `node scripts/regional-layers-smoke.mjs` loads real
footage, selects both new inspectors, checks their summaries, and writes the
current desktop/mobile, family and velocity screenshots to `build-smoke/`.

The core is a generated, committed browser-safe snapshot from Cadence under
`vendor/cadence-regional/`, imported through `cadence/regional`. Normal installs,
tests and hosted builds do not require a neighboring checkout. To update it from
Cadence, run `npm run sync:cadence` with `../../cadence` present, or set
`CADENCE_ROOT`. The sync builds the authoritative TypeScript sources and copies
only the regional modules and declarations, recording input/output SHA-256 hashes
in `source-manifest.json`. Do not edit generated modules. Vite deduplicates the
published OpenCV package so the shared core uses the initialized worker runtime.

## Save a project folder

In desktop Chrome, choose **Project folder…** once and grant folder access. Saving
a graph, PNG, prefab or MP4 also opens this picker when no folder is selected. New
folders save the current graph; a folder containing `opencv-graph.json` opens
that project and reloads its media before autosave starts.

- `opencv-graph.json` includes the graph, layout, custom-node definitions and
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

## Generate images and videos without a source

Open **Procedural stripe texture** in the prefab library. It builds a seamless,
looping texture from arithmetic without reading any image:

```text
Image Coordinates.U/V + Seeded Noise
  → three editable Striped color channel groups
  → Combine RGB → Translate X/Y (wrap) → Output
                         ↑ Time × (image dimension / loop length)
```

Each channel computes a sine wave from `U × round(X cycles) + V × round(Y cycles)`
plus seeded noise phase. Whole cycles make the stripes meet at opposite image
boundaries; the continuous sine wave avoids a color jump where its phase wraps.
Open a channel group to edit every rounding, multiply, addition and sine node.
The default seed is 412947; shared width/height Number nodes feed both generators.
Changing resolution preserves the number of stripes and the animation duration.

The loop-length Number defaults to 240 generated frames. Motion travels exactly
one image width and height during that period. Render frames **0 through 239**
at **24 fps** for a seamless 10-second loop; frame 240 repeats frame zero and
should not be included. To change the duration, change both the loop length and
the render range. Previously saved graphs keep their original nodes; open a
fresh copy of the prefab to get this version.

The **Generate** category contains **Image Coordinates** and **Seeded Noise**.
**Pixel Math** provides image arithmetic, sine/cosine, fraction, floor, modulo,
powers, comparisons and clamping. B can be another image or a scalar input.
For example, modulo + Step makes stripes; combine X and Y for checkerboards;
subtract a center, square and add the axes for circular distance fields.
Coordinates expose both normalized U/V ramps and pixel-unit X/Y fields.
Values outside 0…1 remain available to later nodes. Use **View gain → 1/255×**
to inspect a 0…255 field, or add Normalize Frame for another range; view gain
never changes computation or exported pixels.

With no clip loaded, **Generated time** runs at 24 fps. **Through frame** sets
its length (240 frames initially). Change Time-dependent parameters, scrub,
save a PNG, or **Render video** at the chosen output fps. The encoder still
requires even output dimensions. No input-video node is required.

## Motion-vector cookbook as a video

Open **Regional motion vectors**, then attach a clip to its Video Source.
It compares frame N with N+1 and repeats the final drawing at the end:

1. **Working frame pair** limits the longest side to 640 pixels, preserves
   aspect ratio and rounds down to even dimensions for encoding. Grayscale
   removes color so matching follows brightness structure.
2. **Coarse camera pan** estimates translation with phase correlation and
   rejects a weak response or displacement beyond 45% of the image dimensions.
   Open it to inspect the comparisons and numeric switches.
3. Two **Pan-compensated dense flow** instances remove that pan with Translate
   X/Y using reflected borders, run Farneback, then restore the full displacement.
   The second instance swaps frames and negates the pan for reverse flow.
4. **Corner Texture Strength → Threshold Mask** rejects regions without useful
   structure in two directions. **Check Reverse Flow** follows each forward
   vector and checks that its reverse returns within 1.5 pixels. Multiplying
   those masks retains samples passing both checks.
5. **Regional Median Flow** summarizes accepted vectors in 48-pixel cells.
   A cell needs at least 8 samples and 5% support. Its residual mode subtracts
   the dominant translation to expose other motion.
6. **Draw Motion Vectors** draws arrows and real dx/dy labels on the original,
   full-resolution first frame. The smaller analysis field and validity mask
   stay at working resolution; positions and vectors scale to the background.
   Labels report displacement in original-image pixels, while upstream numeric
   outputs remain in working-image pixels.
   Positive X is right; positive Y is down. Gray crosses mean insufficient
   support, while dots mean approximately zero motion. Arrow gain changes only
   the drawing scale, not the measurements.

The cell-size Number drives both aggregation and drawing. All controls accept
wires. Inspect any node, enable its thumbnail, open the groups, or render the
Output to see these measurements over time. Dense fields have sparse arrow
previews enlarged 2×; the final overlay defaults to a 3× display multiplier.

The 640-pixel analysis limit does not reduce output-video resolution. For an
existing saved graph, connect the first **Extract Video Frame** (frame N)
directly to **Draw Motion Vectors → Image**, or reopen the updated prefab. Keep its field and mask wires.

Rendering defaults to **High** compression quality. **Maximum** gives fine lines
and textured motion more bitrate; **Compact** uses the previous smaller budget.
Tiny outputs cap the target bitrate to keep the browser encoder stable; the
higher presets can reach the same cap. These settings preserve the Output node's dimensions. The player displays the
actual encoded resolution below its timeline. A texture generated at 192 × 128
stays that size; change the prefab's Width and Height Number nodes to generate a
larger image. Changing quality requires rendering again.

This follows the [motion-vectors cookbook](https://opencv.banou.dev/cookbook/motion-vectors/)
with explicit intermediate values. Change **Working frame pair → Max side**
or bypass that group to choose another resolution. Displacements use working
image pixels, just as in the cookbook lab. Rotation, parallax, occlusion,
lighting changes and repeated patterns can still defeat the estimates. The
validity masks are useful checks, not a probability of correctness.

## Explicit values and frame flow

```text
Video Source.Video ────────────────→ Extract Video Frame.Video
Time.Frame index (or Number) ──────→ Extract Video Frame.Frame index
                                    ↓ Frame
                                Grayscale → Gaussian Blur → Output
```

A Video socket carries an indexed clip. It cannot connect directly to a frame
operation. **Extract Video Frame** decodes one zero-based integer index. Use a
fixed Number for a pinned drawing, Time's **Frame index** for playback, or Math
`index + 1` and a second extractor for the next drawing. Grayscale and other image
operations process exactly the connected frame. **Subtract Frames** compares
exactly its two inputs, with no implicit offset.

**Every node parameter has an input socket.** An unwired socket shows an editable
fallback. A wire supplies the value instead, with the same type and range checks.
For example, Number → Math → Extract Video Frame changes which frame is decoded;
Number → Gaussian Blur.Radius changes its neighborhood. Select options accept
Text values matching the displayed option names; boolean options accept Boolean
or Compare Numbers outputs. Disconnecting restores the saved fallback. Primitive
value graphs can run before a clip is loaded. The inspector's source-frame list
reports the actual dependencies after computed parameters resolve, including
cached results.

Open **Data types** to define a named record: for example Frame + Rectangle +
Confidence + Label. **Make** packages its fields; **Separate** exposes their typed
outputs. Records can pass through custom-node ports and are saved with the graph.
Different named types cannot connect accidentally. Schema edits disconnect only
invalid field connections; Undo restores the old schema and wires. Records are
currently flat; nested record fields are not supported.

The socket/default and reusable-group design draws on
[Blender node groups](https://docs.blender.org/manual/sl/5.2/interface/controls/nodes/groups.html)
and [Unreal's typed node connections](https://dev.epicgames.com/documentation/unreal-engine/connecting-nodes-in-unreal-engine).

## Available building blocks

| Purpose | Nodes |
| --- | --- |
| Video and time | Video Source, Extract Video Frame, Video Info, Time, Frame Size |
| Values | Number, Text, Boolean, Vector 2D, Rectangle, Separate Vector, Separate Rectangle |
| Computation | Math, Multiply, Compare Numbers, Boolean Math, Switch Number |
| Filtering | Grayscale, Gaussian Blur, Box Blur, Median Blur, Bilateral Filter |
| Regions and transforms | Crop Frame, Paste Region, Resize Frame, Rotate Frame, Flip Frame, Translate X/Y |
| Edges | Sobel Derivative, Scharr Derivative, Laplacian Derivative, Gradient Magnitude, Canny Edges |
| Color and contrast | Normalize Frame, Invert Frame, Scale and Offset, Equalize Histogram, CLAHE, Extract Channel, Combine RGB |
| Masks | Threshold Mask, Adaptive Threshold, Erode, Dilate, Morphology, Distance Transform, Frame Coverage |
| Pyramids | Pyramid Down/Up, Gaussian/Laplacian Pyramid, Make Pyramid Levels, Pyramid Level, Reconstruct Pyramid |
| Composition | Add/Subtract/Multiply/Mix Frames, Masked Composite |
| Measurements | Estimate Translation: X/Y displacement, diagnostic response, arrow preview |
| Custom and output | Named Make/Separate records, custom groups, Group Inputs/Outputs, Output |

Pyramid outputs are frame lists, shown as labeled contact sheets. **Pyramid Level**
extracts a native-resolution frame for further processing or pixel inspection.
Laplacian bands retain negative floating-point values; zero appears middle gray.
Reconstruction expands each coarse level to the exact preceding dimensions,
including odd sizes, and adds its detail band back.

Estimate Translation repeats **one global vector** as arrows enlarged 4×. It is
not dense optical flow. The node catalog is a useful subset of OpenCV; it does not
yet expose every API, feature detector, contour operation or optical-flow method.
`Regions` carries the schema-checked scene, motion, pooled, track and timing
collections in the regional prefab. Rectangle remains the crop-region value.

Older saved graphs still execute their implicit-time Video Source, Frame Offset,
Extract Frame, Frame Delta and Estimate Translation nodes. These compatibility
nodes are hidden from the add menu; new prefabs use explicit clip/frame flow.

## Generate and preview video

1. Open an MP4 and wire an image into an Output node.
2. Scrub the source-frame timeline. Use **Between frames** to inspect fractional
   times, which your graph can use through the Time node.
3. Choose a root Output and output frame rate. The range defaults to the entire
   clip, from frame 0 through the last frame; shorten it only when you want a test render.
4. Render, play the generated video, and save its MP4 to the project folder.

Output timestamps are mapped to source time using rational rates, including
24000/1001. Time.Frame index selects the earlier integer frame; your graph explicitly
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
- Rendering repeats the last source drawing for forward-looking requests beyond
  the clip, so N+1 camera graphs render the entire duration, including the final
  frame interval. This applies separately to each input clip. Interactive frame
  inspection still reports unavailable indices; negative indices remain invalid.
- Native calls finish atomically; cancellation occurs between operations and frames.
  Rendering is offline, not a promise of real-time 60 fps processing.
- The native result cache is 512 MiB. That is not a total process-memory limit:
  decoder frames, scratch matrices, WebGPU textures and the WASM heap also use
  memory. Encoded exports have a separate 512 MiB budget.

### Parallel render workers

**Render → Workers** offers Auto, 1, 2, 4, 8 and 16. Auto uses two on machines reporting
at least four CPU cores and 4 GiB of memory (when that hint is available), and one
for renders shorter than 24 output frames. Outputs depending on whole-scene
regional analysis use one worker in Auto, reusing the interactive scene cache
instead of repeating that analysis in new workers. This follows the selected
output through custom groups; unrelated regional branches do not change Auto.
Explicit counts remain available and are capped by the reported CPU count and
number of frames. Compare the time shown below the movie.

Workers independently evaluate complete output frames, including Time, custom
groups, generated textures and multiple source clips. Neighboring output times
within the same source-frame interval stay on one worker in batches of up to
three. For example, 23.976 fps video rendered at 60 fps can reuse decoding and
optical flow for the same source pair. Every fractional timestamp still evaluates
its own graph, so animation and interpolation retain their full output rate.

A bounded scheduler keeps results in presentation order and transfers RGBA
buffers to one encoder. It retains at most one pending batch per worker plus the
batch being encoded, each containing at most three frames. Cancellation stops
all workers and exports the completed prefix.

Each worker uses its own OpenCV heap, decoder and 512 MiB result cache. Workers
are created for a render and terminated on completion, cancellation or error;
the verified WASM binary is reused without downloading it again. This needs no
SharedArrayBuffer or COOP/COEP headers. The package itself remains a single-thread
SIMD build. Interactive evaluation stays on the existing processing worker.

More workers can help expensive frame calculations, but initialization, duplicate
decoding, memory bandwidth and the single encoder limit the gain. One worker
also benefits from the existing interactive cache. Short or simple graphs can be
faster with one worker; resolution and compression are independent controls.

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
including backward/open-GOP seeks. Native WASM tests also execute every image
catalog entry, verify crop/paste pixels, reconstruct odd-sized pyramids, and check
next-frame border filling in all four pan directions without replacing covered pixels. Browser checks exercise custom ports, nested
tabs, previews, file drops, per-source bindings, MP4 playback and partial renders.
They also exercise computed frame indices, live typed parameters, named records,
source provenance, region processing and editable pyramid reconstruction.
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

To add a primitive, declare its ports, parameters and explanation in `catalog.ts`,
then implement its kernel. Native results must have one cache owner and release
all temporary matrices, including on failure. A custom node needs no new kernel:
its interface expands into ordinary operations before execution.

`PLAN.md` is the original archived design. `IMPLEMENTATION.md` records the owner's
subsequent changes to that design.

Existing projects named `cadence-graph.json` still open and save under that name.
New projects use `opencv-graph.json`; the graph format is unchanged.

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
            -> Regional Drawing Events -> Support Completion
            -> Inspect Support Completion -> Frame Layouts -> Output
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

Twelve separate inspector branches expose source pixels, motion, validity, cells,
original groups, motion families, velocity histories, motion conflicts, drawing
events, a timing timeline, experimental support completion and the four-panel review. Only these
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

It opens the regional prefab in an isolated browser, asserts the default worker
selection is four, and exports its single merged completion output for the full
clip at 60 fps. It overwrites `build-smoke/regional-render.mp4` and
`build-smoke/regional-render.json`, plus a review screenshot. The report separates initial scene analysis
from rendering and verifies output frame count, dimensions, frame rate, browser
errors and decoded-video SHA-256. Set `BENCH_LAST=4` for the short comparison,
`BENCH_WORKERS=0` for explicit Auto or `1`, `2`, `4`, `8`, `16` for manual
comparisons, `BENCH_OUTPUT` for an output
filename prefix, and `EXPECTED_HASH` to require identical decoded pixels.
`BENCH_FILL_ISOLATED=false BENCH_BRIDGE_TEMPORAL=false` disables the two new
cleanup passes for the previous-completion control; each also accepts `true`.
The JSON records the actual repair toggles used by the exported output.
It also checks the separate completion panel dimensions and their lossless
two-by-two layout. Review/conflict controls rewire the sole output through the
public graph save/import path, so inspecting a different node cannot silently
benchmark the wrong render target.
`BENCH_VIEW=review BENCH_DISPLAY_MAX_SIDE=0` reproduces the measured-support,
analysis-sized cache benchmark above;
the default now tests the source-backed HD display. `EXPECTED_WIDTH` and
`EXPECTED_HEIGHT` can assert the encoded dimensions.
On the 117-frame market-pan clip, the current four-worker default and explicit
one-worker renders have identical decoded pixels (293 frames, 1920x1080 at
60 fps, SHA-256 `17d387ef1b3f656433b36f0a9d19cebd6c2442e53db4dc552e2ca20954ac1683`).
The four-worker render took 17.22s versus 7.98s with one worker, after roughly
12s initial analysis: separate workers rebuild the scene cache. Auto retains
one-worker cache reuse for this graph. Worker defaults are not a speed claim.
The editor now always uses motion-only proposal ordering. The proximity trial
was rejected after review; a saved experimental weight cannot reactivate it.
The report records the selected inspector's evidence summary and explicit output
target alongside the video hash. The default `BENCH_VIEW=completion` shows
measured versus completed support. `BENCH_VIEW=review` selects the old read-only
review as a regression control; it does not add another output.
`BENCH_VIEW=conflicts` exports the new raw-motion/appearance diagnostic instead
of the four-panel completion view; use a separate filename prefix in the existing output
directory. For the local 24fps market clip:

```sh
BENCH_VIEW=conflicts BENCH_OUTPUT=build-smoke/regional-conflicts node scripts/regional-render-benchmark.mjs ../../cadence/test/out/layers-market-pan/original/original.mp4
ffmpeg -y -v error -i ../../cadence/test/out/layers-market-pan/original/original.mp4 -i build-smoke/regional-conflicts.mp4 -filter_complex '[0:v]fps=60,scale=960:540,pad=960:598:0:29:color=0x18191b,drawtext=text=Source footage:fontcolor=white:fontsize=16:x=12:y=7[left];[left][1:v]hstack=inputs=2:shortest=1[out]' -map '[out]' -an -frames:v 293 -c:v libx264 -crf 16 -preset fast -pix_fmt yuv420p -movflags +faststart ../../cadence/test/out/layers-market-pan/diagnostics/regional-conflict-review.mp4
```

This recipe is specific to the current clip and first eight-row conflict page.
It produces 293 frames at 1988x598/60fps. Source-panel pre-encode frame hashes
were checked against source frame `floor(outputFrame * 24 / 60)` with no
mismatches. The chart has its own explicit source-frame cursor. The conflict
historical export took 2.33s after 8.87s analysis, before the proximity rollback;
that normal 1920x1080 review decoded to `be51c009...07f193` below. Those are
historical trial results, not the current motion-only output. Neither the inspector nor
the composite changes grouping or improves interpolation; this is evidence for
the next placement-versus-redraw experiment.

Historical proximity trial, rejected by the owner on 2026-09-24: the 2026-09-23
market check exported 293 frames at 1920x1080/60fps. With weight
0, the decoded SHA-256 exactly matched the previous review:
`56ba952ae8d446a55e41ca1d18d2a77109d594b6b5cbd1735b4f23bfccfae971`.
At 0.25, analysis took 9.66s and rendering 6.54s (Auto, one worker), with hash
`be51c009a4dc644cfed7f7274c55b9df5b682d440521d0c3467c68a7ad07f193`.
Both have 16 original regions and seven families. The main background family
retains regions `1,8,11,12,15`; smaller-family assignments change. This browser
decode differs slightly from the frozen FFmpeg replay used in Cadence's
`tests/regional-proximity.ts`; its manual character IDs must not be reused here.
That trial still showed fragmented character support and identity changes; it
did not establish reliable layer ownership. The shipped editor has reverted to
motion-only ordering; the trial numbers above remain here as an audit record.

The 2026-09-24 rollback check regenerated the default 1920x1080 review, with
293 frames at 60fps. Its decoded SHA-256 exactly reproduced the pre-proximity
`56ba952ae8d446a55e41ca1d18d2a77109d594b6b5cbd1735b4f23bfccfae971`
output (9.10s analysis, 6.07s render). This verifies restoration, not improved
ownership: the right-hand character was already mostly assigned to the
background in that baseline, and the central characters remain fragmented.

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
  Proposal ordering is **motion only**. The rejected proximity control is
  removed, and the kernel explicitly uses zero spatial weight. Opening saved
  root or custom-node graphs strips the retired parameter and any wires to its
  former socket while preserving other settings/connections. The history cache
  version changed so old spatially weighted results cannot be reused. This
  rollback keeps the HD display, caching improvements and conflict diagnostic;
  it is not a silhouette or ownership fix.
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
  the existing timing/history branch and leaves measured support unchanged.
- **Events:** green is held, red is changed, gray is unknown. The first pair is
  intentionally unknown without independent prior support. Drawing comparison
  uses a regional translation, not a deforming optical-flow warp.
- **Timeline:** rows are motion-group IDs; columns are source-frame pairs.
  Group page selects 32 rows at a time. The Evidence summary output
  includes complete H/C/? patterns, absolute change frames and completed hold
  lengths. Unknown intervals break holds; no on-2s/on-3s cadence is imposed.
- **Support completion (experimental):** select **Inspect Support Completion**
  after `Regional Drawing Events -> Support Completion`. It accepts
  motion-history data directly as well. The new inspector exposes four separate
  frame sockets: **Source**, **Measured support**, **Completed support** and
  **Inference provenance**, plus **Evidence summary**. Select a frame in
  **Output socket** to view that panel alone at its full display resolution.
  The preview's fullscreen button expands the image and its zoom/pixel controls;
  the same button or Escape returns to the editor without changing graph data.
  Three editable **Frame Layout** nodes combine source/measured above
  completed/provenance and drive the prefab's **single Output**. The
  measured-support, family and original review inspectors
  remain available for comparison; selecting an inspector changes the preview,
  not the movie output. Reopen the prefab to get the current single-output graph.
  Existing saved graphs and their user-edited outputs are not rewritten. The
  legacy Regional Evidence inspector's `completion` view still exposes its
  original combined `out:frame:image`. The new layout reproduces that image's
  dimensions and pixels for the same completion data.
  Original measured family cells stay unchanged. Nearby unassigned coherent
  cells can be associated with a family only when their measured motion agrees
  locally and at least one independent neighboring pair supports that agreement.
  Transported evidence within two pairs on either side checks for contradictions.
  Associations stay within two fine-grid cells of original family support and
  respect competitor clearance. Original velocities and region identities are
  never rewritten. Empty support is completed along bounded eight-neighbor paths
  from original same-family seeds, within their local hull for holes or a bounded
  actual-image-edge belt for borders. Contradictory coherent motion and other
  families veto completion. Sparse samples without a coherent estimate are
  neutral, not automatically treated as a foreign layer. Inferred support never
  resets distance or starts unlimited growth from new seeds.
  **Max hole distance**, **Max border distance** and **Competitor clearance**
  default to 6, 6 and 2 fine-grid cells, each adjustable from 0 to 32. A zero
  maximum disables that geometric inference type, not motion-backed association
  or either cleanup pass.
  **Fill isolated holes** and **Bridge temporal holes** independently enable the
  cleanup passes; both default to on. Their additions remain separately marked,
  rather than becoming original measured support. Existing root and nested
  completion nodes acquire missing toggle defaults when loaded; explicit off
  settings, other parameters and output wiring are preserved. Changing either
  toggle reruns completion, not upstream motion, grouping or drawing analysis.
  Isolated cleanup considers only raw-unknown cells with all four cardinal
  neighbors already completed for one family. Foreign diagonal ownership,
  informative raw blockers and neighboring-pair motion contradictions veto it.
  It runs once from the pre-cleanup map, without recursively filling more cells.
  Temporal cleanup first freezes the spatial-completion maps, then checks
  compatible but unassigned flow across the scene using entire cell footprints
  and original family displacement chains. These time-supported associations
  retain motion provenance. One bounded spatial rerun can use the resulting
  evidence without adding new original-distance seeds or weakening the original
  seed-relative competitor separation. The same toggle controls
  this extra association step and the subsequent empty-run repair; ordinary
  local motion association still runs when it is off. Interior gaps need complete
  agreeing donors on both sides; multiple raw-unknown pairs can be bridged.
  A leading gap must reach
  the actual start of the analyzed sequence without a blocker and have two
  complete future witnesses. A trailing gap must similarly reach the actual
  sequence end without a blocker and have two complete past witnesses. Missing
  pair keys or velocities, foreign ownership and incompatible unassigned
  evidence stop a search. Clipped footprints can be traversed and can veto, but
  never count as positive donors. A footprint that leaves the viewport can only
  reach a sequence boundary if it never re-enters. Raw motion contradictions, nearby competing support
  and ambiguous family candidates also veto filling. Donors can include isolated
  cleanup but never temporal additions. A separate raw-trajectory veto continues
  beyond the first agreeing donor to catch later contradictions; incomplete or
  unknown trajectories are not certified ownership. Neither pass moves or
  synthesizes artwork.
  With temporal cleanup enabled and a positive border distance, one terminal
  border pass can fill nearby raw-unknown cells in the viewport-edge belt from
  frozen temporal anchors. Its bounded paths retain original motion and
  competitor checks. New border fills never become donors or restart growth.
  Optional `terminalBorderCells` metadata marks a subset of `borderCells`, not
  extra cells; the inspector keeps the ordinary teal border provenance and counts.
  These are analysis-grid distances, not
  full-resolution pixels. The source-backed four-panel view shows source /
  measured support on top, completed support / inference distinction below.
  In the distinction panel, gray is original measured family support, purple
  motion-backed association, amber inferred holes, teal inferred border support,
  pink isolated-hole cleanup and blue temporal-hole cleanup; blocked and unknown
  cells stay unpainted. Counts
  report cells, not pixel coverage or confidence. The final source frame has
  no outgoing evidence and shows no support overlay. This conservative stage
  cannot identify entirely unobserved objects, establish correct ownership,
  recover pixels or produce a pixel-accurate silhouette. It does not change
  motion, grouping, drawing events or the measured Review inspector. Completion is
  cached for the scene. The worker checkpoints after every pair in each
  preparation pass and after every finalized temporal frame, preserving
  whole-scene context while allowing cancellation. Preparation checkpoints are
  not output frames.

  Full-shot completion export:
  ```sh
  BENCH_VIEW=completion BENCH_OUTPUT=/home/banou/dev/cadence/test/out/layers-market-pan/diagnostics/regional-completion-review node scripts/regional-render-benchmark.mjs /home/banou/dev/cadence/test/out/layers-market-pan/original/original.mp4
  ```
  Historical 2026-09-24 conservative export, before the single-output revision:
  293 frames at 1920x1080/60fps, 9.05s initial
  analysis, 0.62s to select/evaluate the completion branch, 5.70s to render.
  Decoded SHA-256:
  `cce1e4bd0fa7608df31215960083257ee9e0a994cd6dc6223df37f8b5ab81613`.
  This is held source-clock diagnostic content, not interpolated animation.
  Sampled exported frames retain prior character fragmentation and show only
  sparse additions. Cadence's six-scene cached replay (plus another market
  resolution) adds 0.01--0.85% area at the conservative defaults; the broad
  unsupported regions are not solved. Looser clearance enters character-area
  controls, so it is not enabled by default.

  Pre-cleanup single-output export on the same shot: 293 frames at 1920x1080/60fps,
  10.87s initial analysis, 0.07s to select completion and 6.80s to render with
  one worker. Decoded SHA-256:
  `c863558e135631e1ee47bc7b5aed64e3f88b47edd93cb9c52fa0f610e95e642d`.
  Cadence's frozen market replay now adds 40.76% area at 320 analysis pixels
  and covers 74.30% of outermost-cell area. The five other scenes gain
  1.24--8.65% area; original support and identities remain unchanged. These are
  coverage statistics, not ownership scores. Exported source frames 30, 60 and
  90 show much broader background coverage, while the walking group remains
  fragmented and the hooded carriage character already shares family 1 in the
  measured input. Those identity errors are unresolved, not fixed by completion.
  Source checks confirm the hooded figure changes relative to the wagon opening;
  completion can extend its incorrect upstream background assignment. Full
  coverage must not be interpreted as a correctly extracted compositing layer.
  A separate `BENCH_VIEW=review` regression run through the same single output
  exactly matches the pre-proximity `56ba952a...` decoded hash above across all
  293 frames (9.87s analysis, 6.34s render).
  Current cleanup export: 293 frames at 1920x1080/60fps, 9.71s analysis,
  0.04s to select completion, 6.85s render, one worker. Decoded SHA-256:
  `825a31f5840d3163eff7c0d7fd85579e2b403f94e64ccde49d466d12139a4162`.
  Both repair toggles disabled reproduce the previous `c863558e...` completion
  video exactly, across all 293 frames (10.57s analysis, 6.97s render).
  The frozen market-320 replay adds 259 isolated and 345 temporal cells,
  increasing inferred area to 41.33%, with prior assignments unchanged.
  Current validation passes 165 editor tests, typecheck, lint, build and
  regional desktop/mobile smoke. Full browser smoke passed on a fresh rerun
  after one transient generated-prefab DOM-state assertion, without unrelated
  production changes. The stable video remains in Cadence's existing
  `test/out/layers-market-pan/diagnostics/regional-completion-review.mp4`.
- **Review:** top left source, top right flow, bottom left motion families,
  bottom right original-region drawing events. Family grouping never merges
  drawing-event identities. Existing saved graphs without Motion-History
  Grouping retain the old motion-group panel and continue to run. These
  analysis-resolution diagnostics are not artwork exports.

`npm run typecheck` and `npm test` cover stage contracts, shared-core parity,
unchanged per-region timing, preserved support, separate inference and unknown intervals. With the
editor server running, `node scripts/regional-layers-smoke.mjs` loads real
footage, checks the family, velocity, conflict and completion inspectors and
their summaries, and writes current desktop/mobile and diagnostic screenshots
to `build-smoke/`.

For a source-indexed completion investigation, run
`node scripts/regional-completion-probe.mjs` with the dev server running. It
imports the original 117-frame market shot by default (`REGIONAL_CLIP` overrides
it), exports the four actual inspector PNG ports and records per-cell diagnostic
colors plus source-to-60fps index mapping in
`build-smoke/regional-completion-probe.json`. Comma-separated `PROBE_FRAMES`
selects source indices. `PROBE_IMAGE_FRAMES` limits which of those frames also
overwrite four-panel PNG sheets; set it to an empty string for metrics only.
`PROBE_PREFIX` changes their shared filename prefix within `build-smoke/`, so a
different source encode can be checked without replacing the original report.
The classifier's `unknown` means unpainted, including both blocked and unknown
support. These colors identify motion-family evidence, not true object ownership.
The probe uses a disposable browser profile and leaves the dev server running.

The 2026-09-24 boundary-repair check of `original/original.mp4` (24fps) covers
every source frame 20-33 and 88-115, plus 84, through these actual browser
exports. In the top-left ROI (fine-grid
columns 0-8, rows 0-3), only source frame 24 still has unsupported cells: 0-5
along the top edge. The other 13 frames in 20-33 have no unsupported cells in
that ROI. The right-wall ROI (columns 34-38, rows 4-13) has all 50 cells covered
at 84 and throughout 88-115. Source frame 24 maps to 60fps output frames 60-62;
indices are zero-based. The 13 prior-frame comparison controls preserve measured
labels and existing owners, with no new support in the checked central-party
or hooded-character rectangles. Their pre-existing family conflation remains
unresolved. These checks do not establish complete scene coverage or correct
object ownership. Validation passes 175 editor tests, typecheck, lint, build and
regional desktop/mobile smoke. Generic production smoke passed on a fresh retry
after one backward pointer-drag seek timeout; no production change was made for
that transient failure.

The saved project's `test/media/5dcf6038-bf63-488a-9ded-3b50893bcd10-market-pan.mp4`
is a different encode at 24000/1001fps. Its motion evidence differs, so the
original-encode coverage claim does not apply to it. The terminal-border check
uses this actual asset at sources 63, 66, 78, 84, 110, 113, 114, 115 and 116.
Native inspector PNGs agree with the frozen browser-input core replay across
all 8,280 grid cells. At 110/113/114/115 the pass adds 24 right-edge support
cells per frame, without changing measured labels or existing owners. Seven
unpainted cells remain in the right-wall ROI at 110/113/114, and eight at 115;
these retained gaps are not claimed to be fixed. Source 116 has no outgoing
pair and therefore shows no support, unchanged by this pass. It maps to
zero-based 60fps output frames 291-292; source 113 maps to 283-285 and 114 to
286-287. The prior report remains `build-smoke/regional-completion-market-asset-tail.json`;
the current report and nine sheets use the `regional-completion-market-asset-candidate`
prefix. These diagnostics do not resolve the pre-existing character/family
conflation or establish object ownership.

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

**Frame Layout** joins two frame inputs, A then B, horizontally or vertically.
It copies native pixels without resampling or blending. The canvas sums sizes
along the selected direction and uses the larger size across it. Inputs align
at the top or left edge; unused space is transparent black. Chain two horizontal
layouts into one vertical layout for a four-panel comparison. Each intermediate
frame remains independently inspectable, and **Resize Frame** is explicit when
different input sizes should be scaled instead of padded.

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
`Regions` carries the schema-checked scene, motion, pooled, track, history, timing and completion
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

**Render → Workers** starts at **4** and offers Auto, 1, 2, 4, 8 and 16. Render API
calls that omit the worker count also request four. Auto remains an explicit
choice: it uses two on machines reporting
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

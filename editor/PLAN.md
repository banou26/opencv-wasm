# cadence-editor, milestone 1: plan

Inputs: the brief with the owner's planning notes, the conversation transcript, and five research reports (xyflow-zustand, webgpu-worker, webcodecs-mp4box, conventions-and-cadence, machine-measurement). Machine-measurement ran the owner's system Chrome 152.0.7977.64 in rig **w** (a nested headless weston with the owner's Nix wrapper and flags), the only rig that matches the owner's Wayland NVIDIA session; where it disagrees with the other reports about what the owner's Chrome does, this plan follows it. Three review passes (GPU lifetime, video access, engine and shell) were applied; the corrections are folded in, not appended.

## 1. Where the brief should change

Each point: what the brief says, what research found, what the plan does instead.

1. **`isValidConnection` does not fire for programmatic edges.** The prop runs only during a pointer drag, click-to-connect and edge reconnect; `setEdges`, `addEdges`, the `edges` prop and `addEdge` never call it (verified in source and at runtime: a `c -> a` cycle was accepted with the callback counter at 0). Resolution: one pure `validateConnection(doc, specs, candidate)` gates every path: the xyflow prop, the store's `connect` action, `validateDocument` for loaded documents, and the worker on every `set-graph`.
2. **`getOutgoers` / `getIncomers` are the wrong traversal**: each call is O(V+E), so the documented cycle DFS is O(V·(V+E)) per pointer move. The engine keeps its own adjacency map; the cycle check is one reachability walk. xyflow's helpers are not imported.
3. **Strict connection mode does not block self-loops** (it checks handle type only), so `validateConnection` rejects `source === target` explicitly.
4. **Ids must avoid `-` and `"`**: xyflow joins ids with `-` into lookup keys and unescaped CSS selectors. Handle ids use `:` (`in:frame:a`), node ids are `n` plus a base36 counter, every edge gets an explicit id derived from its target port.
5. **Every GPU import of a `VideoFrame` is 8 bits in Chrome**, whatever the destination format and decoder (256 distinct values from a 10-bit ramp through `copyExternalImageToTexture` and `importExternalTexture`, against 877 for a `writeTexture` control; Chromium `external_texture_helper.cc:397-398`). `VideoFrame.copyTo()` keeps 10 bits only on software `I420P10` frames (AV1 10-bit, VP9 profile 2); hardware 10-bit frames have `format: null` and refuse `copyTo`. Resolution: the working format is `rgba16float` from the first commit, ingest is one swappable unit, milestone 1 ships the 8-bit path, and the software-only `ingest10` slot is documented (decision 1).
6. **HEVC decodes in the owner's Chrome only through VA-API hardware**, only while the wrapper's `VaapiOnNvidiaGPUs` feature is on, and with measured costs: the BT.601 matrix on BT.709 streams (mean error 6.7 to 8.8 of 255), 8 bits only, and about 250 ms of overhead per reseek (reset plus configure, `flush()` or a new decoder alike). Chrome on Linux has no software HEVC decoder. mp4box.js parses MP4 only, so MKV sources are remuxed: `ffmpeg -i in.mkv -map 0:v:0 -c copy -movflags +faststart out.mp4`, plus `-tag:v hvc1` for HEVC. Resolution: AVC is the primary target; HEVC is accepted on the hardware path with a visible warning and no correction work (decision 1); a codec neither path decodes is a typed `unsupported-codec` error carrying the command.
7. **"Seek to nearest keyframe and decode forward" is wrong for open-GOP streams.** CRA frames are sync with no `sdtp`/`sbgp`, RASL pictures after a starting CRA produce no output, and a leading picture's nearest sync in decode order has a later cts (measured on hardware HEVC Main10 in rig w). Resolution: start sample = the last sync sample `S` with `S.number <= N.number` and `S.cts <= N.cts`, a pure function tested on synthetic tables and on tables dumped from real fixtures (section 10).
8. **`flush()` per frame is unusable**: it forces a key chunk next, re-initialises the decoder, and costs about 250 ms on hardware. Resolution: a primed session that feeds forward and matches outputs by timestamp; `flush()` only at end of stream or when the reorder slack is exhausted, each followed by a mandatory reseek (section 10).
9. **Decoders hold frames back, and a fast feed loop overshoots.** Outputs lag input by 3 to 5 chunks; the measured one-output-per-chunk pattern came from a loop that waited 40 ms per chunk. An unpaced loop has fed several chunks past the target by the time it arrives, so frames after the target come out with no waiter. Resolution: the frame source ingests a bounded look-ahead of those frames into the cache instead of closing them, so stepping N to N+1 is a cache hit or a short forward feed, never a reseek (section 10).
10. **No GPU memory API exists.** Resolution: the cache counts its own bytes from the texel copy footprint (`rgba16float` 1080p = 16,588,800 B) against a stated default budget of 2 GiB (a choice for a 32 GiB card shared with the desktop and games, not a measurement), and an `out-of-memory` error scope lowers the budget and retries once after queued work settles (section 7).
11. **Submitted GPU work cannot be cancelled.** Cancellation is per `queue.submit()`: the runtime's `submit` refuses when the signal has fired, and Bake awaits `onSubmittedWorkDone()` per frame.
12. **`GPUTexture` never crosses `postMessage`.** The main thread names results by cache key.
13. **"Adding a PortType is a one-line change" is not achievable as stated.** A type needs a union member, a port-table row, a payload variant, a preview renderer, and usually a protocol field. Resolution: every one of those is a `Record<PortType, ...>` or an exhaustive switch, so adding a type is "add the member and follow the compiler errors".
14. **Time.** cadence evaluates at exact rational instants (k·400/1001 source frames), and float time already caused an ulp bug there. Milestone 1 uses integer source frames, but the planner's unit is `(node, time)`, time enters keys only through time-dependent nodes (with a per-spec time quantiser hook), and the alias is declared once (section 6.4).
15. **Two zustand majors in the tree.** `@xyflow/react` 12.11.6 pins `zustand ^4.4.0`; the app uses 5.0.15. npm nests them; never dedupe them (upstream #5685 open).
16. **Styling is Emotion, not CSS modules.** The brief says CSS modules or vanilla CSS; the owner chose the house convention, `@emotion/react` `css` templates (decision 2).
17. **No cheap rig reproduces the owner's Chrome.** Plain `--headless=new` has no WebGPU; headless with Vulkan flags returns `null` from the first `requestAdapter()` and has no hardware decode; Xvfb X11 has no hardware decode. The smoke run therefore drives headed Chrome on the owner's own session (decision 6); a nested headless weston, which matches it without a window, is the fallback (section 16).
18. **`prefer-hardware` is true for every codec in the owner's Chrome** (false in every X11 and headless rig). The policy stays software first for measured reasons (correct BT.709 matrix, 5 to 9 ms seeks, the owner's hardware wrong-frame bug under a keyframe-plus-flush pattern), never `no-preference`, so the path is always known, and one path per source for its whole session: frames from the two paths differ by the matrix error, so a FrameDelta across paths would show a false offset.
19. **Remuxed MKV timestamps jitter** (672/656 at timescale 16000) and carry no nominal rate. Frame identity is presentation rank; the display rate is derived and snapped to a standard rate (section 10).
20. **The "frame N and N+1" pattern needs a home in the engine.** Two `frame` inputs from one source would both get frame N. Resolution: input ports declare a time demand; FrameDelta's `b` demands `t + offset` (decision 3).
21. **Decoded frames carry a coded size larger than the picture** (software H.264 720p reports `codedHeight` 738). Every texture and copy uses `displayWidth`/`displayHeight`.
22. **HSV is not the canonical flow colouring.** The standard is Middlebury (Baker et al. 2010, zero motion white); a WGSL port matched `flow_vis` within 1/255. Milestone 1 implements HSV as the brief asks; Middlebury is a later renderer mode.
23. **"No tests for WebGPU shaders or React components" meets the owner's verification rules.** The plan adds no unit tests for shaders or components. The deliverable is still verified end to end by a smoke run that reads pixels in the owner's Chrome, which needs debug-only protocol messages kept out of the production union (decision 6).
24. **Thumbnails.** The brief allows one on the selected node; the plan shows the selected node's output only in the preview pane and draws no image inside any node, which is simpler and satisfies the performance intent.

## 2. Decisions (answered by the owner, 2026-09-14)

1. **HEVC: accepted on the hardware path, with the visible warning** of section 10. AVC MP4 remuxed from MKV is the primary target; HEVC MP4 (`-tag:v hvc1`) decodes through VA-API. No matrix correction or other HEVC work is planned. `ingest10` (software 10-bit frames only) waits for milestone 2 behind the same interface. An all-intra 10-bit proxy transcode (constant-time seeks, correct colour, 10 bits) was considered and deferred.
2. **Styling: Emotion.** `@emotion/react` `css` templates with `jsxImportSource: '@emotion/react'`, the house convention. xyflow's `base.css` is still imported, because xyflow requires it.
3. **FrameDelta's N and N+1: input time demands.** `b` demands `t + offset` (param, default 1); the planner evaluates the upstream at both instants under their own keys.
4. **Bake storage:** `rgba8unorm` textures in the worker under a 1 GiB budget (129 frames at 1080p, 32 at 4K), refused up front with the count that fits.
5. **Type-mismatch demo: FrameDelta gains `out:scalar:mean`** (mean absolute luma delta read back to the CPU), so dragging it onto a `frame` input shows the rejection; it also exercises a multi-output node, a CPU payload and the `scalar` preview stub.
6. **Verification: a pixel-reading smoke run in headed Chrome on the owner's session** (16b), using debug-only messages (`readback`, `debug-leak`, `debug-delay`, `preview-test`) that exist only in development and smoke builds; colour-matrix numbers are reported, not asserted.

Seeking stays frame-exact for every frame; a jump costs the decode from its start sample, which grows with the GOP, and the owner accepted that.

## 3. Toolchain and scaffold

Repo at `/home/banou/dev/cadence-editor`, npm with `package-lock.json`. Node 26.8.1 and npm 11.19.0 are what the machine has.

**Packages, pinned to what the reports verified (2026-09-13 registry):**

| package | version | why |
| --- | --- | --- |
| `vite-plus` | `0.3.1` exact | bundles vitest 4.1.11, oxlint 1.81.0, `vp` |
| `vite` | `npm:@voidzero-dev/vite-plus-core@0.3.1`, in devDependencies and in `overrides` | the house alias; `overrides` makes vitest's transitive `vite` resolve to the same core |
| `typescript` | `^7.0.2` | native tsgo |
| `react`, `react-dom` | `19.3.0` | |
| `@emotion/react` | `^11.14.0` | styling (decision 2), as in media-player and ripple |
| `@types/react`, `@types/react-dom` | `19.3.x` | TS 7 no longer auto-includes `@types` |
| `@vitejs/plugin-react` | `6.1.1` | peer `vite ^8`, which the alias does not satisfy by name: `.npmrc` carries `legacy-peer-deps=true`, as media-player and ripple do |
| `@xyflow/react` | `12.11.6` | brings `@xyflow/system 0.0.82` and zustand 4.5.7 |
| `zustand` | `5.0.15` | nested beside xyflow's 4.x, never deduped |
| `mp4box` | `2.4.1` | 2.4.0 is uninstallable; `exports`-only resolution |
| `@webgpu/types` | `0.1.72` | needs `skipLibCheck: true` |
| `playwright-core` | `1.62.1` | smoke run only, `connectOverCDP`; downloads no browser |

Registry-latest vitest 5.0.0 is not used (`vp test` runs the bundled 4.1.11). No browser test project in milestone 1. Never `playwright`'s `launch`: it adds `--no-sandbox` (which moves Chrome onto a VA-API H.264 path whose GPU process crashed on this machine), `--enable-unsafe-swiftshader` and its own feature switches.

**`package.json` scripts:**

```json
{
  "dev": "vp dev --port 4560",
  "build": "vp build",
  "typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.engine.json --noEmit && tsc -p tsconfig.tests.json --noEmit",
  "test": "vp test run",
  "lint": "vp check --no-fmt",
  "check:manifest": "node -e \"process.exit(Object.hasOwn(require('./package.json'), 'devEngines') ? 1 : 0)\"",
  "fixture": "sh scripts/make-fixture.sh",
  "smoke": "vp build --mode smoke --outDir build-smoke && node scripts/smoke.mjs"
}
```

`vp fmt` and `vp check --fix` are never run (Oxfmt cannot express the house style). `check:manifest` reads the key, not the text (a `grep -c devEngines` would count its own script line and fail forever); its control at layer 0 adds the block, sees exit 1, removes it, sees exit 0.

**tsconfigs.** `lib.dom` and `lib.webworker` cannot share a program, and a purity check needs a program with neither. Shared options in `tsconfig.base.json`: `target`/`module` `esnext`, `moduleResolution: "bundler"`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `noEmit`, `skipLibCheck`, `resolveJsonModule`, `exactOptionalPropertyTypes: false`.

- `tsconfig.app.json`: `lib: ["ESNext", "DOM", "DOM.Iterable"]`, `jsx: "react-jsx"`, `jsxImportSource: "@emotion/react"`, `types: ["vite/client"]`, `include: ["src"]`, `exclude: ["src/worker", "src/gpu", "src/video", "src/nodes/*/kernel.ts", "src/engine/ambient.d.ts"]`.
- `tsconfig.worker.json`: `lib: ["ESNext", "WebWorker"]`, `types: ["vite/client", "@webgpu/types"]`, `include: ["src/worker", "src/gpu", "src/video", "src/engine", "src/nodes", "src/protocol.ts", "src/protocol-debug.ts"]`, `exclude: ["src/nodes/*/view.tsx", "src/engine/ambient.d.ts"]`.
- `tsconfig.engine.json`: `lib: ["ESNext"]`, `types: []`, `include: ["src/engine", "src/nodes/specs.ts", "src/nodes/*/spec.ts"]`. `src/engine/ambient.d.ts` declares the subset of `AbortController` and `AbortSignal` the executor uses and is included only here. A `GPU*`, DOM or worker global in engine code is a compile error in this program.
- `tsconfig.tests.json`: DOM lib plus `@webgpu/types`, `include: ["tests", "src/gpu/unpad.ts", "src/worker/bake-math.ts"]`, so tests are type-checked (test 60's `never` default depends on it).
- `tsconfig.json`: `{ "files": [], "references": [app, worker, engine, tests] }` for the editor, the Vite template's shape.

Controls at layer 1: a deliberate type error in a test file fails `npm run typecheck`; `navigator.gpu` in `src/engine/key.ts` fails it.

**`vite.config.ts`:**

```ts
import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: lazyPlugins(() => [react({ jsxImportSource: '@emotion/react' })]),
  worker: { format: 'es', plugins: () => [] },
  build: { target: 'esnext', outDir: 'build' },
  fmt: { semi: false, singleQuote: true },
  lint: {
    plugins: ['react', 'typescript', 'oxc'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/no-unnecessary-type-assertion': 'error',
      'vite-plus/prefer-vite-plus-imports': 'off',
    },
    overrides: [{
      files: ['src/engine/**', 'src/nodes/specs.ts', 'src/nodes/*/spec.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: ['react', 'react-dom', 'zustand*', '@xyflow/*', '*/gpu/*', '*/video/*', '*/worker/*', '*/ui/*'],
        }],
      },
    }],
  },
  test: {
    projects: [{ test: { name: 'unit', environment: 'node', include: ['tests/**/*.test.ts'] } }],
  },
})
```

`worker.plugins: () => []` is deliberate: Fast Refresh injects `import.meta.hot` into worker modules and corrupted ripple's worker. Tests keep `no-non-null-assertion` on; a justified assertion carries an inline disable with its reason, as the brief requires. The lint override's control at layer 1: `import { memo } from 'react'` in `src/engine/plan.ts` fails `npm run lint`. The worker is created with `new Worker(new URL('../worker/index.ts', import.meta.url), { type: 'module' })`; WGSL is imported with `?raw`.

**Git.** `git init -b main`; `.gitignore`: `node_modules`, `build`, `build-smoke`, `fixtures/`. Commits `type: <emoji>title`, 72 characters maximum, no body, no attribution trailer (owner rule, overriding the harness reminder). One repo per commit command, starting with `cd /home/banou/dev/cadence-editor &&`.

## 4. File and folder layout

```
src/
  main.tsx                      React entry: StrictMode, mounts <App/>, imports @xyflow/react/dist/base.css
  app.tsx                       two-pane layout, divider, switches to <Unsupported/> on the worker's verdict
  protocol.ts                   production main <-> worker unions (5.9)
  protocol-debug.ts             debug-only unions, handled only in development and smoke builds (decision 6)
  engine/                       pure: no React, no DOM, no WebGPU; its own tsconfig and lint boundary
    ambient.d.ts                AbortController/AbortSignal subset, engine program only
    port-types.ts               PortType, PORT_TABLE, isPortType
    handle-id.ts                handle id format and parser
    document.ts                 GraphDocument, pure edit ops, edge id derivation
    params.ts                   ParamSchema, defaults, clamping, canonical encoding
    node-spec.ts                NodeSpec, InputSpec with time demand, SpecRegistry
    source.ts                   SourceId, DecoderPath, SourceInfo, DecoderFailure
    adjacency.ts                adjacency map and reachability
    validate.ts                 validateConnection, validateDocument
    toposort.ts                 deterministic Kahn ordering
    time.ts                     FrameIndex (declared only here), offsetTime, encodeTime
    hash.ts                     FNV-1a 64 over a string, hex
    key.ts                      nodeKey, outputKey, canonical tuple
    payload.ts                  Payload<Tex> variants, payloadTexture, payloadBytes
    cache.ts                    LRU by bytes, pin table, put results, handOff
    alloc-retry.ts              out-of-memory sequencing over injected allocation and settle functions
    plan.ts                     resolveTarget, two-pass planning
    executor.ts                 run lock, step scopes, leases, coalescing, status events; ownership rules at its top
    status.ts                   NodeStatus, StatusEvent, RunOutcome, RunError, Lease
    index.ts                    barrel
  gpu/                          WebGPU, worker only
    capabilities.ts             the six checks and the unsupported text
    device.ts                   adapter, device, device.lost wiring
    allocator.ts                every texture and buffer: create, destroy, byte accounting, error scopes
    runner.ts                   KernelContext construction per step, submit with scopes, KernelRunner<GPUTexture>
    pipelines.ts                pipeline cache, warm-up, fixed per-kernel buffers
    present.ts                  canvas configure, resize, lease-holding presenter, synthetic slot
    readback.ts                 readback into a scratch texture and buffer
    unpad.ts                    pure: strip bytesPerRow padding from mapped rows
    preview/ registry.ts frame.ts motion.ts stub.ts synthetic.ts
    shaders/ present.wgsl flow-hsv.wgsl
  video/
    mp4-index.ts                moov-only chunked parse, trak lookup by track id, description bytes
    sample-table.ts             pure: table, presentable ranks, startSample, seekDecision, reseekCostMs, fps snap
    codec-support.ts            pure: path policy, PATH_COSTS, pathOfFormat, hint text
    decoder-session.ts          VideoDecoder wrapper with injected constructor and chunk reader
    frame-source.ts             frames by rank: waiters, look-behind and look-ahead windows, ingest, frame counters
    ingest.ts                   Ingest interface, ingest8, ingest10 slot
  nodes/
    specs.ts                    SPECS: Record<NodeTypeName, NodeSpec> (shared)
    video-source/ spec.ts kernel.ts view.tsx
    grayscale/    spec.ts kernel.ts view.tsx grayscale.wgsl
    blur/         spec.ts kernel.ts view.tsx blur.wgsl
    frame-delta/  spec.ts kernel.ts view.tsx frame-delta.wgsl frame-delta-mean.wgsl
    output/       spec.ts view.tsx
  worker/
    index.ts                    bootstrap, capability checks, message queue and dispatch
    kernels.ts                  KERNELS: Record<Exclude<NodeTypeName, 'output'>, Kernel<GPUTexture>> (worker only)
    runtime.ts                  the seam: executor, cache, allocator, runner, frame sources, presenter, bake
    bake.ts                     bake loop, bake store, playback
    bake-math.ts                pure: fitsFrames
  ui/
    worker-client.ts            main thread: the Worker, the placeholder canvas, typed post and subscribe
    store.ts                    zustand 5 store wiring xyflow changes to graph-actions
    graph-actions.ts            pure store transitions over { doc, flowNodes, flowEdges } (no xyflow values)
    graph-pane.tsx palette.tsx preview-pane.tsx divider.tsx timeline.tsx file-loader.tsx unsupported.tsx node-shell.tsx
    controls/ range.tsx number.tsx select.tsx
    theme.ts                    colour tokens and the <Global> styles for xyflow's own classes
tests/
  engine/  handle-id port-types document params validate toposort key cache alloc-retry plan executor (.test.ts)
  video/   sample-table mp4-index codec-support decoder-session frame-source (.test.ts)
  gpu/     unpad.test.ts
  worker/  bake-math.test.ts
  protocol/ protocol.test.ts
  nodes/   specs.test.ts
  ui/      graph-actions.test.ts
  fixtures/ tables.ts (synthetic), tables/*.json (dumped by make-fixture.sh), graphs.ts, fake-gpu.ts, fake-decoder.ts
scripts/
  make-fixture.sh               fixtures, colour references, table dumps, and their controls (16c)
  read-index.mjs                burned-in index reader shared by the fixture control and the smoke run
  smoke.mjs                     smoke run in headed Chrome on the owner's session, weston fallback (16b)
```

**The pure boundary.** `src/engine`, `src/nodes/specs.ts` and every `spec.ts` compile in a program with no DOM, worker or WebGPU lib (`tsconfig.engine.json`), and lint refuses React, zustand, xyflow and the GPU, video, worker and UI folders there; both checks have a control that must fail (section 3). Everything in the engine is generic over the texture type `Tex` and receives kernels, the cache disposer, a release function and a clock by injection. Kernels (`nodes/*/kernel.ts`) are built from their spec (`defineKernel(spec, run)`), so a kernel's type and version cannot disagree with its spec, and only `worker/kernels.ts` collects them. `worker/runtime.ts` is the one file that imports both the executor and the kernels. `protocol.ts` names `File` and `OffscreenCanvas` and is therefore outside the engine program.

## 5. Core type definitions

Real TypeScript in the house style. Documentation comments only on the exported contract.

### 5.1 PortType (`engine/port-types.ts`)

```ts
/** Every edge carries exactly one of these. Adding a member makes the compiler list every table keyed by it. */
export type PortType = 'frame' | 'regions' | 'motion' | 'scalar'

export const PORT_TYPES = ['frame', 'regions', 'motion', 'scalar'] as const satisfies readonly PortType[]

/** Where a port's payload lives: a GPU texture, or plain CPU data. */
export type PayloadKind = 'texture' | 'cpu'

export type PortInfo = {
  colour: string
  kind: PayloadKind
  /** Texel copy footprint per pixel for texture payloads; cpu payloads report their own size. */
  bytesPerPixel: number
  label: string
}

export const PORT_TABLE: Record<PortType, PortInfo> = {
  frame: { colour: '#e8c547', kind: 'texture', bytesPerPixel: 8, label: 'frame' },
  motion: { colour: '#5cc8ff', kind: 'texture', bytesPerPixel: 8, label: 'motion' },
  regions: { colour: '#9be564', kind: 'cpu', bytesPerPixel: 0, label: 'regions' },
  scalar: { colour: '#f28fad', kind: 'cpu', bytesPerPixel: 0, label: 'scalar' },
}

export const isPortType = (x: unknown): x is PortType =>
  typeof x === 'string' && (PORT_TYPES as readonly string[]).includes(x)
```

8 bytes per pixel is `rgba16float` for frames and `rg32float` for motion. The preview registry is a second `Record<PortType, PreviewRenderer>` on the GPU side.

### 5.2 Handle ids (`engine/handle-id.ts`)

Format `${direction}:${portType}:${portName}` (`in:frame:a`, `out:scalar:mean`); port names match `[a-z][a-z0-9]*`.

```ts
export type HandleDirection = 'in' | 'out'
export type HandleId = `${HandleDirection}:${PortType}:${string}`
export type ParsedHandle = { direction: HandleDirection; type: PortType; port: string }

export const handleId = (direction: HandleDirection, type: PortType, port: string): HandleId =>
  `${direction}:${type}:${port}`

const PORT_NAME = /^[a-z][a-z0-9]*$/

export const parseHandleId = (id: string | null | undefined): ParsedHandle | null => {
  if (!id) return null
  const parts = id.split(':')
  if (parts.length !== 3) return null
  const [direction, type, port] = parts
  if ((direction !== 'in' && direction !== 'out') || !isPortType(type) || !port || !PORT_NAME.test(port)) return null
  return { direction, type, port }
}
```

### 5.3 Graph document and params (`engine/document.ts`, `engine/params.ts`)

```ts
export type NodeId = string
export type EdgeId = string
export type NodeTypeName = 'videoSource' | 'grayscale' | 'blur' | 'frameDelta' | 'output'

export type ParamValue = number | boolean | string
export type ParamValues = Record<string, ParamValue>

export type GraphNode = { id: NodeId; type: NodeTypeName; params: ParamValues }

/** One edge per target port: the edge id is derived from the target port. */
export type GraphEdge = { id: EdgeId; source: NodeId; sourcePort: string; target: NodeId; targetPort: string }

export type GraphDocument = { nodes: Record<NodeId, GraphNode>; edges: Record<EdgeId, GraphEdge>; nextId: number }

export const edgeId = (target: NodeId, targetPort: string): EdgeId => `e.${target}.${targetPort}`

export type ParamSchema =
  | { kind: 'int'; min: number; max: number; step: number; default: number }
  | { kind: 'float'; min: number; max: number; step: number; default: number }
  | { kind: 'bool'; default: boolean }
  | { kind: 'enum'; options: readonly string[]; default: string }
  /** A loaded source id. Not clamped against a static list; the empty default plans as `unconnected`. */
  | { kind: 'source'; default: '' }

export type ParamsSchema = Record<string, ParamSchema>
```

Pure edit ops return a new document: `addNode(doc, type)` (params from schema defaults), `removeNode(doc, id)` (drops incident edges), `setParam(doc, id, name, value)` (clamped through the schema), `connect(doc, edge)` (replaces the edge on that target port), `disconnect(doc, edgeId)`. Positions are UI state, not document state.

### 5.4 NodeSpec and kernels (`engine/node-spec.ts`, `gpu/runner.ts`)

```ts
export type PortSpec = { name: string; type: PortType }

/** What an input needs from upstream, relative to the node's instant. Later variants (window, scope) differ in shape. */
export type TimeDemand = { offset: number }

export type InputSpec = PortSpec & {
  /** The instant offset this input is evaluated at, from the node's params. Defaults to offset 0. */
  demand?: (params: ParamValues) => TimeDemand
}

/** The pure description of a node, shared by editor, engine and worker. Never holds GPU state. */
export type NodeSpec = {
  type: NodeTypeName
  label: string
  inputs: readonly InputSpec[]
  outputs: readonly PortSpec[]
  params: ParamsSchema
  /** Bumped whenever the kernel's output for the same inputs changes. Part of every key. */
  kernelVersion: number
  /** True when output depends on the instant even with identical inputs and params (sources). */
  timeDependent: boolean
  /** How a time-dependent node spells its instant in the key. Defaults to encodeTime. */
  timeKey?: (t: FrameIndex, params: ParamValues) => string
}

export type SpecRegistry = Record<NodeTypeName, NodeSpec>
```

What the pure executor sees (`engine/executor.ts`):

```ts
/** Textures a step owns. The executor releases every texture still owned when the step settles. */
export type StepScope<Tex> = {
  adopt: (tex: Tex) => void
  disown: (tex: Tex) => void
  signal: AbortSignal
}

export type KernelRunner<Tex> = {
  /** Bytes the step is expected to allocate for its outputs, used to make room before it runs. */
  estimate: (node: GraphNode, inputs: Record<string, Payload<Tex>>) => number
  run: (node: GraphNode, inputs: Record<string, Payload<Tex>>, time: FrameIndex, scope: StepScope<Tex>) => Promise<Record<string, Payload<Tex>>>
}

/** A rejection carrying a typed error. Anything else a kernel throws becomes a `kernel` RunError. */
export type StepFailure = { failure: RunError }
export const isStepFailure = (x: unknown): x is StepFailure =>
  typeof x === 'object' && x !== null && 'failure' in x
```

What a kernel sees (`gpu/runner.ts`, worker program):

```ts
export type KernelContext = {
  /** Allocates through the allocator and adopts into the step's scope. */
  alloc: (desc: GPUTextureDescriptor) => Promise<GPUTexture>
  allocBuffer: (desc: GPUBufferDescriptor) => Promise<GPUBuffer>
  /** Hands a payload to the cache under a key; disowns it from the step first. */
  offer: (key: CacheKey, payload: Payload<GPUTexture>) => void
  /** Source kernels only; bound to this step's scope, so the resolved texture is already owned by the step. */
  frames?: { frameAt: (rank: number) => Promise<FramePayload<GPUTexture>> }
  /** Pushes validation and out-of-memory scopes, refuses if aborted, submits, awaits the pops; rejects with a StepFailure of kind 'gpu'. */
  submit: (encode: (encoder: GPUCommandEncoder) => void) => Promise<void>
  device: GPUDevice
  signal: AbortSignal
}

export type Kernel = {
  spec: NodeSpec
  run: (ctx: KernelContext, inputs: Record<string, Payload<GPUTexture>>, params: ParamValues, time: FrameIndex) => Promise<Record<string, Payload<GPUTexture>>>
}

export const defineKernel = (spec: NodeSpec, run: Kernel['run']): Kernel => ({ spec, run })
```

### 5.5 Payloads (`engine/payload.ts`)

```ts
export type FramePayload<Tex> = {
  port: 'frame'
  texture: Tex
  width: number
  height: number
  bytes: number
  /** 'signed' values are centred on 0 (deltas) and presented through a remap. Kernels that preserve range copy it. */
  range: 'unit' | 'signed'
}
export type MotionPayload<Tex> = { port: 'motion'; texture: Tex; width: number; height: number; bytes: number }
export type RegionsPayload = { port: 'regions'; count: number; data: Float32Array; bytes: number }
export type ScalarPayload = { port: 'scalar'; value: number; bytes: 0 }

export type Payload<Tex> = FramePayload<Tex> | MotionPayload<Tex> | RegionsPayload | ScalarPayload

export const payloadTexture = <Tex>(p: Payload<Tex>): Tex | null =>
  p.port === 'frame' || p.port === 'motion' ? p.texture : null
```

`Tex` is `GPUTexture` in the worker and `{ id: number; destroyed: boolean }` in tests.

### 5.6 Keys (`engine/key.ts`)

```ts
/** 16 hex characters of FNV-1a 64 over a canonical JSON tuple. Opaque outside key.ts. */
export type CacheKey = string & { readonly __brand: 'CacheKey' }

/** An upstream output consumed by an input port. */
export type InputRef = { targetPort: string; output: CacheKey }

export const nodeKey = (spec: NodeSpec, params: ParamValues, inputs: readonly InputRef[], time: FrameIndex): CacheKey
export const outputKey = (node: CacheKey, port: string): CacheKey
```

The canonical string is `JSON.stringify([type, kernelVersion, params, inputs, time])`, where `params` is the schema-ordered array of `[name, kind, canonical]` triples, `inputs` is `[targetPort, outputKey]` pairs sorted by target port, and `time` is `spec.timeKey ?? encodeTime` applied for time-dependent specs, else `null`. JSON escaping means a source id containing `|`, `:`, `@` or `"` cannot collide with another tuple. Each output port has its own key, `outputKey(nodeKey, port)`, and a downstream input records that output key, so two consumers of different outputs of one node get different keys. A node key changes if and only if its type, version, params, input output-keys or time spelling changes. The canonical string is kept beside the key in development builds.

### 5.7 Plans, status and errors (`engine/plan.ts`, `engine/status.ts`)

```ts
export type RequestId = number
export type PortRef = { node: NodeId; port: string }

export type PlanStep = {
  /** Nodes sharing this node key; the first one runs, all of them receive its status events. */
  nodes: readonly NodeId[]
  time: FrameIndex
  key: CacheKey
  /** Every output of the node, by port. Running a node stores all of them. */
  outputs: Record<string, CacheKey>
  /** The output keys this step consumes, by input port. */
  inputs: Record<string, CacheKey>
}

export type Plan = {
  target: PortRef
  time: FrameIndex
  targetKey: CacheKey
  steps: readonly PlanStep[]
  /** Demanded outputs already in the cache when planned. */
  hits: readonly { node: NodeId; time: FrameIndex; key: CacheKey }[]
  /** Nodes whose keys were computed but whose outputs are not needed, because a descendant is a hit. */
  skipped: readonly { node: NodeId; time: FrameIndex }[]
  /** Every key the run reads or writes. */
  pins: readonly CacheKey[]
}

export type NodeStatus = 'idle' | 'skipped' | 'cached' | 'running' | 'done' | 'failed' | 'cancelled'

export type StatusEvent = { request: RequestId; node: NodeId; time: FrameIndex; status: NodeStatus; ms?: number }

/** A pin held past the run. release() is idempotent. */
export type Lease = { key: CacheKey; release: () => void }

export type RunOutcome =
  | { status: 'done'; request: RequestId; lease: Lease }
  | { status: 'cancelled'; request: RequestId }
  | { status: 'failed'; request: RequestId; error: RunError }

export type RunError =
  | { kind: 'kernel'; node: NodeId; message: string }
  | { kind: 'gpu'; node: NodeId; filter: 'validation' | 'out-of-memory' | 'internal'; message: string }
  | { kind: 'out-of-memory'; node: NodeId; bytesWanted: number; budget: number }
  | { kind: 'decoder'; node: NodeId; failure: DecoderFailure }
  | { kind: 'device-lost'; reason: 'unknown' | 'destroyed'; message: string }
  | { kind: 'unconnected'; node: NodeId; port: string }
```

The variants are small records the UI switches on, so the `kind` tag is warranted.

### 5.8 Sources (`engine/source.ts`)

```ts
/** `${name}:${size}:${lastModified}`: the File's identity, not a content hash. */
export type SourceId = string

/** The Chrome decoder a source is bound to for its whole session. */
export type DecoderPath = 'software' | 'hardware'

export type SourceInfo = {
  id: SourceId
  codec: string
  width: number
  height: number
  /** Presentable frames only (section 10). */
  frames: number
  /** Derived from the table and snapped to a standard rate; display only. */
  fps: { num: number; den: number }
  decoder: DecoderPath
  syncSpacing: { min: number; max: number }
}

/** Why a decoder did not produce a frame. "Did not answer" and "answered badly" are different variants. */
export type DecoderFailure =
  | { reason: 'stalled'; rank: number; ms: number }
  | { reason: 'not-output'; rank: number }
  | { reason: 'decode-error'; name: string; message: string }
  | { reason: 'reclaimed' }
  | { reason: 'path-unavailable'; path: DecoderPath }
  | { reason: 'path-mismatch'; expected: DecoderPath; got: DecoderPath }
  | { reason: 'key-refused'; sample: number }
```

### 5.9 The protocol (`src/protocol.ts`, `src/protocol-debug.ts`)

Both directions are tagged on `type`: a cross-realm contract is the one place a synthetic tag is used throughout. Nothing here holds a GPU object or a `VideoFrame`.

```ts
import type { CacheKey, FrameIndex, GraphDocument, PortRef, RequestId, RunError, StatusEvent } from './engine'
import type { DecoderFailure, SourceId, SourceInfo } from './engine/source'
import type { PortType } from './engine/port-types'
import type { ConnectionProblem } from './engine/validate'

/** Main thread to worker. `init` is sent once per worker, with the canvas in the transfer list. */
export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; budgetBytes: number; bakeBudgetBytes: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'load-source'; id: SourceId; file: File }
  | { type: 'unload-source'; id: SourceId }
  | { type: 'set-graph'; doc: GraphDocument }
  | { type: 'inspect'; request: RequestId; target: PortRef; time: FrameIndex }
  | { type: 'bake'; request: RequestId; target: PortRef; start: FrameIndex; end: FrameIndex }
  | { type: 'cancel'; request: RequestId }
  | { type: 'bake-show'; bake: RequestId; time: FrameIndex }
  | { type: 'bake-play'; bake: RequestId; playing: boolean }
  | { type: 'bake-release'; bake: RequestId }
  | { type: 'set-view'; deltaRange: number }
  | { type: 'set-budget'; budgetBytes: number }

/** Worker to main thread. */
export type FromWorker =
  | { type: 'ready'; adapter: { vendor: string; architecture: string }; canvasFormat: string }
  | { type: 'unsupported'; capability: MissingCapability; detail: string }
  | { type: 'graph-rejected'; problem: ConnectionProblem }
  | { type: 'source-loaded'; info: SourceInfo }
  | { type: 'source-error'; id: SourceId; error: SourceError }
  | { type: 'node-status'; event: StatusEvent }
  | { type: 'run-done'; request: RequestId; key: CacheKey; time: FrameIndex; port: PortType; scalar?: number }
  | { type: 'run-cancelled'; request: RequestId }
  | { type: 'run-error'; request: RequestId; error: RunError }
  | { type: 'bake-progress'; request: RequestId; done: number; total: number }
  | { type: 'bake-done'; request: RequestId; frames: number; bytes: number }
  | { type: 'bake-refused'; request: RequestId; fits: number; wanted: number }
  | { type: 'bake-frame'; bake: RequestId; time: FrameIndex }
  | { type: 'device-lost'; reason: 'unknown' | 'destroyed'; message: string }
  | { type: 'stats'; stats: WorkerStats }

export type WorkerStats = {
  cacheBytes: number
  budgetBytes: number
  entries: number
  pinnedKeys: number
  bakeBytes: number
  /** The presenter's synthetic slot (preview-test), 0 when a keyed payload is shown. */
  syntheticBytes: number
  /** Pipelines' fixed buffers, allocated once at warm-up. */
  fixedBytes: number
  /** Readback texture and buffer while a readback is in flight; 0 at rest. */
  scratchBytes: number
  liveTextures: number
  liveBuffers: number
  /** At rest: liveBytes === cacheBytes + bakeBytes + syntheticBytes + fixedBytes, and scratchBytes === 0. */
  liveBytes: number
  decoder: { reseeks: number; flushes: number; chunksFed: number; framesOut: number; framesClosed: number; framesHeld: number; observedLag: number }
}

export type MissingCapability = 'navigator-gpu' | 'adapter' | 'fallback-adapter-only' | 'video-frame' | 'video-decoder' | 'canvas-webgpu' | 'video-frame-copy'

export type SourceError =
  | { kind: 'not-mp4'; message: string }
  | { kind: 'no-video-track' }
  | { kind: 'unsupported-codec'; codec: string; hint: string }
  | { kind: 'decode'; failure: DecoderFailure }
```

```ts
/** Development and smoke builds only; a production worker ignores these. */
export type DebugToWorker =
  | { type: 'readback'; request: RequestId }
  | { type: 'debug-leak'; bytes: number }
  | { type: 'debug-delay'; nodeType: NodeTypeName; ms: number }
  | { type: 'preview-test'; port: PortType }

export type DebugFromWorker = { type: 'readback-result'; request: RequestId; width: number; height: number; rgba: Uint8Array }
```

The worker's dispatch accepts them only when `import.meta.env.MODE !== 'production'`; the development "Check frame" and "Test flow wheel" buttons and the smoke run use them.

`readback` renders the image on screen (the leased payload, the bake frame shown, or the synthetic slot) through its preview renderer into a scratch `rgba8unorm` texture at the payload's own size, copies it to a `MAP_READ` scratch buffer with `bytesPerRow = ceil(4 * width / 256) * 256`, awaits `mapAsync`, copies the rows without padding into a fresh `Uint8Array(width * height * 4)` (`gpu/unpad.ts`), unmaps, releases both scratch objects, and posts the copy with its buffer transferred (a mapped range cannot be transferred). `debug-leak` allocates one texture no owner records, so the leak identity has a case it must fail on. `debug-delay` makes the runner wait `ms` inside the named kernel before its submit, so a smoke step can abort a run mid-kernel deterministically.

## 6. The engine

### 6.1 Validation (`engine/validate.ts`)

```ts
/** Accepts xyflow's `Edge | Connection` directly: edge handles are optional there. */
export type ConnectionCandidate = {
  source: NodeId
  sourceHandle?: string | null
  target: NodeId
  targetHandle?: string | null
}

export type ConnectionProblem =
  | { kind: 'malformed-handle'; handle: string | null }
  | { kind: 'unknown-node'; node: NodeId }
  | { kind: 'unknown-port'; node: NodeId; port: string }
  | { kind: 'direction' }
  | { kind: 'self-loop' }
  | { kind: 'type-mismatch'; from: PortType; to: PortType }
  | { kind: 'cycle'; path: NodeId[] }

export type ConnectionVerdict = { ok: true; edge: GraphEdge; replaces: EdgeId | null } | { ok: false; problem: ConnectionProblem }

export const validateConnection = (doc: GraphDocument, specs: SpecRegistry, c: ConnectionCandidate): ConnectionVerdict
export const validateDocument = (doc: GraphDocument, specs: SpecRegistry): { ok: true } | { ok: false; problem: ConnectionProblem }
```

Checks in order, each with a test: both handles parse; both nodes exist; source handle is `out` and target is `in`; `source !== target`; both ports exist on their specs; types equal; and the cycle check `reaches(adjacency(doc), target, source)`. An occupied input is not a problem: the verdict names the edge it `replaces`. `validateDocument` runs the same checks per edge plus a toposort. The xyflow prop is `isValidConnection = (c) => validateConnection(useGraph.getState().doc, SPECS, c).ok`, module-level, reading the store so it never captures stale nodes. The worker runs `validateDocument` on every `set-graph` and answers a failure with `graph-rejected`, keeping its previous graph.

### 6.2 Adjacency and toposort

`adjacency(doc)` builds `{ out: Map<NodeId, Set<NodeId>>, in: Map<NodeId, GraphEdge[]> }` in one pass. `reaches` is an iterative DFS. `toposort(doc)` is Kahn's algorithm with a ready set sorted by node id, so the order is a pure function of the document; it returns `{ order } | { cycle }` and backs `validateDocument`. Execution order comes from the planner, and its own property test checks it against the edges (test 30).

### 6.3 Key derivation

`canonicalParams(schema, params)` walks the schema's keys in schema order with the default as fallback: `int` truncates and prints decimal; `float` prints the IEEE 754 bit pattern as 16 hex characters (so `-0` and `0` differ, and `2` and `2.0000001` differ; `NaN` is refused by the clamp); `bool` is `1`/`0`; `enum` and `source` are the string. `nodeKey` builds the tuple of 5.6 and hashes it; `outputKey` hashes `[nodeKey, port]`.

### 6.4 Time (`engine/time.ts`)

```ts
/** Milestone 1: an integer source frame. The rational extension replaces this alias and the functions below. */
export type FrameIndex = number

export const offsetTime = (t: FrameIndex, d: TimeDemand): FrameIndex => t + d.offset
export const encodeTime = (t: FrameIndex): string => String(t)
```

Later: `Instant = { num: number; den: number }` reduced, `encodeTime` writes `num/den`, `offsetTime` adds rationals, and a source's `timeKey` quantises (VideoSource keys on `floor(instant)`, so every output instant inside one source interval hits one decoded frame). `window` and `scope` demands become branches in `demandInstants(demand, t)` with list-valued inputs.

### 6.5 Planning (`engine/plan.ts`)

`resolveTarget(doc, specs, selected, pickedPort)`: a node with outputs targets `pickedPort` or its first output; Output (no outputs) targets the output feeding its input; an unconnected Output yields `unconnected`.

Keys depend on input keys, so a cache hit cannot be known before the ancestors' keys are, and planning is two passes:

1. **Keys, bottom-up, no cache.** A memoised recursion over `(node, time)` from the target computes every node key and output key in the target's demand closure, applying each input's demand to reach the upstream instant. A missing edge or an empty `source` param yields `unconnected`. The worker validated the document, so this pass sees no cycle; an in-progress set turns one into `graph-rejected` rather than unbounded recursion.
2. **Demand, top-down, against the cache.** Starting from the target's output key at `time`: if `cache.has(outputKey)`, record a hit and stop descending; otherwise emit the node's step once per node key (two VideoSource nodes on one source at one instant share one step, whose `nodes` lists both), recurse into the outputs its inputs consume, and append the step after them (post-order, a valid execution order). Closure nodes pass 2 never reaches are `skipped`.

`pins` holds every key pass 2 touched: hits, step outputs and step inputs. Planning is pure and synchronous, tested with a fake cache.

### 6.6 The executor (`engine/executor.ts`)

```ts
export type ExecutorDeps<Tex> = {
  specs: SpecRegistry
  runner: KernelRunner<Tex>
  cache: Cache<Tex>
  release: (tex: Tex) => void
  emit: (e: StatusEvent) => void
  now: () => number
}

export const createExecutor = <Tex>(deps: ExecutorDeps<Tex>) => ({
  /** Latest wins: a new inspect aborts the running one and replaces any queued one. */
  inspect: (request: RequestId, doc: GraphDocument, target: PortRef, time: FrameIndex) => Promise<RunOutcome>,
  /** One planned run under an external signal; bake calls it once per frame. */
  run: (request: RequestId, doc: GraphDocument, target: PortRef, time: FrameIndex, signal: AbortSignal) => Promise<RunOutcome>,
  cancel: (request: RequestId) => void,
  abortAll: () => void,
})
```

**Run lock.** Every `run` first awaits the settle of the previous run, whichever caller started it, so inspect and bake never overlap and the executor never holds two runs. Then, in one synchronous section, it plans, pins `plan.pins`, and emits `skipped` and `cached` events.

**Each step, in order:**

1. If every output key of the step is now in the cache (an offer or an earlier step stored it), emit `cached` and continue.
2. If `signal.aborted`, emit `cancelled` for this step and return `cancelled`.
3. `cache.makeRoom(runner.estimate(node, inputs), 'lru')`.
4. Emit `running`, create the step's owned set and scope, and await `runner.run`.
5. On resolve: every output port of the spec must be present, and every output texture must be in the owned set (a kernel that returns a borrowed or cached texture fails with `kernel`). Disown each output and `handOff` it under its output key. Release everything still owned. Emit `done` with `ms`. A kernel that resolves after the signal fired still stores its outputs, since they are correct; step 2 of the next step then cancels.
6. On reject: release everything owned; `signal.aborted` means `cancelled`, a `StepFailure` means `failed` with its error, anything else is a `kernel` error with its message. Later steps do not run.

`finally` unpins every plan key. On `done` the target key is pinned once more first and returned as the outcome's `Lease`, so nothing can evict the result between the run and its consumer.

**Coalescing.** `inspect` keeps `current` and `pending`. A new inspect aborts `current` and replaces `pending` (the replaced one resolves `cancelled` without running). An inspect whose request is no longer the latest received resolves `cancelled` even if its run completed, releasing the lease: only the latest request is ever presented, and a stale `run-done` cannot land after a newer request was sent. Cancellation is decided by `signal.aborted`, never by an error's name.

`ms` runs from `running` to the kernel's resolve, which includes the awaited error-scope pops: issue and validation time, labelled "issue". GPU timing needs `timestamp-query`, not milestone 1.

### 6.7 The cache (`engine/cache.ts`)

```ts
export type EvictReason = 'lru' | 'budget-lowered' | 'out-of-memory' | 'clear'
export type PutResult = 'stored' | 'duplicate' | 'refused'

export type Cache<Tex> = {
  has: (key: CacheKey) => boolean
  /** Touches the entry. */
  get: (key: CacheKey) => Payload<Tex> | undefined
  /** 'stored' also when this exact payload object is already stored; 'duplicate' for a different payload under a held key; 'refused' after close(). */
  put: (key: CacheKey, payload: Payload<Tex>) => PutResult
  /** Valid for absent keys: the pin protects the entry once it is stored. */
  pin: (key: CacheKey) => void
  unpin: (key: CacheKey) => void
  /** Evicts unpinned entries, least recently used first, until `bytes` more fit the budget. Returns bytes freed. */
  makeRoom: (bytes: number, reason: EvictReason) => number
  setBudget: (bytes: number, reason: EvictReason) => void
  /** Clears with a no-op disposer and refuses every later put (device loss). */
  close: () => void
  stats: () => { bytes: number; budget: number; entries: number; pinnedKeys: number }
}

export const createCache = <Tex>(budget: number, dispose: (p: Payload<Tex>) => void): Cache<Tex>

export const handOff = <Tex>(cache: Cache<Tex>, release: (tex: Tex) => void, key: CacheKey, payload: Payload<Tex>): PutResult => {
  const result = cache.put(key, payload)
  const tex = payloadTexture(payload)
  if (result !== 'stored' && tex !== null) release(tex)
  return result
}
```

A `Map` in insertion order is the LRU (`get` re-inserts). Pins are counts in a separate `Map<CacheKey, number>`, consulted by `makeRoom`, so they exist before their entries do. The budget is soft against pins (an entry is stored even when only pinned entries remain, and `stats().bytes` shows the overshoot) and hard against everything else. `dispose` runs synchronously on eviction; in the worker it is the allocator's release.

**Default budget: 2 GiB** (129 frames of 1080p `rgba16float`), a choice for this machine, not a measurement. The stats readout sets it (`set-budget`); the UI keeps the owner's value in `localStorage`.

**Out-of-memory sequencing** (`engine/alloc-retry.ts`):

```ts
export type RetryDeps<Tex> = {
  attempt: () => Promise<Tex | null>
  /** Lowers the cache budget; the runtime passes max(256 MiB, cacheBytes - 2 * bytes). */
  lowerBudget: (bytes: number) => void
  /** Resolves after queued GPU work completes and one task has run. */
  settle: () => Promise<void>
}

export const allocWithRetry = async <Tex>(deps: RetryDeps<Tex>, bytes: number, speculative: boolean): Promise<Tex | null> => {
  const first = await deps.attempt()
  if (first !== null || speculative) return first
  deps.lowerBudget(bytes)
  await deps.settle()
  return deps.attempt()
}
```

### 6.8 Status events and the invalidation story in the UI

Each request reports its demand closure: `skipped` for nodes above a hit, `cached` for hits, and `running` then `done`, `failed` or `cancelled` for steps, all carrying `request` and `time`. The store keeps the latest request's events per node (FrameDelta's upstream reports two instants) and shows one badge per node: `running` over `failed` over `cancelled` over `done` (issue times summed) over `cached` over `skipped`. When a request settles, every node it did not report becomes `idle`; events from requests older than `run.request` are dropped. After a radius change on `VideoSource -> Blur -> Grayscale -> Output`: VideoSource `cached`, Blur and Grayscale `running` then `done`. After a Grayscale weights change: VideoSource `skipped` (dimmed, "not needed"), Blur `cached`, Grayscale runs. The badge flashes on `running`, so a fast rerun and a hit read differently.

### 6.9 Fitting the future without rewriting

| later need | what changes | what does not |
| --- | --- | --- |
| rational instants | `FrameIndex` becomes `Instant`; `offsetTime`, `encodeTime`; VideoSource's `timeKey` quantises; the timeline's step | plan, executor, cache, key tuple, protocol shape |
| frame windows (t-2..t+2) | `TimeDemand` gains `{ window }`; `demandInstants` returns a list; list-valued input payloads | executor, cache |
| whole-shot scope | `{ scope: 'shot' }` plus a shot table; planning gains a phase that evaluates the table first | executor, cache (keys stay per instant or per shot) |
| per-shot outputs | `timeDependent: false` with scoped inputs: one key per shot, a hit at every frame | |
| CPU payloads | `regions` and `scalar` already have payload kinds and byte accounting | |

**FrameDelta in milestone 1.** Input `b` demands `t + offset`. With VideoSource upstream, pass 2 emits VideoSource steps at `t` and `t + 1`. The first step's decode usually leaves frame `t + 1` in the frame source's look-ahead window, so it is offered to the cache and the second step becomes `cached` at step 1; otherwise the session feeds a few chunks forward. Neither case reseeks (section 10), and stepping the timeline to `t + 1` finds that frame cached.

## 7. Texture lifetime and ownership rules

This block sits verbatim at the top of `src/engine/executor.ts` and is referenced from `gpu/allocator.ts`, `video/frame-source.ts` and `worker/runtime.ts`.

```ts
/*
 * GPU ownership rules. Every GPUTexture and GPUBuffer has exactly one owner at every moment, and
 * ownership moves only at the points below. An object with no owner is a leak; the allocator's live
 * count finds it (rule 14).
 *
 *  1. The allocator (gpu/allocator.ts) creates every texture and buffer and is the only caller of
 *     destroy(). It records bytes per object and keeps a live set. Every creation runs inside
 *     validation and out-of-memory error scopes.
 *  2. Steps own what they allocate. ctx.alloc and ctx.allocBuffer adopt into the step's scope the
 *     moment they resolve. When the step settles, on return, throw or abort, the executor releases
 *     everything the scope still owns; an allocation that resolves into an already settled scope is
 *     released at once and rejects. Kernels release intermediates in finally, but nothing depends
 *     on it. A kernel's outputs must be textures it allocated in this step: returning a borrowed
 *     input or a cached payload fails the step.
 *  3. Hand-off. The executor disowns each output and calls handOff(cache, release, key, payload):
 *     'stored' means the cache owns it; 'duplicate' or 'refused' means it is released at once. The
 *     executor re-checks the cache before each step, so a key stored meanwhile is a hit, not a second
 *     allocation. Outputs are handed off only after ctx.submit resolved with clean error scopes; an
 *     abort after a clean submit still stores (the content is correct); a popped GPUError fails the
 *     step with RunError 'gpu' and rule 2 releases everything it owned.
 *  4. The cache owns stored payloads and disposes them only on eviction or close. Pins are counts in
 *     a table keyed by CacheKey, independent of entries, so a pin placed before put protects the
 *     entry once stored. A run plans and pins in one synchronous section and unpins in finally,
 *     except its target key, which passes to the caller as a Lease.
 *  5. Inputs are borrowed: a kernel never destroys, stores or returns an input payload, and the run's
 *     pins keep inputs alive for the whole run.
 *  6. destroy() after queue.submit() is valid and the submitted work completes; encoding a use of a
 *     destroyed texture is a validation error at submit. Memory returns only once queued work
 *     completes, not at destroy(), which is why rule 11 waits before retrying.
 *  7. VideoFrames. The frame source holds each VideoFrame in a try/finally that closes it, spanning
 *     the whole ingest including the allocation await; no VideoFrame is stored, posted or returned
 *     past it. The frame source allocates every ingest texture and owns it until one of three things:
 *     it adopts it, synchronously, into the scope of a step still waiting for that rank as it resolves
 *     the wait (an aborted waiter was already rejected and removed); it hands it off as a speculative
 *     look-behind or look-ahead frame (skipped when the key is cached, allocated without retry); or it
 *     releases it. Textures are sized from displayWidth/displayHeight, never the coded size.
 *  8. The presenter holds exactly one thing on screen: a Lease, a bake frame (owned by the bake
 *     store), or its synthetic slot texture (preview-test, owned by the presenter). Presenting
 *     something new submits the draw, then releases the lease or synthetic texture it replaced.
 *     Resize re-presents what it holds.
 *  9. The bake store owns baked textures under its own budget. A bake frame is rendered from the
 *     run's Lease into a new texture, onSubmittedWorkDone is awaited, then the lease is released.
 *     bake-release stops playback, aborts and awaits a running bake, moves the presenter to its lease
 *     or clears it, and only then destroys the store.
 * 10. Scratch and fixed objects. The readback texture and buffer exist only during a readback and are
 *     released (the buffer after unmap) before its result is posted. Pipelines allocate their uniform
 *     and storage buffers once at warm-up; they count as fixed and live until device loss.
 * 11. Out of memory. A creation whose out-of-memory scope pops an error yields null. Speculative
 *     allocations stop there. Others lower the cache budget to max(256 MiB, cacheBytes - 2 * wanted),
 *     which evicts least recently used entries, await onSubmittedWorkDone and one task, and retry once;
 *     a second failure is RunError 'out-of-memory'. The lowered budget stays and stats report it.
 * 12. Device loss. device.lost aborts every run and the bake, marks every object dead without
 *     destroy(), makes alloc reject, closes the cache (put refused), drops the bake store, closes the
 *     decoder sessions and posts device-lost. No recovery in milestone 1: the page offers a reload.
 * 13. Nothing GPU crosses postMessage. The main thread holds keys and status; the only pixels it
 *     receives are debug readbacks.
 * 14. Leak identity. At rest (no run, no readback): liveBytes === cacheBytes + bakeBytes +
 *     syntheticBytes + fixedBytes, scratchBytes === 0, and the decoder counters satisfy
 *     framesOut === framesClosed with framesHeld === 0. Engine tests assert it with a fake allocator
 *     and fake kernels that deliberately never release; the smoke run asserts it in the owner's
 *     Chrome with debug-leak as the control that must break it.
 */
```

## 8. Worker and protocol

**Bootstrap** (`worker/index.ts`). The worker runs the capability checks it can without a canvas (`navigator.gpu`, adapter with its one retry, `VideoFrame`, `VideoDecoder`), then waits for `init`. On `init` it takes the canvas, gets the `webgpu` context, requests the device (arming `device.lost` first), runs the `VideoFrame` copy probe, configures the canvas, compiles every kernel and preview pipeline and allocates their fixed buffers, and posts `ready` or `unsupported`. Messages that arrive before `ready` are queued in order, never dropped.

**OffscreenCanvas transfer, exactly once.** `ui/worker-client.ts` holds module-level singletons created on first use: the `Worker`, a placeholder `HTMLCanvasElement` from `document.createElement`, and the `OffscreenCanvas` from `transferControlToOffscreen()`, posted in the `init` transfer list. `PreviewPane`'s effect appends the placeholder to its container and removes it on cleanup; under StrictMode the second mount re-appends the same element and nothing transfers again (a second transfer throws `InvalidStateError`, and only the worker can resize the canvas, measured). A development edit to this module calls `location.reload()` from `import.meta.hot.dispose`: re-running it would create a second worker with its own device and cache while the first keeps its textures, which no single worker's stats could see.

**Resize.** A `ResizeObserver` on the container reads `devicePixelContentBoxSize[0]`, else `contentBoxSize[0]` times `devicePixelRatio`, rounds, and posts `resize` when the pair changes. The worker sets `canvas.width`/`height` (no reconfigure needed, measured) and re-presents what it holds (rule 8). The placeholder's CSS is `width: 100%; height: 100%; display: block`, so a non-integer DPR only affects the backing size.

**Files.** `load-source` carries the `File` by structured clone (the blob is shared, not copied); the worker reads it with `file.slice(a, b).arrayBuffer()`. `unload-source` aborts the source's waiters, closes its session and evicts nothing (keys are content-addressed and age out).

**Graph.** `set-graph` runs `validateDocument`; a failure posts `graph-rejected` and keeps the previous graph. The store validates first, so this fires only when a bug lets a bad document through.

**Requests and cancellation.** The client assigns `RequestId`s from a counter. `inspect` goes through the executor's coalescing (6.6): a superseded request answers `run-cancelled`, and only a request that is still the latest is presented and answered `run-done`. `cancel` aborts the named request if it is current or pending. `bake` aborts a running inspect and then waits on the run lock; an `inspect` during a bake aborts the bake, and the UI asks before sending one (in Bake mode the inspect subscription is paused, section 12). Every wait, including a decoder wait, takes the run's `AbortSignal`.

**Error kinds.** `unsupported` names the missing capability. `source-error` covers parse, no video track, unsupported codec (with the command) and decode failures carrying a `DecoderFailure`. `run-error` carries `RunError`. Every error is a typed variant; the UI never matches message text.

**Backpressure.** One run at a time (the run lock), one node per submit. Bake awaits `queue.onSubmittedWorkDone()` after each frame, so at most one frame of GPU work is in flight and cancel lands within a frame. The decoder session has one feed loop per source and awaits `dequeue` while `decodeQueueSize > 4`. The worker posts `stats` at most every 250 ms while anything changed; the store batches `node-status` events per animation frame.

## 9. WebGPU setup

**Capability checks, in the worker, in order; the first failure is the verdict:**

| # | check | `MissingCapability` |
| --- | --- | --- |
| 1 | `'gpu' in navigator` | `navigator-gpu` |
| 2 | `requestAdapter({ powerPreference: 'high-performance' })` non-null, called a second time when the first returns `null` | `adapter` |
| 3 | `!adapter.info.isFallbackAdapter` | `fallback-adapter-only` |
| 4 | `typeof VideoFrame === 'function'`, `typeof VideoDecoder === 'function'` | `video-frame`, `video-decoder` |
| 5 | `offscreen.getContext('webgpu')` non-null | `canvas-webgpu` |
| 6 | a 2x2 I420 `VideoFrame` copied with `copyExternalImageToTexture` inside a `validation` scope pops `null` | `video-frame-copy` |

Check 2 retries once because a fresh renderer can return `null` first and a real adapter second (4 of 4 in a headless flagged rig; the first call succeeded in rig w and in X11 Vulkan). Only `adapter.info.isFallbackAdapter` exists in Chrome 152.

The unsupported screen text, with the capability substituted:

> cadence-editor needs WebGPU and WebCodecs in a worker, and this browser did not provide `{capability}` ({detail}).
> Chrome 152 or newer is the tested browser. On Linux, WebGPU is on by default on Wayland with an NVIDIA driver from 2024-05 or later, and on Intel Gen12 or newer, with no flags. The Vulkan flags are for X11 only: there, start Chrome with `--ozone-platform=x11 --use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE` (X11 has no hardware video decode, so HEVC sources need a transcode). Do not add those flags on Wayland: there they switch off hardware video decode, and with it HEVC. Headless Chrome without flags has no adapter. Firefox on Linux and Safari before 26 are not supported.

**Adapter and device.** On banou-pc default and `high-performance` return the RTX 5090 (`nvidia` / `blackwell`) and `low-power` returns the AMD iGPU, so `low-power` is never passed. `requestDevice` requires the subset of `['timestamp-query']` the adapter offers (recorded, unused). No `float32-filterable` (motion is read with `textureLoad`), no `texture-formats-tier1` (10-bit planes use core `r16uint`). The NVIDIA adapter lacks `shader-f16`, so all WGSL stays `f32`. No `requiredLimits`: 3840x2160 fits the default 8192 and a 4K readback fits `maxBufferSize`. `adapter.info` `{ vendor, architecture }` goes into `ready`; `device` and `description` are empty without a developer flag. `uncapturederror` is logged, never relied on.

**Formats.**
- Frame payloads: `rgba16float`, usage `TEXTURE_BINDING | STORAGE_BINDING | COPY_DST | COPY_SRC | RENDER_ATTACHMENT` (ingest needs `COPY_DST | RENDER_ATTACHMENT`, measured; kernels write through `texture_storage_2d<rgba16float, write>`; bake and readback need `COPY_SRC`). Signed deltas are stored as-is (-0.5 survives, measured).
- Motion payloads: `rg32float`, `TEXTURE_BINDING | STORAGE_BINDING | COPY_SRC | COPY_DST` (`COPY_DST` because the synthetic field is written with `writeTexture`, as any CPU-uploaded flow will be).
- Bake frames: `rgba8unorm`, `RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC`.
- Canvas: `getPreferredCanvasFormat()` (`rgba8unorm` on Linux, measured), `alphaMode: 'opaque'`, alpha written as 1.

**Pipelines** (`gpu/pipelines.ts`): `Map<string, Promise<GPUComputePipeline | GPURenderPipeline>>` keyed by `${type}@${kernelVersion}` (plus the canvas format for render pipelines), built with the async creators and `layout: 'auto'`. Uniform and storage buffers whose size does not depend on the frame are allocated once here (rule 10) and written with `queue.writeBuffer` per step, which is safe because the run lock admits one run at a time and `writeBuffer` is ordered on the queue timeline. A `GPUPipelineError` at warm-up posts `unsupported` with `detail` naming the shader: a shader that does not compile on the owner's driver is a fail-loudly case.

**Presenting** (`gpu/present.ts`). `present(held)` gets `context.getCurrentTexture()` in the same task, runs the payload port's renderer into its view, submits, then releases what it replaced (rule 8). A `run-done` present happens in the task that receives the outcome (a `setTimeout`-free path reaches the placeholder, measured). The bake player uses worker `requestAnimationFrame`, and while it plays the runtime does not present inspect results.

**Preview renderer registry** (`gpu/preview/registry.ts`):

```ts
export type ViewParams = { deltaRange: number }

export type PreviewRenderer = {
  warm: (device: GPUDevice, canvasFormat: GPUTextureFormat) => Promise<void>
  draw: (encoder: GPUCommandEncoder, target: GPUTextureView, payload: Payload<GPUTexture>, view: ViewParams) => void
}

export const PREVIEWS: Record<PortType, PreviewRenderer> = { frame, motion, regions: stub('regions'), scalar: stub('scalar') }
```

- `frame`: the measured fullscreen triangle with aspect-fit scale and `textureSampleLevel`, plus a uniform `remap: { scale, offset }`: `(1, 0)` for `range: 'unit'`, `(0.5 / deltaRange, 0.5)` for `range: 'signed'`, so a zero delta is mid-grey wherever it came from (Blur of a delta stays signed).
- `motion`: HSV (hue = direction, value = magnitude, zero = black), a fragment shader reading `rg32float` with `textureLoad` and `maxRad` from a uniform. Middlebury is a later mode (brief change 22).
- `regions`, `scalar`: clear to the pane colour; the scalar value rides in `run-done` and the UI overlays it; regions get a "no renderer yet" overlay.

**Exercising the motion renderer.** No node outputs `motion` in milestone 1, so the development "Test flow wheel" button sends `preview-test { port: 'motion' }`: the presenter allocates a synthetic `rg32float` texture into its slot, writes a radial field `(u, v) = (x - cx, y - cy) / (w / 4)` with `writeTexture` (`gpu/preview/synthetic.ts`) and presents it: the HSV wheel, red pointing right, black centre. `preview-test { port: 'frame' }` presents a synthetic gradient, so the presenter can be checked before any video loads.

## 10. Video

**Parsing, moov only** (`video/mp4-index.ts`). `createFile()` with its default discards `mdat` data, which is what lazy reading wants: `getTrackSamplesInfo` still returns the complete table, and chunk bytes come from `File.slice`. Nothing calls `setExtractionOptions` (with the default it silently yields 0 samples). mp4box 2.4.1 ships only `.mjs`/`.cjs`, so the worker is a module worker and resolution is `exports`-aware (`moduleResolution: "bundler"`). Feed 1 MiB slices through `MP4BoxBuffer.fromArrayBuffer(buf, pos)`; `appendBuffer` returns the next position, which jumps past `mdat` when moov is at the end (21,566 bytes read of 352 KB, measured). Stop the moment `onReady` fires, not when the returned offset runs out (with faststart it points into `mdat`). `onError` maps to `not-mp4`; `info.videoTracks[0]` or `no-video-track`.

**Decoder description.** Find the `trak` in `moov.traks` whose `tkhd.track_id` equals the chosen track's `id` (its position in `videoTracks` is not its position in `traks` when an audio track comes first), take `avcC` or `hvcC` from `mdia.minf.stbl.stsd.entries[0]`, and slice the File at `[box.start + box.hdr_size, box.start + box.size)`. `start` and `hdr_size` are typed optional; a missing one is `not-mp4`. Never write the box back out (`hvcC.write` corrupts reserved bits). AV1 and VP9 take no description.

**Sample table** (`video/sample-table.ts`, pure):

```ts
/** The subset of mp4box's Sample the builder reads, so tests build tables without mp4box. */
export type SampleLike = { number: number; dts: number; cts: number; offset: number; size: number; is_sync: boolean }
export type EditLike = { media_time: number }

export type SampleTable = {
  /** Samples in decode order, shown or not. */
  count: number
  timescale: number
  cts: Float64Array
  offset: Float64Array
  size: Uint32Array
  isSync: Uint8Array
  /** Presentable frames only: decode index of presentation rank p. */
  decodeAt: Uint32Array
  /** Presentation rank of decode index d, or -1 for a sample that is decoded but never shown. */
  rankOf: Int32Array
  frames: number
  editMediaTime: number
}

export type SessionState = { fedThrough: number; emitted: number; needsKey: boolean }

export const buildSampleTable = (samples: readonly SampleLike[], timescale: number, edits: readonly EditLike[]): SampleTable | { error: 'empty' | 'first-sample-not-sync' }
export const startSample = (t: SampleTable, rank: number, refusedKeys: ReadonlySet<number>): number
export const seekDecision = (t: SampleTable, s: SessionState, rank: number, refusedKeys: ReadonlySet<number>, reseekChunks: number): 'forward' | 'reseek'
export const reseekCostMs = (t: SampleTable, rank: number, refusedKeys: ReadonlySet<number>, costs: PathCosts, lag: number): number
export const displayRate = (t: SampleTable): { num: number; den: number }
```

- **Presentable samples.** `editMediaTime` is the `media_time` of the first non-empty edit (an empty edit has `media_time` -1), else the first cts. A sample is presentable when its cts is at least both the first sync sample's cts and `editMediaTime`. So the RASL pictures a stream-copied cut starts with, and pre-roll hidden by an edit list, are decoded when a run needs them but never become frames, which keeps frame numbers equal to ffmpeg's `select=eq(n,k)` numbering. `decodeAt` sorts presentable samples by `(cts, number)`; `rankOf` is its inverse. Frame identity is this rank: the remux jitter never enters. Display time is `(cts - editMediaTime) / timescale`. mp4box does not apply edit lists (measured: first cts 1328 with `media_time` 1328); ffmpeg remuxes of whole files hide nothing.
- **`startSample(t, rank, refused)`**: `N = decodeAt[rank]`; scan `d` from `N` down and return the first `d` with `isSync[d]`, `d` not refused, and `cts[d] <= cts[N]`. A leading picture of the nearest CRA steps back one GOP by construction. The function is total: sample 0 must be sync (else the table is rejected) and every presentable cts is at least `cts[0]`.
- **`seekDecision`**: `'reseek'` when the session is unprimed (`fedThrough < 0`), `needsKey` is set (after a flush), or `rank <= emitted` (that frame already came out and was not kept). Otherwise `skipped = startSample - (fedThrough + 1)` and `'forward'` exactly when `skipped <= reseekChunks`. This is the whole cost comparison: the chunks from the start sample to the target are decoded either way, so only the skipped chunks weigh against the reseek overhead. Positions are decode indices, never presentation distance.
- **`reseekCostMs`** = `overheadMs + perChunkMs * (decodeAt[rank] - startSample + 1 + lag)`. It decides whether a reseek keeps look-behind frames, and it is why a backwards step can cost far more than the fixed overhead: a software target 240 chunks into a keyint-250 GOP is about 175 ms, and a hardware one 610 to 810 ms at 720p. RECALLED: x264 and x265 default to keyint 250; the owner's files are not probed (16c prints their spacing).
- **`displayRate`**: the mean duration `(last presentable cts - first) / (frames - 1)`, snapped within 0.1% to 24000/1001, 24, 25, 30000/1001, 30, 50, 60000/1001 or 60, else the exact reduced ratio. A remuxed MKV carries no nominal rate, and its jittered durations do not average to exactly 24000/1001.

**Codec support** (`video/codec-support.ts`, pure, `isConfigSupported` injected). Ask `prefer-software`, then `prefer-hardware`; never `no-preference`, which leaves the path to Chrome. Software wins when available (every measured Chrome offers it for AVC, AV1 and VP9); hardware is taken only when software is refused, which in the owner's Chrome means HEVC (accepted, decision 1). Neither: `unsupported-codec` with `hint`: for `hvc1`/`hev1`, "This Chrome has no HEVC decoder: Chrome on Linux has no software HEVC decoder, and hardware HEVC needs VA-API with the VaapiOnNvidiaGPUs feature on Wayland. Transcode once: ffmpeg -i in.mkv -map 0:v:0 -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -movflags +faststart out.mp4"; for other codecs, the remux command. The hardware warning reads: "Hardware decoder: colours use the BT.601 matrix (about 7 of 255 off for this BT.709 source), 8 bits only, and each backwards step costs about 250 ms plus decoding from the previous keyframe. Frames from this source are not comparable with software-decoded sources."

```ts
/** Per-path decoder costs from rig w, Chrome 152, 720p single runs (2026-09-14). S11 re-measures them at 1080p. */
export type PathCosts = {
  /** Reset plus configure, before any chunk is decoded. */
  overheadMs: number
  perChunkMs: number
  /** Chunks a forward feed may skip before a reseek is cheaper: overheadMs / perChunkMs. */
  reseekChunks: number
  /** Initial chunks fed past the target's decode index before a flush drains it; raised by the observed lag. */
  reorderSlack: number
  /** No output and no dequeue for this long while work is pending is a stall. */
  stallMs: number
  /** Presentable frames after the target that are kept from the same decode run. */
  ahead: number
  /** Frames before the target kept after a reseek whose cost for the previous frame exceeds keepBehindAboveMs. */
  behind: number
  keepBehindAboveMs: number
}

export const PATH_COSTS: Record<DecoderPath, PathCosts> = {
  software: { overheadMs: 4, perChunkMs: 0.7, reseekChunks: 6, reorderSlack: 8, stallMs: 1_000, ahead: 4, behind: 8, keepBehindAboveMs: 30 },
  hardware: { overheadMs: 250, perChunkMs: 2, reseekChunks: 120, reorderSlack: 8, stallMs: 2_000, ahead: 4, behind: 8, keepBehindAboveMs: 30 },
}

/** The path a decoded frame's format implies, or null for a format no measurement has classified. */
export const pathOfFormat = (format: VideoPixelFormat | null): DecoderPath | null
```

| constant | basis (rig w, 720p) |
| --- | --- |
| `overheadMs` | reset plus configure to first output: 3.9 ms software, 252 to 253 ms hardware; `flush()` and a new decoder cost the same on hardware |
| `perChunkMs` | a warm 24-chunk software GOP in 17 ms; hardware H.264 target after 6 chunks at 14 ms, HEVC Main10 after 11 chunks at 16 ms |
| `reseekChunks` | overhead over per-chunk cost: about 6 software, 110 to 170 hardware |
| `reorderSlack` | first output after 4 chunks (software H.264), 3 (hardware H.264), 5 (hardware HEVC Main10), measured with a 40 ms wait per chunk; unpaced feeding and FFmpeg frame threading can hold more (RECALLED), so exhausting the slack flushes rather than fails, and the observed lag raises it |
| `stallMs` | several times the cold first output (4 to 7 ms software, 200 to 270 ms hardware) |
| `ahead` | the 3 to 5 chunk lag leaves up to about 4 frames after the target in flight; each costs one copy (1.0 to 3.8 ms at 720p) and 15.8 MiB at 1080p |
| `behind`, `keepBehindAboveMs` | every hardware reseek and a software reseek deep into a long GOP cost well over 30 ms; a software reseek into a 48-frame GOP does not, so no frames are kept there |

`pathOfFormat` classifies what was measured: `I420` and `I420P10` are software, `BGRX` and `null` hardware, anything else `null` (logged, never failed). The first frame of every decoder instance goes through it; a classified path that differs from `SourceInfo.decoder` fails the source with `path-mismatch`, because `hardwareAcceleration` is a hint Chrome may ignore.

**Decoder session** (`video/decoder-session.ts`). The `VideoDecoder` constructor and a `ChunkReader = (offset, size) => Promise<ArrayBuffer>` are injected, so the session is unit-tested with a fake decoder. Chunk timestamps are the presentation rank (`timestamp: rankOf[d]`, `duration: 1`), and a sample that is never shown gets the unique negative timestamp `-(d + 1)`; `frame.timestamp` came back exact in presentation order on every path measured. The session configures with its path's `hardwareAcceleration` every time.

State: `decoder`, `generation`, `fedThrough`, `emitted`, `needsKey`, `refusedKeys`, `observedLag`, `waiters: Map<rank, Set<Waiter>>` where each waiter carries its own signal, and `feeder`, the one feed loop's promise.

`request(rank, waiter)`:

1. Register the waiter. Its signal's abort rejects and removes that waiter only; when the last waiter goes, `generation` is bumped.
2. Await `feeder` (the previous loop exits after at most one chunk read, step 4), then start this request's loop as the new `feeder`.
3. If `seekDecision` says `'reseek'`: `decoder.reset()`, `configure(config)`, `needsKey = true`, `fedThrough = startSample - 1`, `emitted = -1`, `generation += 1`, `reseeks += 1`, and record the reseek's start rank and estimated cost for the frame source's look-behind window.
4. Feed in decode order. After every await (the chunk read, a `dequeue` wait) the loop exits at once if `generation` changed or its rank has no live waiter, before touching the decoder. `decode()` a `key` chunk for a sync sample: if that throws `DataError` synchronously right after configure, the sample joins `refusedKeys` and the loop reseeks from the previous sync sample (sample 0 refused is `key-refused`). Await `dequeue` while `decodeQueueSize > 4`. Stop when the rank resolves.
5. At `decodeAt[rank] + reorderSlack` without the rank, or at the last sample: `await flush()` (`flushes += 1`, `needsKey = true`), which is guaranteed to drain; if the rank still has not come out, its waiters reject with `not-output`. Frames the flush drains flow into the frame source's windows like any other. `flush()` is called nowhere else.
6. **Progress watchdog**, independent of the loop's phase: while work is pending (fed chunks not yet matched by outputs, or a `dequeue` wait), `stallMs` with no output and no `dequeue` rejects the waiters with `stalled` and closes the decoder. This is what catches a hardware decoder whose output pool silently stalled, including one blocked behind the `dequeue` gate.
7. The output callback counts `framesOut`, updates `emitted`, `observedLag` (`fedThrough - decodeAt[rank]` at output, which raises `reorderSlack` for the session when it exceeds it) and the watchdog clock, and hands the frame to the frame source, which owns it from that moment.
8. The `error` callback rejects every waiter with `decode-error` (`QuotaExceededError` reclamation maps to `reclaimed`). The next request calls `close()` on the old decoder, then constructs a new one on the same path. A `decode-error` is remembered against its start sample, and later requests that need the same start sample fail at once instead of retrying (deterministic failures replay identically). If `isConfigSupported` no longer reports the source's path (Chromium stops offering hardware decode after three GPU process crashes), the source fails with `path-unavailable` rather than switching paths.

**Frame source** (`video/frame-source.ts`):

```ts
export type FrameSource = {
  /** Resolves with a frame texture adopted into `scope`. */
  frameAt: (rank: number, scope: StepScope<GPUTexture>) => Promise<FramePayload<GPUTexture>>
  close: () => void
  counters: () => { framesOut: number; framesClosed: number; framesHeld: number }
}

export type FrameSourceDeps = {
  session: DecoderSession
  table: SampleTable
  costs: PathCosts
  keyOf: (rank: number) => CacheKey
  has: (key: CacheKey) => boolean
  peekTexture: (key: CacheKey) => GPUTexture | null
  allocFrame: (width: number, height: number, speculative: boolean) => Promise<GPUTexture | null>
  release: (tex: GPUTexture) => void
  offer: (key: CacheKey, payload: FramePayload<GPUTexture>) => PutResult
  ingest: (frame: VideoFrame, dst: GPUTexture) => void
  copy: (src: GPUTexture, dst: GPUTexture) => void
}
```

`keyOf(rank)` is VideoSource's output key for that source and instant, so a speculative frame lands under exactly the key the planner computes. If the rank's key is already cached when `frameAt` is called (a speculative frame landed between the executor's re-check and the call), it copies the pinned cached texture into a new texture with `copyTextureToTexture` instead of decoding. Otherwise it requests the rank from the session. Every output frame `r` then goes through one decision, inside `try { ... } finally { frame.close() }` that spans the allocation await:

- `r` has live waiters: allocate with retry, ingest, and adopt into the waiting step's scope as the wait resolves (several waiters on one rank get GPU copies of the first).
- else `r` lies in `(w, w + ahead]`, where `w` is the latest requested rank: speculative.
- else `r` lies in `[max(w - behind, rankOf[start sample]), w)` and the last reseek's estimated cost for `w - 1` exceeds `keepBehindAboveMs`: speculative. The lower bound excludes leading pictures of the start sample, which an open-GOP H.264 decode may output wrongly (RECALLED) and which would otherwise be cached under a permanent content key.
- else: close without ingest.

Speculative means: skip when `has(keyOf(r))`, allocate without retry (null drops the frame), ingest, `offer`. If a waiter aborts during the allocation await, the frame is re-decided when the allocation resolves: offered if it is in a window, released otherwise. A reset, an error, `close()` (source unloaded) or device loss rejects waiters and releases every texture still awaiting ingest; frames are always closed by the `finally`. `framesClosed` counts closes and `framesHeld` counts frames between the callback and the close, so `framesOut === framesClosed + framesHeld` at every moment and `framesHeld === 0` at rest.

**Ingest as a swappable unit** (`video/ingest.ts`):

```ts
export type Ingest = {
  /** Pixel formats this path handles; the frame source picks the first matching entry. */
  accepts: (format: VideoPixelFormat | null) => boolean
  upload: (device: GPUDevice, frame: VideoFrame, dst: GPUTexture) => void
}

export const ingest8: Ingest = {
  accepts: () => true,
  upload: (device, frame, dst) =>
    device.queue.copyExternalImageToTexture({ source: frame }, { texture: dst, colorSpace: 'srgb' }, [frame.displayWidth, frame.displayHeight]),
}
```

The copy captures the source when issued (measured), so the `finally` may close the frame right after `upload`. `ingest10` (milestone 2, decision 1) accepts `I420P10`/`I420P12`, copies the visible rect with `frame.copyTo` into three `r16uint` plane textures and dispatches the verified `yuv10.wgsl` into the same `rgba16float` destination; it serves software 10-bit frames only, since hardware 10-bit frames have `format: null` and fall through to `ingest8`. Milestone 1 ships `[ingest8]` and logs a warning when an `I420P10` frame arrives. `ingest8` on a hardware frame inherits the BT.601 matrix error; its correction belongs in `@banou/ponyfill` and would slot in here.

## 11. Preview modes

**Inspect.** The target is derived: the selected node through `resolveTarget` (an Output node shows its input's upstream; a multi-output node shows the port picked in the preview header, default the first). In Inspect mode any change to `(doc, selected, outputPort, frame)` posts `inspect` with a new request id; the executor coalesces. Scrubbing is the timeline's range input on every `input` event; stepping is `,` and `.` or the arrow buttons. While computing, the previous image stays and the header shows "computing" with the running node's name; `run-done` swaps the image; `run-error` shows the typed error over the last good image. Selecting nothing shows the last Output.

**Bake.** The timeline exposes an inclusive range, capped by `fitsFrames(bakeBudgetBytes, width, height) = floor(bakeBudgetBytes / (width * height * 4))` (`worker/bake-math.ts`: 129 at 1080p, 32 at 4K for 1 GiB); a range that does not fit is refused with `bake-refused { fits }` before any work. Per frame, in order: `executor.run` under the bake's signal, which returns the target's lease; allocate an `rgba8unorm` texture in the bake store; render the leased payload through its preview renderer; submit; await `onSubmittedWorkDone()`; release the lease; post `bake-progress`. Cancel lands between frames and at the executor's cancellation points; a cancelled bake keeps its finished frames and reports `bake-done` with the count. Playback runs in the worker: `bake-play` starts a `requestAnimationFrame` loop that presents the next stored frame every `1000 * fps.den / fps.num` ms of accumulated time (41.708 ms at 24000/1001) and posts `bake-frame`; the store keeps that position in `bake.position`, a field the inspect subscription does not read, and inspect is paused in Bake mode, so playback never triggers runs. `bake-show` presents one frame. `bake-release` follows rule 9. Intermediates a bake produces are ordinary cache entries, so a later inspect at a baked frame is mostly hits; baked textures are never evicted by node-cache pressure. The store marks a bake stale when the target's key at its first frame, recomputed with planning pass 1, differs from the one recorded at bake time; a stale bake still plays until released.

## 12. React shell

**Layout.** `App` is a CSS grid, `grid-template-columns: var(--left-width) 6px minmax(0, 1fr)`. `Divider` uses pointer capture, writes `--left-width` directly on `pointermove` (no React state on the hot path), clamps between 280 px and `width - 320`, sets `user-select: none` and `cursor: col-resize` on `body` while dragging, and stores the width in `localStorage` on `pointerup`.

**Store** (`ui/store.ts`, zustand 5 `create<State>()(subscribeWithSelector(...))`):

```ts
export type State = {
  doc: GraphDocument
  flowNodes: FlowNode[]
  flowEdges: FlowEdge[]
  selected: NodeId | null
  outputPort: string | null
  frame: FrameIndex
  mode: 'inspect' | 'bake'
  source: SourceInfo | null
  statuses: Record<NodeId, { status: NodeStatus; ms?: number; request: RequestId }>
  run: { request: RequestId; state: 'idle' | 'computing' | 'error'; error?: RunError }
  bake: BakeState
  view: { deltaRange: number }
  budgetBytes: number
  gpu: { state: 'starting' } | { state: 'ready'; adapter: string } | { state: 'unsupported'; capability: MissingCapability; detail: string } | { state: 'lost'; message: string }
}

export type FlowNode = Node<{ nodeType: NodeTypeName }, NodeTypeName>
export type FlowEdge = Edge
```

Actions live in `ui/graph-actions.ts` as pure transitions over `{ doc, flowNodes, flowEdges }` that import engine code and xyflow types only, so they are unit-tested in node without loading `@xyflow/react`; `store.ts` binds them and is the only file that calls `applyNodeChanges`. The document is the truth for structure and params; `flowNodes` holds only what xyflow needs (`id`, `type`, `position`, `data: { nodeType }`, plus what xyflow writes back: `measured`, `selected`, `dragging`).

- **Node changes.** `onNodesChange` passes position, select and dimension changes to `applyNodeChanges`, which copies only changed elements, so unchanged nodes keep their identity and do not re-render; `remove` changes go through `removeNodes` on the document first. `data` never changes after creation.
- **Edge changes.** `onEdgesChange` applies only `select` and `remove` (the latter through `disconnect`); `add` and `replace` changes are refused and logged, because every edge enters through `onConnect`, which runs `validateConnection`, edits the document and replaces the flow edge with the same id. `edgesReconnectable={false}`, so every edge edit goes through the store.
- **Subscriptions** outside React: `doc` posts `set-graph`; `(doc, selected, outputPort, frame)` posts `inspect` while `mode` is `inspect`. `node-status` events are buffered and flushed into `statuses` once per animation frame, and events for requests older than `run.request` are dropped (6.8).

**Node components.** Each `nodes/*/view.tsx` is `memo((props: NodeProps<FlowNode>) => ...)` rendering `NodeShell`: the header (label, status badge, issue time), the param controls in the body, and one `<Handle>` per port (`type="target"` left for inputs, `type="source"` right for outputs, `id={handleId(...)}`, `top: calc(${index + 1} * 22px)`, `style={{ '--port': PORT_TABLE[type].colour }}`). Params are read with `useGraph(useShallow((s) => s.doc.nodes[id]?.params))`, so a param edit re-renders only that node. Controls carry `nodrag` (and `nowheel` on ranges): xyflow does not exempt inputs from dragging. No element in a node body uses the class `source` or `target` (xyflow measures those as handles). `nodeTypes`, `isValidConnection` and every handler are module-level or `useCallback`-stable; `connectionMode` stays `strict`. xyflow puts `invalid` only on the connection line, so the `<Global>` styles in `ui/theme.ts` target `.react-flow__handle.connectingto:not(.valid)` (red) and `.react-flow__connection.invalid path` (red stroke). Every component's own styles are colocated Emotion `css` templates, and a handle takes its colour from the `--port` custom property. No node draws an image. Dimming incompatible handles while dragging (`useConnection()` in `NodeShell`) is done last.

**Palette** (`ui/palette.tsx`). One draggable entry per node type, setting `dataTransfer.setData('application/x-cadence-node', type)`. The `ReactFlow` wrapper's `onDragOver` calls `preventDefault`; `onDrop` reads the type, converts the drop point with `screenToFlowPosition({ x: event.clientX, y: event.clientY })`, and calls `addNode`, which fills params from the schema defaults (a VideoSource gets the loaded source id when exactly one is loaded) and appends one flow node at that position.

**File loading.** `FileLoader` is a file input accepting `video/mp4` plus a drop zone on the preview pane: it builds the `SourceId`, posts `load-source`, and on `source-loaded` sets `source`, resets `frame` to 0, and adds a VideoSource if the graph has none.

**Timeline.** Below the preview: a range input (0 to `frames - 1`), a number input, step buttons, the display time, the Inspect/Bake toggle, and in Bake mode the range inputs, "fits N frames", Run, Cancel, progress and play/pause. Disabled with a hint until a source is loaded. Development builds add the stats readout (with the budget control) and the "Check frame" and "Test flow wheel" buttons.

**Unsupported screen.** `Unsupported` replaces both panes when `gpu.state` is `unsupported` or `lost`, with the section 9 text, the detail, and a reload button for `lost`.

## 13. The five nodes

Every GPU kernel is built with `defineKernel(spec, run)`, dispatches `ceil(w / 16), ceil(h / 16)` workgroups of `@workgroup_size(16, 16)` with a bounds check inside, allocates its outputs through `ctx.alloc`, encodes one command encoder, and awaits `ctx.submit` once. WGSL struct names never equal a variable name (WGSL has one module-scope namespace, and a clash would fail warm-up and put the whole app on the unsupported screen): `struct Params` with `var<uniform> P: Params`.

**VideoSource.** No inputs, `out:frame:frame`. Params: `source: { kind: 'source' }`. `timeDependent: true`, `kernelVersion: 1`. Kernel: `ctx.frames.frameAt(time)` (the runner binds it to the step's scope) returns an owned `rgba16float` payload of the frame's display size with `range: 'unit'`. A `time` outside `[0, frames)` fails with `kernel` "frame out of range", which is how FrameDelta reports itself at the last frame.

**Grayscale.** `in:frame:in`, `out:frame:out`. Params: `weights: enum('bt709', 'average')`, default `bt709`. Output range equals input range.

```wgsl
struct Params { mode: u32, _p0: u32, _p1: u32, _p2: u32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> P: Params;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (any(p >= vec2i(textureDimensions(dst)))) { return; }
  let c = textureLoad(src, p, 0).rgb;
  let y = select(dot(c, vec3f(0.2126, 0.7152, 0.0722)), (c.r + c.g + c.b) / 3.0, P.mode == 1u);
  textureStore(dst, p, vec4f(y, y, y, 1.0));
}
```

**Blur.** `in:frame:in`, `out:frame:out`. Params: `radius: int(0..64, default 6)`, `sigma: float(0.1..32, step 0.1, default 2)`. Kernel: the measured separable Gaussian (`struct BlurParams` with `var<uniform> P: BlurParams`): two passes through a `mid` texture from `ctx.alloc`, weights `exp(-i²/2σ²)` normalised in JS into a fixed 65-entry storage buffer, and two fixed uniform buffers for `dir (1,0)` and `(0,1)`, because both passes share one submit and a single uniform buffer cannot change between them. `radius = 0` is one `copyTextureToTexture` into the output. Output range equals input range. Measured 2.1 to 2.4 ms at 4K, radius 8. `sigma` exercises the bit-pattern canonicalisation in the key.

**FrameDelta.** `in:frame:a`, `in:frame:b` with `demand: (p) => ({ offset: Number(p.offset) })`, `out:frame:delta`, and `out:scalar:mean` (decision 5). Params: `offset: int(-8..8, default 1)`, `absolute: bool(default false)`. Delta pass: `textureStore(dst, p, vec4f(select(d, abs(d), P.abs == 1u), 1.0))` with `d = (textureLoad(a, p, 0) - textureLoad(b, p, 0)).rgb`; output range `signed`, or `unit` when `absolute`. Mismatched input sizes fail with a `kernel` error naming both. The mean pass (`frame-delta-mean.wgsl`) runs in the same submit with `@workgroup_size(1, 1)` dispatched once per 16x16 block: each invocation loops over its own block and writes one `f32` (mean absolute BT.709 luma delta) into its own element of a storage buffer from `ctx.allocBuffer`, so no two invocations write the same element; the buffer is copied into a `MAP_READ` buffer in that submit, and after it the kernel awaits `mapAsync`, averages the blocks weighted by their pixel counts, and unmaps. Both buffers are released by the step scope. The scalar payload is `{ port: 'scalar', value, bytes: 0 }`. Wiring VideoSource to both `a` and `b` with `offset = 1` produces frame N minus frame N+1 from one source node.

**Output.** `in:frame:in`, no outputs, no params, no kernel: `resolveTarget` maps it to its upstream output. It is the terminal the timeline and bake default to.

`nodes/specs.ts` exports `SPECS: Record<NodeTypeName, NodeSpec>`; `worker/kernels.ts` exports `KERNELS: Record<Exclude<NodeTypeName, 'output'>, Kernel>`. A kernel's type and version come from its spec, so they cannot disagree.

## 14. Tests

All under `tests/`, mirroring `src/`, run in node by `vp test run`. Each line says what it proves and how broken code fails it. Fakes: `tests/fixtures/fake-gpu.ts` (textures `{ id, destroyed }`, an allocator with a live set, a queue whose "work done" promise the test resolves) and `tests/fixtures/fake-decoder.ts` (configurable reorder lag, asynchronous outputs, the key requirement after configure and flush, `decodeQueueSize` with one request in flight, a RASL drop, error-then-closed, a silent stall mode, a refused key, counted frames).

**Engine**

1. `handle-id`: `parseHandleId(handleId(d, t, p))` round-trips over the cross product (`test.for`). Fails if formatter and parser disagree.
2. `handle-id`: rejects `null`, `undefined`, `''`, two- and four-part ids, unknown types, `-` in names, uppercase names.
3. `port-types`: `PORT_TABLE` has a row per `PORT_TYPES` member and `isPortType` accepts exactly those (the `satisfies` does not force the array to be complete).
4. `document`: `newNodeId` never contains `-`; `edgeId` is stable.
5. `document`: `connect` on an occupied input replaces the edge; `removeNode` drops incident edges. Fails if two edges share a target port.
6. `params`: `canonicalParams` follows schema order, not object order; `-0` and `0` differ; `2` and `2.0000001` differ; ints truncate; missing values take defaults; a `source` value is not clamped against any list.
7. `params`: `clampParam` refuses `NaN` and out-of-range values and snaps to `step`.
8. `validate`: accepts `frame -> frame`.
9. `validate`: `frame -> scalar` is `type-mismatch` carrying both types.
10. `validate`: a self-loop is `self-loop` (the strict-mode gap).
11. `validate`: `c -> a` on `a -> b -> c` is `cycle`; `a -> c` is accepted. Fails if reachability is walked from source to target, which accepts every cycle.
12. `validate`: swapped handles (`direction`), unknown nodes and ports, malformed handles; an xyflow `Edge` with `sourceHandle` undefined is accepted as a candidate and judged, never a type error.
13. `validate`: `replaces` names the occupied edge, else `null`.
14. `validate`: `validateDocument` reports a cycle already in a document.
15. `toposort`: every edge satisfies `index(source) < index(target)` over the fixture graphs.
16. `toposort`: two insertion orders give identical output.
17. `toposort`: a cycle yields the `cycle` variant.
18. `key`: changing a param, the kernel version, an input's output key, or the time of a time-dependent spec changes the node key; the time of a non-time-dependent spec does not.
19. `key`: source ids containing `|`, `:`, `@`, `,` and `"` produce distinct canonical strings where a separator-joined string would collide.
20. `key`: two consumers of different outputs of one node get different keys, and swapping which output an input reads changes its key. Fails if the output port is left out.
21. `key`, invalidation property: over a branching graph with a diamond, for every param edit, the set of nodes whose key changed equals the edited node plus its descendants, never a sibling branch or an ancestor.
22. `cache`: `put` beyond budget evicts least recently used first; `get` refreshes recency; evicted payloads are disposed exactly once.
23. `cache`: a pin placed before `put` protects the entry once stored; pinned entries survive any budget and `stats().bytes` shows the overshoot; unpinning makes them evictable.
24. `cache`: `put` returns `stored` for a new key and for the identical payload object, `duplicate` for another payload under a held key, `refused` after `close()`; `handOff` releases exactly the texture it did not store and never the stored one; bytes never double count.
25. `cache`: `setBudget` lower evicts with `budget-lowered`; `close()` clears through a no-op disposer.
26. `alloc-retry`: the second attempt starts only after `settle` resolves (a fake queue that fails until its done promise resolves; the test fails if the retry is issued before the await); `lowerBudget` receives the wanted bytes; a speculative attempt never retries; a second failure returns `null`.
27. `plan`: Output resolves to its upstream output; an unconnected Output, a missing input edge and an empty `source` yield `unconnected`.
28. `plan`, two passes: with Blur's output cached on `VideoSource -> Blur -> Grayscale -> Output`, the plan has one step (Grayscale) and one hit (Blur), VideoSource is `skipped` with no step and no pin although its key was computed; with VideoSource evicted and Blur cached the plan is the same.
29. `plan`: FrameDelta `offset = 1` plans VideoSource at `t` and `t + 1` with distinct keys; `offset = 0` plans one step; two VideoSource nodes on one source at one instant share one step listing both nodes.
30. `plan`, order property over the fixture graphs: every step's input keys are hits or outputs of an earlier step.
31. `plan`: a diamond's shared ancestor is planned once.
32. `executor`: after a full run every texture the fake allocator handed out is in the cache or destroyed (rule 14).
33. `executor`: changing Blur's radius emits `cached` for VideoSource and `done` for Blur and Grayscale, and VideoSource's kernel ran zero times. Fails if invalidation reaches upstream or misses downstream.
34. `executor`: a run aborted while a fake kernel that never releases anything is pending emits `cancelled`, stores nothing for that step, keeps earlier steps, and the live count returns to the cache's count. Fails without the executor's scope release, which a self-releasing fake could not show.
35. `executor`: a kernel that ignores the abort and resolves afterwards has its outputs stored, the run resolves `cancelled`, and nothing leaks.
36. `executor`: three quick inspects run the first and the third; the second resolves `cancelled` without running; a first kernel that ignores its abort and completes still resolves `cancelled` and its lease is released.
37. `executor`: plan keys are pinned during the run and unpinned after it, including on failure, except the target, held by the lease until `release()` (idempotent); a bake `run` and an inspect never overlap (the second run's first kernel call follows the first run's settle).
38. `executor`: a throwing kernel yields `failed` naming the node, later steps do not run; a fake `submit` that pops a GPU error yields RunError `gpu`, stores nothing, and the live count returns.
39. `executor`: an offer that stores a step's output key while earlier steps run turns that step into `cached` at the re-check; a kernel that offers under its own output key then returns a second texture has the duplicate released; the stored texture is never destroyed and the live count equals the cache count.
40. `executor`: a kernel that returns its borrowed input fails with `kernel`, and the input is not destroyed.
41. `executor`: with a budget of one frame, FrameDelta `offset = 1` succeeds: VideoSource at `t` is not evicted before FrameDelta binds it.

**Video**

42. `sample-table`: `decodeAt` and `rankOf` are inverse over presentable samples, ranks sort by `(cts, number)`, and non-presentable samples have `rankOf -1`.
43. `sample-table`, property over the tables `make-fixture.sh` dumped from real fixtures (16c) and the synthetic ones: for every rank the start sample is sync, its decode index and cts are at or before the target's, and no later sync sample satisfies both; on the synthetic open-GOP table a leading picture's start differs from the nearest-sync-in-decode-order answer.
44. `sample-table`: a RASL-prefixed table and an empty-edit `elst` table exclude the hidden samples from `frames`; a table whose sample 0 is not sync is rejected.
45. `seekDecision`: N to N+1 on a primed session is `forward`; `rank <= emitted`, unprimed and `needsKey` are `reseek`; a later GOP within the allowance is `forward`, beyond it `reseek`; one state differs between the software and hardware allowances; on the open-GOP table presentation 47 with `fedThrough` at decode 30 is `forward` because its start sample (22) is already fed; a refused key moves the start to the previous sync.
46. `reseekCostMs`: a software target deep in a 250-sample GOP exceeds `keepBehindAboveMs`, one near the start of a 48-sample GOP does not; every hardware reseek does.
47. `displayRate`: the jittered 672/656 table at timescale 16000 snaps to 24000/1001; a 23.5 fps table keeps its exact ratio.
48. `mp4-index`: the chunk loop stops on `onReady` even when `appendBuffer` returns a further offset (the faststart trap).
49. `mp4-index`: the description slice is `start + hdr_size` to `start + size`; the trak is found by `track_id` when an audio trak comes first; a box without `start` is `not-mp4`.
50. `codec-support`: `prefer-software` first, `prefer-hardware` second, never `no-preference` (the fake records calls); the rig w matrix (HEVC software false, hardware true) and the X11 matrix (HEVC false everywhere); `unsupported-codec` with the HEVC hint or the remux hint.
51. `codec-support`: `pathOfFormat` for `I420`, `I420P10`, `BGRX`, `null` and an unclassified `NV12`; the first-frame check fails a mismatched path and passes an unclassified one.
52. `decoder-session`: with lag 3 and an unpaced feed, requesting N then N+1 counts zero reseeks (N+1 comes from the look-ahead window or a forward feed). Fails when by-product frames are closed.
53. `decoder-session`: abort at each await point (chunk read, dequeue wait, flush) followed by a backwards request: the chunk sequence after the reset starts with a key chunk and contains no chunk from the old generation; aborting one of two waiters on a rank rejects only that one.
54. `decoder-session`: slack exhausted without the rank flushes and then delivers it; a flush that ends without it rejects with `not-output`; the observed lag raises the slack.
55. `decoder-session`: a silent stall while blocked on `dequeue` rejects with `stalled` within `stallMs`; after an error the next request calls `close()` then constructs a new decoder on the same path; a repeated `decode-error` on one start sample fails at once; a refused key chunk (synchronous `DataError`) restarts from the previous sync sample.
56. `decoder-session`: frames drained by the end-of-stream flush reach the frame source; the next request reseeks.
57. `frame-source`: with counted fake frames, `framesOut === framesClosed` after settling on every path: waiter served, waiter aborted during the allocation await, speculative allocation returning `null`, reset while frames wait on allocation, source closed, device lost; speculative frames skip cached keys and never go below the start sample's rank; a cached rank is served by a copy, not a decode.

**GPU-side pure helpers, protocol, nodes, UI actions**

58. `unpad`: rows at width 1001 (`bytesPerRow` 4004 padded to 4096) come back without padding. Fails at any width where `4 * width` is not a multiple of 256, which the 1920-wide fixture never hits.
59. `bake-math`: `fitsFrames(1 GiB)` is 129 at 1920x1080 and 32 at 3840x2160.
60. `protocol`: an exhaustive `switch` over `ToWorker`, `FromWorker` and the debug unions compiles with a `never` default (type-checked by `tsconfig.tests.json`), and a runtime tag list matches a `Record<Type, true>`.
61. `specs`: every port name and handle id parses; `SPECS` keys equal each spec's `type`; FrameDelta's demand returns its `offset` param.
62. `graph-actions`: `connect` refuses a cycle and a self-loop and leaves the document unchanged; a replacement keeps one edge per port; edge `add` and `replace` changes are refused; a node `remove` updates the document and keeps the identity of every unchanged flow node.

**Not unit-tested, and why.** WGSL kernels, preview renderers and presentation need a real GPU and compositor; the smoke run checks them in headed Chrome (16b). React components (brief). The mp4box parse of real bytes (the fixtures exercise it in 16b). Decoder timing and the `PATH_COSTS` numbers are Chromium's behaviour on this hardware; S11 reports them. Every one of those has a named step in section 16.

## 15. Build order

Each layer lands as one commit; `npm run typecheck && npm run test && npm run lint && npm run check:manifest` must exit 0 first (read the exit code, not the summary).

| # | layer | files | "working" means | commit |
| --- | --- | --- | --- | --- |
| 0 | scaffold | `package.json`, lockfile, `.npmrc`, tsconfigs, `vite.config.ts`, `.gitignore`, placeholder `src/main.tsx` | `vp dev` serves a page; `vp test run --passWithNoTests` exits 0 (the flag only on this command line, never in config, where it would let a broken `include` pass silently; from layer 1 the plain `npm run test` must report the expected test count); all four typecheck programs pass; the `check:manifest` control fails with the block and passes without it | `chore: 🎉scaffold vite-plus, react, xyflow and worker build` |
| 1 | engine | `src/engine/*`, `src/nodes/specs.ts`, `src/nodes/*/spec.ts`, `tests/engine/*`, `tests/nodes/*`, fixtures | tests 1 to 41 and 61 green; mutations turn their tests red (drop the self-loop line: 10; drop `kernelVersion` from the tuple: 18; skip the scope release: 34; plan without the second pass: 28); the typecheck control (`navigator.gpu` in `key.ts`) and the lint control (`react` in `plan.ts`) fail | `feat: ✨graph engine: ports, validation, keys, cache, executor` |
| 2 | protocol | `src/protocol.ts`, `src/protocol-debug.ts`, `src/ui/worker-client.ts`, `src/worker/index.ts` (echo), test 60 | the page creates the worker and transfers the canvas once under StrictMode (one `init` logged); a debug message round-trips | `feat: ✨typed worker protocol, client and canvas hand-off` |
| 3 | WebGPU | `src/gpu/*`, `src/worker/runtime.ts` (allocator, presenter, stats), `scripts/smoke.mjs` (rig, preflight), test 58 | in the owner's Chrome and in the smoke rig, `preview-test` shows the gradient and the HSV wheel, and divider resizes re-present; P1 to P3 pass; negative control: the same launcher with `--headless=new` fails P1, and the recorder sees `unsupported { capability: 'adapter' }` | `feat: ✨webgpu device, presenter and preview renderer registry` |
| 4 | video | `src/video/*`, `src/nodes/video-source/kernel.ts`, `src/worker/kernels.ts`, the executor and frame-source wiring in `runtime.ts`, `scripts/make-fixture.sh`, `scripts/read-index.mjs`, tests 42 to 57 | the fixture controls pass; the smoke script posts `load-source`, `set-graph` and `inspect` directly through `window.__cadence.post` (no UI yet) and S1 to S3 pass; S9 on the HEVC fixture | `feat: ✨mp4 index, decoder session and frame source` |
| 5 | shell | `src/ui/*`, `src/app.tsx`, `src/nodes/*/view.tsx`, test 62 | 16a steps 1 to 3, 5 to 7, 9, and 10 and 12 on VideoSource: nodes drag out of the palette, cycles and self-loops show red, selection and scrubbing drive the preview, badges update; smoke S5 green; the headless negative control now shows the unsupported screen naming `adapter` | `feat: ✨react shell: graph pane, preview pane, timeline` |
| 6 | nodes and bake | `src/nodes/*/kernel.ts`, `*.wgsl`, `src/worker/bake.ts`, `src/worker/bake-math.ts`, test 59 | all of 16a in the owner's Chrome and all of 16b green | `feat: ✨grayscale, blur, frame delta kernels and bake mode` |

The longest title is 61 characters. The engine commit precedes any GPU code, so the tests exist before anything that could leak does.

## 16. How the deliverable is verified end to end

Three parts. The manual script (16a) is the acceptance: it walks every clause of the brief's deliverable sentence in the owner's own Chrome. The smoke run (16b) is its repeatable subset, in the owner's own Chrome, headed on the owner's session. The fixtures (16c) let both fail: the frame index is burned into the pixels, so identity is read from the image, never from the timestamp the app assigned. Every assertion in 16b is paired with a control that must come out the other way.

### 16a. Manual acceptance script, in the owner's Chrome

Preconditions: `npm run fixture`, `npm run dev`, then `http://localhost:4560` in the owner's everyday Chrome on niri, started through the Nix wrapper with no extra flags. Port 4560 is shared with older projects' service workers; if another app answers, unregister its worker in DevTools, Application. The development build adds "Check frame" (posts `readback`, decodes the burned-in index with the same block reader as `scripts/read-index.mjs`, prints `burned index 47, timeline 47`), "Test flow wheel", and the stats readout.

| # | deliverable clause | action | expected |
| --- | --- | --- | --- |
| 1 | (the app runs) | open the page | no unsupported screen; the header reads `nvidia / blackwell`; "Test flow wheel" shows the HSV wheel (red to the right, black centre); the synthetic gradient presents; dragging the divider re-presents at the new size |
| 2 | load a local MP4 | choose `fixtures/index-h264.mp4` | the timeline enables with 240 frames and 23.976 fps; decoder badge `software`; a VideoSource node appears; frame 0 shows the test pattern with index blocks top left; Check frame reads 0 |
| 3 | load a local MP4 (a real one) | choose `fixtures/owner-avc.mp4` (16c) | the frame count equals the packet count 16c printed (less any samples the edit list hides, normally none); decoder `software`; the last frame shows a picture |
| 4 | (HEVC, decision 1) | choose `fixtures/index-hevc10.mp4` | decoder `hardware` with the warning in the header and on the node; Check frame reads 0, 47, 48 and 23; one step back right after a jump is immediate (look-behind); a jump back by 20 visibly takes at least a quarter second |
| 5 | drag out the five nodes | from the palette drag Grayscale, Blur, FrameDelta, Output and a second VideoSource | each node drops where released and shows its params in its body; dragging a Blur radius slider changes the value without moving the node; no node shows an image |
| 6 | wire them | VideoSource `frame` to Blur `in`, Blur `out` to Grayscale `in`, Grayscale `out` to Output `in` | each wire is accepted in the `frame` colour |
| 7 | connections that reject cycles | drag Grayscale `out` onto Blur `in`; then Blur `out` onto Blur `in` | both times the hovered handle and the connection line turn red and releasing creates no edge |
| 8 | connections that reject type mismatches | drag FrameDelta `mean` onto Blur `in` | red, no edge (also covered by test 9 and smoke S5) |
| 9 | (occupied input) | drag the second VideoSource `frame` onto Blur `in` | the previous edge on Blur `in` is replaced, never doubled |
| 10 | select any node and see its output | click VideoSource, Blur, Grayscale and Output in turn | raw, blurred, grey, and grey again (Output shows its upstream); the header names the target; Check frame reads the timeline's index each time |
| 11 | (the frame pair) | wire VideoSource to FrameDelta `a` and `b`, offset 1, select FrameDelta at frame 47 | mid-grey where nothing moves, light and dark where the pattern moves, and among the index blocks exactly bits 0 to 4 (where 47 and 48 differ) are light or dark; offset 0 turns the image mid-grey; the `mean` overlay is positive at offset 1 and 0 at offset 0 |
| 12 | scrub to any frame | drag the timeline end to end and back; type 47; press `.`, then `,`; type 10; type 239 | the image follows the drag and settles on the final position; Check frame equals the timeline at 47, 48, 47, 10 and 239; the forward step shows no computing delay and the readout's reseek count does not move on it |
| 13 | change a blur radius and watch only the downstream nodes recompute | chain VideoSource, Blur, Grayscale, Output at frame 47 with Output selected; drag Blur radius from 6 to 9; set Grayscale weights to `average`; select Blur | first change: VideoSource `cached`, Blur and Grayscale flash `running` and settle `done` with an issue time; second change: VideoSource `skipped` (dimmed), Blur `cached`, only Grayscale runs; selecting Blur: Blur `cached`, no node runs |
| 14 | (Bake, brief requirement 6) | Bake mode, range 0 to 47 on Output, Run, Play; Release; try 0 to 239; then 0 to 119, Run, Cancel after about 10 frames | progress reaches 48 of 48; playback loops at 23.976 fps with the timeline following; Check frame on a shown bake frame equals it; 0 to 239 is refused with "fits 129 frames"; the cancelled bake keeps between 10 and 119 frames |
| 15 | (no leak) | read the stats readout after step 14, and again after Release | `liveBytes` equals cache plus bake plus synthetic plus fixed bytes, scratch is 0, and frames out equals frames closed, at both points |

### 16b. Scripted smoke run, the owner's Chrome without a window

`npm run smoke` builds with `vp build --mode smoke --outDir build-smoke` (built bytes, because a cold dev server's dependency optimisation can reload the page mid-run) and runs `node scripts/smoke.mjs` from inside the repo (an ESM script resolves `playwright-core` from its own location). The smoke build exposes `window.__cadence` (`post` for raw protocol messages, the store's actions from layer 5 on, and a recorder of every worker message) and handles the debug messages. Results go to `build-smoke/smoke-results.json`.

**The rig: headed Chrome on the owner's session** (decision 6). A window opens on niri for the length of the run, and the script prints `smoke: opening a Chrome window for about N minutes` before it does.

1. Serve `build-smoke` with `python3 -m http.server --bind 127.0.0.1 <port> --directory build-smoke` (127.0.0.1 is a secure context).
2. Spawn `google-chrome-stable` (the Nix wrapper) with the session's own environment, so the wrapper adds its Wayland switches and `--enable-features=VaapiOnNvidiaGPUs` exactly as in everyday use, plus `--user-data-dir=<fresh mkdtemp>`, `--remote-debugging-port=0`, `--mute-audio`, `--no-first-run`, `--no-default-browser-check`, `--disable-sync`, `--disable-component-update`, `--password-store=basic`, `--window-size=1280,720`, `about:blank`. Never `--enable-unsafe-webgpu`, the Vulkan flags (on Wayland they remove hardware decode), `--no-sandbox` or `--headless`.
3. Read the port from `<profile>/DevToolsActivePort` and attach with `chromium.connectOverCDP` from `playwright-core`, never `chromium.launch` (it adds `--no-sandbox`, `--enable-unsafe-swiftshader` and its own switches). Every Playwright call has an explicit timeout.
4. Cleanup in `finally`: close CDP, SIGTERM then SIGKILL Chrome, stop the server, remove the profile, then check that `niri msg --json windows` lists no window whose pid's command line carries the run's `--user-data-dir`. Its control runs first: a fake window list naming a stand-in process with that profile must be flagged, and a normal-profile stand-in must not.
5. **No-window fallback, `SMOKE_RIG=weston`,** for runs while a window would be in the way: the same assertions under a nested headless weston (machine-measurement rig w, lesson "A rig that must match the owner's Chrome runs it under a nested headless weston"). `nix shell nixpkgs#weston --command weston --backend=headless --renderer=gl --socket=cadence-smoke-wl --width=1280 --height=720 --idle-time=0` (require `EGL vendor: NVIDIA` in its log), Chrome's environment without `DISPLAY` and with `WAYLAND_DISPLAY=cadence-smoke-wl` and `NIXOS_OZONE_WL=1`, and a launcher that refuses `wayland-1`.

**Preflight: the rig proves it is the owner's configuration before any app assertion.** A failure stops the run with "not the owner's configuration".

- **P1** In a worker, `requestAdapter()` with the app's retry returns `nvidia` / `blackwell`, not a fallback adapter.
- **P2** `VideoDecoder.isConfigSupported` for `hvc1.2.4.L153.B0` at 3840x2160 is true with `prefer-hardware` and false with `prefer-software`; `avc1.640028` at 1080p is true with `prefer-software`. Every X11 or headless rig reads false for the HEVC hardware case.
- **P3** After `preview-test { port: 'frame' }`, a page screenshot shows the gradient's known corner colours, and a 2D control canvas painted magenta beside it reads magenta, so a black screenshot cannot pass.

**App assertions.** Before layer 5, graphs are posted as documents through `__cadence.post`; from layer 5 on, through the store's actions.

- **S1, load.** `fixtures/index-h264.mp4` through `setInputFiles` (or `load-source` before layer 5): `source-loaded` has `frames: 240`, `decoder: 'software'`, a codec starting `avc1.64`.
- **S2, frame N and N+1 without a reseek.** Graph VideoSource to Output. Inspect 47, `readback`, read index 47. Inspect 48, read index 48, and `stats.decoder.reseeks` is unchanged. From the page's sample table the script records whether 47 is a leading picture decoded after the open-GOP I at 48; if so, this also exercises the start rule. Control: 16c's ffmpeg decode of frames 47 and 48 reads 47 and 48 with the same reader, and the reader throws on a buffer without its guard blocks.
- **S3, a backwards seek and any frame.** Inspect 10: index 10, `reseeks` up by exactly one. Then 8 frames drawn from 0 to 239 with a printed seed: each reads back its index.
- **S4, a blur radius change re-runs only downstream nodes.** Graph VideoSource, Blur (radius 6), Grayscale, Output; inspect 47 and wait for `run-done`. Set Blur's radius to 9. The new request's `node-status` events are exactly: `videoSource` `cached`; `blur` `running`, `done`; `grayscale` `running`, `done`; the readback still reads 47. Control: a frame no earlier step requested produces `running` and `done` for `videoSource`, proving the recorder sees a source run when there is one.
- **S5, rejections.** Grayscale `out` to Blur `in` returns `cycle`, Blur `out` to Blur `in` returns `self-loop`, and the document's edge count is unchanged; a valid replacement onto Blur `in` returns ok with `replaces` set; FrameDelta `mean` to Blur `in` returns `type-mismatch`.
- **S6, a non-zero FrameDelta.** Graph VideoSource to FrameDelta `a` and `b` (offset 1) to Output, frame 47, `deltaRange` 1: the readback's mean of `abs(v - 128)` is above 2. Control: offset 0 gives `abs(v - 128) <= 1` at every sampled point. Per-bit block values are reported, not asserted (decision 6).
- **S7, a bake that completes.** Bake 0 to 47 on the Grayscale output: `bake-progress` reaches 48 of 48, `bake-done` reports 48, and `bake-show 20` then `readback` reads 20.
- **S8, a bake that cancels.** `bake-release` S7's bake. Control: 0 to 239 answers `bake-refused` with `fits: 129`, proving a refusal is visible. Then bake 0 to 119, and once `bake-progress` reports 10, post `cancel`: `bake-done` reports at least 10 and fewer than 120 frames, and no `bake-progress` follows.
- **S9, the hardware HEVC path** (decision 1). Load `fixtures/index-hevc10.mp4`: `decoder: 'hardware'`. The second CRA and the last leading picture before it read back their indices. Inspect 100 then 99: 99 reads back with `reseeks` unchanged (look-behind). Inspect 79: `reseeks` up by one. Inspect 237, 238, 239 (the end-of-stream flush), then 100: all read back, which covers the flush-then-reseek pattern under which the owner once saw a hardware decoder return the first frame for every request.
- **S10, the allocator leak identity.** Control first: after `debug-leak` of 524,288 bytes (one 256x256 `rgba16float` texture) the identity is off by exactly that. Then drive the paths that could leak: `debug-delay { nodeType: 'blur', ms: 500 }` with an inspect, and a second inspect 100 ms later (a run aborted mid-kernel); FrameDelta at frame 239 with offset 1 (`run-error`, kernel "frame out of range"); `preview-test` twice, then an inspect; S9's look-behind frames. After things settle: `liveBytes === cacheBytes + bakeBytes + syntheticBytes + fixedBytes`, `scratchBytes === 0`, `framesOut === framesClosed` and `framesHeld === 0`. Again after `bake-release`, and after `set-budget 0`, when `cacheBytes` also equals the leased payload's bytes alone. Finally `set-budget` back to 2 GiB and assert it in `stats`.
- **S11, timings and colour, reported, not asserted.** Per path at 1080p: first output after load, a forward step, a 20-frame backwards step, output lag without a flush; on `fixtures/index-h264-gop250.mp4`, a backwards step at the start, middle and end of the GOP; frame 30's mean absolute error against both colour references on both paths. `PATH_COSTS` is re-derived from these, and a change in Chrome's hardware matrix shows up here first.

**Negative control for the rig.** The same launcher with `--headless=new` (no window) must fail P1, and from layer 5 on the page shows the unsupported screen naming `adapter`.

Where each lands: the rig, P1 to P3 and the headless control at layer 3; S1 to S3 and S9 at layer 4; S5 and the unsupported screen at layer 5; S4, S6 to S8, S10 and S11 at layer 6.

### 16c. Fixtures, produced with ffmpeg 9.0.1

`scripts/make-fixture.sh` writes `fixtures/` (gitignored) and `tests/fixtures/tables/` (committed) with the ffmpeg and ffprobe on PATH (9.0.1 with libx264 and libx265).

**The burned-in index.** 18 blocks of 64x64 px in a row at `y = 16`, block `i` at `x = 16 + 64 * i`. Blocks 0 to 15 are the frame index in binary, most significant bit first: white (Y 235) for 1, black (Y 16) for 0. Block 16 is always white and block 17 always black, a guard the reader must find before it reports anything, so a black, missing or shifted frame throws instead of reading as index 0. The blocks are neutral grey (Cb = Cr = 128), so neither matrix changes them and the reading is independent of the decoder path. The reader averages the centre 16x16 px of each block and thresholds at 128. The blocks survive Grayscale and Blur with sigma up to 8.

```sh
#!/bin/sh
set -eu
mkdir -p fixtures tests/fixtures/tables

# 16 index bits plus the white and black guard blocks
boxes="drawbox=x=16:y=16:w=1152:h=64:color=black:t=fill,drawbox=x=1040:y=16:w=64:h=64:color=white:t=fill"
i=0
while [ "$i" -lt 16 ]; do
  boxes="$boxes,drawbox=x=$((16 + i * 64)):y=16:w=64:h=64:color=white:t=fill:enable='mod(floor(n/$((1 << (15 - i)))),2)'"
  i=$((i + 1))
done

src="testsrc2=size=1920x1080:rate=24000/1001"
tags="-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv"

# H.264 High, 3 B-frames with pyramid, open GOP every 48 frames: the software path
ffmpeg -v error -y -f lavfi -i "$src" -frames:v 240 -vf "format=yuv420p,$boxes" \
  -c:v libx264 -profile:v high -preset medium -crf 16 \
  -x264-params keyint=48:min-keyint=48:scenecut=0:bframes=3:b-pyramid=normal:open-gop=1 \
  $tags -movflags +faststart fixtures/index-h264.mp4

# The same with a 250-frame GOP: backwards steps deep into a long GOP (S11, test 46)
ffmpeg -v error -y -f lavfi -i "$src" -frames:v 300 -vf "format=yuv420p,$boxes" \
  -c:v libx264 -profile:v high -preset medium -crf 16 \
  -x264-params keyint=250:min-keyint=250:scenecut=0:bframes=3:b-pyramid=normal:open-gop=1 \
  $tags -movflags +faststart fixtures/index-h264-gop250.mp4

# HEVC Main10, x265 open GOP (CRA with leading pictures): the hardware path of decision 1
ffmpeg -v error -y -f lavfi -i "$src" -frames:v 240 -vf "format=yuv420p,$boxes,format=yuv420p10le" \
  -c:v libx265 -profile:v main10 -crf 16 \
  -x265-params keyint=48:min-keyint=48:scenecut=0:open-gop=1:bframes=3:log-level=error \
  $tags -tag:v hvc1 -movflags +faststart fixtures/index-hevc10.mp4
```

The blocks are drawn in 8-bit `yuv420p` before the 10-bit conversion, so drawing never depends on a filter's high-bit-depth support. `-tag:v hvc1` gives the `hvc1` sample entry (`hev1` otherwise). Tagging BT.709 makes the S11 matrix comparison meaningful: Chrome reports `bt709` on both paths, and only the conversion differs.

**Colour references for S11**, decoded by ffmpeg from the same fixture with each matrix:

```sh
for f in h264 hevc10; do
  for m in bt709 bt601; do
    ffmpeg -v error -y -i "fixtures/index-$f.mp4" \
      -vf "select='eq(n,30)',scale=in_color_matrix=$m:in_range=tv,format=rgba" \
      -frames:v 1 -f rawvideo "fixtures/ref30-$f-$m.rgba"
  done
done
```

**Sample tables for test 43**, one JSON per fixture, in decode order:

```sh
for f in h264 h264-gop250 hevc10; do
  ffprobe -v error -select_streams v:0 -show_entries packet=pts,dts,size,flags -of json \
    "fixtures/index-$f.mp4" > "tests/fixtures/tables/index-$f.json"
done
```

**The script's own controls, run before it exits 0.**

- Index readback: `node scripts/read-index.mjs --ffmpeg fixtures/index-h264.mp4 0 37 47 48 239` (and the same for the other two fixtures) decodes each frame with `ffmpeg -v error -i <file> -vf "select='eq(n,<k>)',format=rgba" -frames:v 1 -f rawvideo -` and must read every requested index; the reader given a buffer with its guard blocks painted over must throw.
- The streams really are open GOP with reordering: some key packet after the first is followed within 4 packets by a lower pts (a leading picture). A fixture that came out closed GOP, or without B-frames, fails here instead of silently passing S2.

```sh
has_leading () {
  ffprobe -v error -select_streams v:0 -show_entries packet=pts,flags -of csv=p=0 "$1" |
    awk -F, '{ pts[NR] = $1; key[NR] = ($2 ~ /K/) }
      END { for (i = 2; i <= NR; i++) if (key[i]) for (j = i + 1; j <= i + 4 && j <= NR; j++) if (pts[j] < pts[i]) ok = 1; exit !ok }'
}
has_leading fixtures/index-h264.mp4
has_leading fixtures/index-hevc10.mp4
```

**Remuxing a real owner AVC MKV** (16a step 3), only when `OWNER_MKV` is set, for example to `~/downloads/[SubsPlease] Mushoku Tensei S3 - 01 (1080p) [C3A7F258].mkv` (on disk; that it is AVC is recalled from notes, so the first command checks it):

```sh
if [ -n "${OWNER_MKV:-}" ]; then
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,pix_fmt,color_space,r_frame_rate -of default=nw=1 "$OWNER_MKV"
  ffmpeg -v error -y -i "$OWNER_MKV" -map 0:v:0 -c copy -movflags +faststart fixtures/owner-avc.mp4
  ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 fixtures/owner-avc.mp4
  ffprobe -v error -select_streams v:0 -show_entries packet=flags -of csv=p=0 fixtures/owner-avc.mp4 |
    awk '/K/ { if (last) { g = NR - last; if (!min || g < min) min = g; if (g > max) max = g } last = NR }
      END { print "sync spacing min", min, "max", max }'
fi
```

`codec_name` must print `h264`; `hevc` means the remux needs `-tag:v hvc1` and the file is a hardware-path source under decision 1. `-map 0:v:0` is required: `-map 0` fails on the ASS subtitle track and the default mapping adds audio (both verified). The sync spacing says how deep backwards steps go on real material, which is what `reseekCostMs` and the look-behind threshold are judged against. The remux keeps MKV's millisecond jitter, harmless because frame identity is rank.

## 17. How future cadence data slots in, and open risks

Each row: what a later stage needs, where it lives in this engine, and what changes beyond a `PORT_TABLE` row, a payload variant and a preview renderer (brief change 13).

| data | in cadence | port and payload | preview | engine change beyond a row |
| --- | --- | --- | --- | --- |
| masks and alpha | known/validity and hold `screen`/`paste` masks (bool, packbits per frame); `FrameLayers.alpha` and `CelDrawing` alpha (float32 matte) | `mask`: `r8unorm` texture, 1 B/px, unpacked from bitsets and uploaded with `writeTexture` (so `COPY_DST`); `alpha`: `r16float`, 2 B/px | a tint over its frame with unknown pixels red (cadence never fills unknown); alpha as grey levels | none |
| integer label and donor maps | `labels.i8` plane owner per pair (-1 unexplained); mosaic `donor` int32 (-1 unknown) and `flags` uint8 | `labels`: `r32sint` texture read only with `textureLoad`; mosaic rasters carry `bounds` in painting coordinates beside the texture | each id hashed to a colour, -1 red, **nearest only**: integer formats cannot be filtered, and a blend across donors or labels breaks cadence's no-blend invariant | `PortInfo` gains `sampling: 'nearest' \| 'linear'`, checked when a renderer's pipeline is built; Blur and every resampling node refuse `labels` by port type |
| per-frame transforms and camera paths | `(N, 3, 3)` float64 reference-to-screen similarity per shot; `TransformTrack` of sparse times plus matrices; `camera.at(t)` interpolates translation, angle and log-scale | `transform`: CPU `Float64Array(9)` per instant; a camera path is a per-shot CPU payload of `N` matrices | the frame outline and a warped grid over the current frame; a path as a trail | a `scope: 'shot'` demand; evaluation at an instant interpolates decomposed parameters, never matrix components |
| layer sets and sprites | `CelLayer` (drawings, right-continuous exposure times, drawing indices, transform track, `world` or `screen` space); `CelDrawing` premultiplied float32 plus alpha with `to_local` | `layers`: a CPU record whose drawings are cache keys of `rgba16float` textures, bytes counted on the drawings | layers colour-coded by id over the frame, or the composite at `t` | an entry that references other entries holds pins on them for its own lifetime (a new ownership rule beside rule 4); list-valued payloads; size and `to_local` beside each drawing |
| per-shot outputs | mosaic (3 passes over all frames), hold vote, motion solve, grain calibration: one result per shot | any row, one key per shot, `timeDependent: false` | the renderer of its port | `scope` demands expand to the shot's half-open `[start, stop)`; the shot table is itself a payload from a scene-detection node, so planning gains a phase that evaluates it before expanding dependent demands; a 169-frame 1080p shot is 2.61 GiB of `rgba16float`, so such nodes stream inputs (the frame source's windows are the seed) or take CPU-side ones rather than pinning a texture per frame |
| fractional-time renders at k*400/1001 | 60 fps output from a 24000/1001 source: instant `k * 400/1001` in source-frame units; an integer instant is the exact source frame, a fractional one holds the drawing at `floor` and interpolates the camera | time, not a port: `FrameIndex` becomes `Instant = { num: number; den: number }`, reduced | the timeline steps output instants and shows `k` beside the rational | `time.ts` (alias, `offsetTime`, `encodeTime`); VideoSource's `timeKey` returns `floor(instant)`, so every output instant in one source interval hits one decoded frame; Bake ranges run over `k` |

**Open risks, ranked by what is most likely to cost the project after the mitigations.**

1. **The hardware decode path for HEVC (accepted, decision 1).** Its costs are measured, but its failure modes are known mostly from history: the owner's wrong-frame bug under keyframe-plus-flush, a VA-API GPU process that crashed when unsandboxed (Chromium stops offering hardware decode after three crashes), silent stalls from unclosed frames, reclamation after 90 s in the background, one AV1 10-bit `EncodingError`. It hangs on a disabled-by-default feature in a Chrome from a separate unstable pin. Mitigation: software first, one path per source, the first-frame path check, the progress watchdog, frame counters, S9 and P2.
2. **The decoder session and frame source are the most intricate code in milestone 1**: one feeder per source, generations, per-waiter signals, three frame windows, a flush-on-slack path, a watchdog, and frame ownership across allocation awaits. Mitigation: injected decoder and reader, tests 52 to 57 each proven by breaking its fix, and S2, S9 and S10 in the owner's Chrome. The cost of a mistake is a silent stall or a leaked frame, which is why the counters are in `stats`.
3. **Texture lifetime.** The ownership rules, step scopes, `handOff`, the pin table, the leak identity, tests 32 to 41 with fakes that never release, and S10 with its deliberate-leak control cover the paths the review found. The out-of-memory path (rule 11) is ordered correctly and unit-tested, but it is never provoked on this machine, so it ships unexercised against a real driver.
4. **The precision ceiling for later stages.** Every GPU import is 8 bits, cadence's tolerances sit around one luma level on 16-bit sources, and the owner's HEVC Main10 BDs cannot be read above 8 bits in this Chrome. Milestone 1 is unaffected; the first measurement node on real sources will not be. Exits: AV1 10-bit plus `ingest10`, or a wasm decoder (the owner's libav-wasm) feeding `writeTexture`, each a milestone of its own.
5. **Engine seams that are designed but unproven.** Rational instants, windows, shot scopes, composite pins and data-dependent planning each have a named home, but planning is pure over the document and the cache today, and demands that depend on a computed shot table need the extra phase. This surfaces with the first scene-detection node.
6. **Rig fidelity.** Headed Chrome in the smoke run is the owner's own binary, wrapper, flags and session, differing only in a fresh profile; the weston fallback also differs in compositor, outputs and scale. A Chrome or driver update can change the codec and WebGPU answers overnight; P1 and P2 make that a loud preflight failure, and a behaviour that differs between the rig and the owner's window falls back to the manual script.
7. **Decoder constants from 720p single runs.** A wrong `reorderSlack` now costs a flush (about 250 ms on hardware), not a failure, and the observed lag raises it; a wrong `reseekChunks`, `ahead` or `behind` costs latency or memory. Frame identity is checked independently of all of them, and S11 re-derives them at 1080p and on a 250-frame GOP.
8. **GPU memory budgets are choices.** No memory API exists; the 2 GiB node cache and 1 GiB bake budget are defaults for a 32 GiB card shared with games, and whole-shot stages exceed any texture-per-frame budget. The byte accounting is the app's own, checked only by the S10 identity.
9. **Seek cost on long GOPs is accepted.** A jump decodes from its start sample (about 175 ms for a target 240 frames into a software GOP at 720p, several hundred ms on hardware). An all-intra 10-bit proxy would make every frame one decode and fix HEVC's colour and precision; the owner deferred it on 2026-09-14, unmeasured.
10. **xyflow upstream.** Programmatic edges skip `isValidConnection` (handled: every path validates); two zustand majors in one build (upstream #5685 open, never dedupe); StrictMode connection dragging (#5933 open, unconfirmed).
11. **Toolchain.** `vp` intermittently writes a `devEngines` block (guarded by `check:manifest` with its control); TypeScript 7 has no compiler API for tools that need one; the solution-style root tsconfig is the Vite template's shape and its editor behaviour under tsgo is checked at layer 0; Oxfmt cannot express the house style and is never run.
12. **MP4-only demux.** Every owner source needs a remux outside the app, fragmented MP4 is out of scope, and edit lists only hide samples (nothing is retimed). Acceptable for an experimentation tool; a Matroska demuxer would be its own project.

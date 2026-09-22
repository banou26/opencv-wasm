# opencv-wasm documentation

Astro and Starlight documentation for the built OpenCV 5 package, following the
navigation conventions of docs.fkn.dev with an original visual algorithm atlas.

- Generated native API, class members, overloads, parameter descriptions and type links.
- 94 visual guides with persistent input comparisons, distinct intermediate/result
  drawings, keyboard-accessible stages and optional step playback.
- 94 focused OpenCV experiments, embedded in every algorithm guide and available in `/lab/`.
- 23 runnable cookbook workflows with custom images, draggable regions, intermediate
  previews and typed code examples. Browse `/cookbook/` or its grouped sidebar.
- Image and model uploads, algorithm-specific parameters, synchronized zoom, exact
  RGBA sampling, native numeric fields and a keyboard-accessible pixel magnifier.
- Browser, Node, Python migration, memory ownership, DNN and graph guides.
- Full-text Pagefind search, local list filtering, light/dark themes and mobile navigation.
- Full-width content with a collapsible floating page outline on desktop and
  preview panes that grow with the available space.

## Run

Use Node 22.12 or newer for the documentation tooling.

Install the documentation dependencies, including the pinned published OpenCV
package:

```sh
npm ci
npm run dev
```

For a static build and preview:

```sh
npm run build
npm run preview -- --port 4321
```

The site is available at `http://localhost:4321`. A production hostname is not
assumed. Set Astro's `site` option before deploying so canonical URLs and a sitemap
use the intended hostname.

For local package development, build the parent repository first. Generation
prefers `../lib/` when it exists; otherwise it reads the installed
`@banou/opencv-wasm` package. A fresh checkout needs no Docker or C++ compilation
to build the website. Update the package pin and lockfile after adopting a new
published engine version.

## Cloudflare Pages

With the repository root as the Pages root directory:

| Setting | Value |
| --- | --- |
| Build command | `npm ci --prefix website && npm run docs:build` |
| Output directory | `website/dist` |
| Environment variable | `NODE_VERSION=24` |

The site generator splits the native binary into 16 MiB chunks. The lab downloads
all chunks on its first run, checks their lengths and the complete SHA-256 digest,
then initializes OpenCV from the reassembled bytes. Every native feature stays
available. This is file chunking, not independently loadable algorithm modules;
the full download and an assembly buffer are still required, and compilation
starts after assembly rather than streaming directly from a single response.

Chunk filenames include the binary's hash, and the matching manifest is embedded
in the worker bundle. The original large `.wasm` file is excluded from the site.
Every build checks that all output files meet Pages' 25 MiB asset limit. R2 is not
required for these runtime assets. The npm package keeps its ordinary single WASM
file for other consumers.

## Check

Build the parent package before running the full contributor checks and native
tests below. The production website build alone can use the published package.

```sh
npm run check
npm run build
npm test
```

Checks include strict compilation of documentation examples, every generated
internal link and fragment, native abstract-class reference coverage, search,
keyboard interaction, playback, mobile layout and all 94 native algorithm labs plus
23 cookbook workflows, including default OCR and super-resolution models.
Lab checks also cover image uploads, signed native values, zoom/pan, stale-result
handling, parameter changes, model uploads and error recovery. Cookbook checks use
known frame translations, verify alignment, count and split objects, preserve
unselected pixels and confirm exported cutout alpha.
Every atlas example is checked for distinct stages, finite SVG coordinates and
unclipped labels. Representative stages are also compared as rendered images.
Playwright uses `CHROMIUM_EXECUTABLE`, the local system Chrome when available, or
an installed Playwright Chromium. Install Chromium with `npx playwright install
chromium` on other machines. Visual review screenshots are saved in `test-results/`.

## Content and generation

`scripts/generate.mjs` reads the local or installed package and writes
`src/data/api.generated.json`. It copies the ESM runtime, WASM and licenses into
`public/` for the image lab, with WASM split into smaller download assets and an
associated `src/data/wasm.generated.json` manifest. These generated files are ignored by Git. The build
uses no remote image, font or model service; fonts are bundled locally.

`src/data/algorithms.ts` contains the authored explanations. Each entry links only
to actual declared symbols. `src/lib/visuals/` supplies an input snapshot and three
annotated stages for every guide. `AlgorithmDiagram.astro` renders the snapshots
and controls; missing visual coverage fails the build. Compact API previews show
the same input and final result. Narrow screens stack the comparison vertically.

Pixel filters, morphology, template scores, Fourier examples, clustering and some
other lessons compute small deterministic teaching examples at build time.
Geometry, trained models and more complex pipelines use labelled conceptual
scenes. Each example identifies which kind it is. These illustrations do not
execute the native runtime; `lab.worker.ts` does. Keep that distinction explicit
and keep displayed coordinates, counts and numerical annotations consistent when
adding or changing examples.

The full reference covers declarations, including algorithms that do not yet have
an authored atlas guide. Their reference pages show call structure and upstream
descriptions; that is not a claim that every algorithm has a bespoke visual lesson
or that every overload has been behaviorally tested.

Upstream API text retains links to pinned OpenCV headers. Runtime dependencies and
their notices are copied from the parent package, with the package license and
third-party notice page exposed in the built site.

## Image lab architecture

`src/data/labs.ts` defines one recipe per atlas entry, including parameter ranges,
preprocessing assumptions and any additional inputs. Missing coverage fails the
site build. `src/lib/lab/` groups native executors by algorithm family.
`Experiment` owns each run's native handles and releases them in a `finally` block.
Worker responses copy native values before releasing matrices.

`image-lab.ts` owns uploads, processed resolution and revision tracking. Obsolete
worker results are discarded, and changing an input clears its previous result.
`PixelViewer` only scales canvas presentation: zoom never reruns an algorithm or
changes its pixel buffer. Scrolling over either image zooms at the pointer without
modifier keys; scrollbars pan both views. Views follow the same relative image position and display
area across resolutions with matching aspect ratios. Other aspect ratios are
contained without stretching, with panning limited by each image's edges.
The inspector maps that position to each image’s own pixel coordinates. Its
magnifiers share the output's scale: nine output pixels span each view, and input
pixels are drawn at their corresponding size with nearest-neighbour sampling.
Pixel outlines and numeric values still identify the original native samples.
This does not infer correspondence through a geometric warp.

`src/data/cookbook.ts` describes practical pipelines and their assumptions;
`src/lib/lab/cookbook.ts` executes them. The worker snapshots intermediate matrices
before releasing native handles. Stage buttons switch the output, its pixel values
and its PNG export without rerunning the pipeline. `cookbook-code.ts` contains the
short core examples, which are compiled against the package during `npm run check`.
`cookbook-explanations.ts` explains each algorithm choice, its input and output,
parameter tradeoffs and result diagnosis. All 23 recipes have authored reasoning.
Examples use named imports after one `initOpenCV()` call; the reference shows the
corresponding direct import for each publicly exported symbol.
`src/lib/lab/motion.ts` combines phase-correlation alignment, bidirectional dense
flow, texture and consistency checks, and per-cell medians. It exposes signed
pixel and regional measurements, a dominant-translation residual view, and a JSON
export with explicit unknown cells and processed-pixel units.
Region drawing uses processed-image percentages and remains independent of viewer
zoom. Numeric coordinates provide a keyboard alternative. Paired recipes resize
the second image to the first image's processed dimensions and label that behavior.

Some recipes deliberately isolate one part of a larger workflow: checkerboard
corner detection for calibration, Gray-code generation for structured light,
editable correspondences for pose and triangulation, and intensity height fields
for ICP. The visible recipe states these limits. No single-image experiment is
represented as complete camera calibration, depth capture or video evaluation.

Bundled model provenance and licenses are in `public/lab-assets/README.md`. Models
load only when needed. Uploaded models must match the selected preprocessing and
architecture; arbitrary network outputs are shown as tensor planes, not assigned
class names. Changing settings never uploads local image data.

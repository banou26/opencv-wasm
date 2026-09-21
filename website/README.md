# opencv-wasm documentation

Astro and Starlight documentation for the built OpenCV 5 package, following the
navigation conventions of docs.fkn.dev with an original visual algorithm atlas.

- Generated native API, class members, overloads, parameter descriptions and type links.
- 94 visual guides with persistent input comparisons, distinct intermediate/result
  drawings, keyboard-accessible stages and optional step playback.
- Ten real OpenCV image experiments running in a browser worker.
- Browser, Node, Python migration, memory ownership, DNN and graph guides.
- Full-text Pagefind search, local list filtering, light/dark themes and mobile navigation.

## Run

Use Node 22.12 or newer for the documentation tooling.

Build the package in the parent repository first so `../lib/` contains its native
runtime, declarations, coverage reports and dependency licenses. Then:

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
use the intended hostname. No deploy or public hosting is configured here.

## Check

```sh
npm run check
npm run build
npm test
```

Checks include strict compilation of documentation examples, every generated
internal link and fragment, native abstract-class reference coverage, search,
keyboard interaction, playback, mobile layout and all ten native image-lab operations.
Every atlas example is checked for distinct stages, finite SVG coordinates and
unclipped labels. Representative stages are also compared as rendered images.
Playwright uses `CHROMIUM_EXECUTABLE`, the local system Chrome when available, or
an installed Playwright Chromium. Install Chromium with `npx playwright install
chromium` on other machines. Visual review screenshots are saved in `test-results/`.

## Content and generation

`scripts/generate.mjs` reads the built package and writes
`src/data/api.generated.json`. It copies the ESM runtime, WASM and licenses into
`public/` for the image lab. These generated files are ignored by Git. The build
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

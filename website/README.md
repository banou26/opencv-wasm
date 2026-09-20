# opencv-wasm documentation

Astro and Starlight documentation for the built OpenCV 5 package, following the
navigation conventions of docs.fkn.dev with an original visual algorithm atlas.

- Generated native API, class members, overloads, parameter descriptions and type links.
- 94 authored visual guides with annotated SVG diagrams and keyboard-accessible stages.
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
keyboard interaction, mobile layout and all ten native image-lab operations.
Playwright uses `CHROMIUM_EXECUTABLE`, the local system Chrome when available, or
an installed Playwright Chromium. Install Chromium with `npx playwright install
chromium` on other machines. Visual review screenshots are saved in `test-results/`.

## Content and generation

`scripts/generate.mjs` reads the built package and writes
`src/data/api.generated.json`. It copies the ESM runtime, WASM and licenses into
`public/` for the image lab. These generated files are ignored by Git. The build
uses no remote image, font or model service; fonts are bundled locally.

`src/data/algorithms.ts` contains the authored explanations. Each entry links only
to actual declared symbols. `AlgorithmDiagram.astro` draws conceptual diagrams;
`lab.worker.ts` runs native code. Keep those roles explicit when adding examples.

The full reference covers declarations, including algorithms that do not yet have
an authored atlas guide. Their reference pages show call structure and upstream
descriptions; that is not a claim that every algorithm has a bespoke visual lesson
or that every overload has been behaviorally tested.

Upstream API text retains links to pinned OpenCV headers. Runtime dependencies and
their notices are copied from the parent package, with the package license and
third-party notice page exposed in the built site.

---
title: Build and documentation sources
description: Rebuild the native package, regenerate exact API documentation, and serve this site locally.
---

The private source repository is [banou26/opencv-wasm](https://github.com/banou26/opencv-wasm). Build prerequisites and pinned source checksums live in that repository.

## Library

```sh
npm ci
npm run build
npm test
npm run test:package
```

The native build uses pinned OpenCV and contrib 5.0.0 sources, Emscripten and configured dependencies. `npm run build:js` regenerates JSDoc, builds the JavaScript adapters and emits declarations when native artifacts already exist. `npm pack` creates the distributable tarball; it does not publish a package.

## Website

```sh
cd website
npm ci
npm run build
npm run preview -- --port 4321
```

The generator reads the built `lib/*.d.ts` declarations, the coverage inventory and the Python parity report. It groups overloads without changing their signatures, preserves parameter and result descriptions, and links to the pinned upstream declarations. The visual atlas is authored separately, so regeneration does not erase explanations.

`npm run check` checks the site’s TypeScript and Astro components. `npm test` audits generated links and exercises the site in Chromium. The build output is a static directory and can be served by a static host. This checkout does not automatically publish or deploy it.

## Attribution

API descriptions are derived from the pinned OpenCV and opencv_contrib headers and the package’s handwritten ownership documentation. OpenCV 5 and this package use the Apache License 2.0. The bundled runtime also includes third-party components with their own notices.

Read the [package license](/LICENSE.txt) and [third-party notices](/THIRD_PARTY_NOTICES.txt). Each source-linked API entry identifies the upstream declaration used for its documentation. Diagrams are conceptual explanations; the image laboratory executes the actual native algorithms.

The website bundles its fonts locally. Font notices are available for [DM Sans](/licenses/website-dm-sans.txt) and [JetBrains Mono](/licenses/website-jetbrains-mono.txt), alongside licenses for [Astro](/licenses/website-astro.txt), [Starlight](/licenses/website-starlight.txt) and [Marked](/licenses/website-marked.txt).

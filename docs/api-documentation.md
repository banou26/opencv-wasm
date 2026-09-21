# API documentation

The installed declarations contain JSDoc for native types, functions, overloads, constructors, fields, constants, callback contracts and JavaScript helpers. Hover an API in a TypeScript editor to see its purpose, parameter descriptions, result information and, where applicable, memory ownership. Native declarations link to the pinned upstream header.

Examples include `cv.threshold`, `cv.fisheye.projectPoints`, `cv.ml.SVM.create`, `cv.gapi.op`, `cv.FS.readFile` and `Mat.data`. Namespaced properties retain their comments after declaration generation and packaging. `Mat.clone()` explicitly documents that it retains another handle to the same object; `Mat.mat_clone()` documents copying the pixels into independent storage.

Most algorithm documentation comes from OpenCV and opencv_contrib 5.0.0. The generator resolves documentation on other overloads, inherited methods and Doxygen copy references. It maps native parameter names to the actual TypeScript signatures and identifies output destinations and scalar result objects. Native examples in those comments describe C++ usage; JavaScript uses the emitted signatures, explicit output handles and the package's disposal conventions.

Not every upstream declaration has a detailed explanation. Getters, setters, enum entries and some configuration fields have concise descriptions based on their binding structure. The shipped `@banou/opencv-wasm/documentation.json` audit lists these under `fallback`; it does not claim they have complete algorithm documentation. `missing` records absent declaration comments and must be empty for a successful build. Documentation coverage does not imply that every API has been executed in tests.

To regenerate, run `npm run docs` after preparing the native build and source headers, or `npm run build:js` as usual. Neither command recompiles the native binary. The source headers and build metadata are development prerequisites; package consumers need no Python or C++ tools.

The pipeline consists of:

- `scripts/extract-docs.py`: captures declarations and comments from the pinned headers. Unwrapped declarations supplement explanations without adding runtime APIs. Headers that the upstream parser cannot fully parse in that supplemental mode are recorded in `build/api-docs.json`.
- `scripts/document-types.mjs`: attaches JSDoc to the final signatures, resolves aliases and emits the audit.
- `scripts/api-docs.mjs`: documents hand-bound APIs, adapters and sparse native families.
- `scripts/namespace-types.mjs`: preserves comments through namespace aliases and inherited factories.
- `tests/documentation.test.mjs`: checks public comment coverage and parameter names.
- `tests/editor-docs.mjs`: uses TypeScript's language service to verify actual editor hovers locally and in the fresh tarball consumer.

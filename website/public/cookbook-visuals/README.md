# Cookbook walkthrough images

These PNGs are generated from the repository's original Canvas samples using the same OpenCV 5 WASM processing functions as the interactive cookbook labs. They are committed so reading a walkthrough does not download or initialize the WASM engine.

Regenerate from the repository root after changing the samples or processing chains:

```sh
npm --prefix website run visuals:cookbook
npm --prefix website run check
npm --prefix website run build
```

Generation requires the built `lib/` package, website dependencies, Node with `module.registerHooks` support (22.15+), and Chrome. Set `CHROMIUM_EXECUTABLE` if Chrome is not at the workstation's default path. Chrome draws the Canvas samples; Node executes the native recipes and encodes lossless RGBA PNGs. The engine RNG is seeded to 42 for each recipe, matching the lab.

`src/data/cookbook-visuals.ts` groups named lab snapshots under the cookbook's data-flow steps. `src/data/cookbook-visuals.generated.json` records image dimensions, descriptions, engine version and a source fingerprint. The docs check rejects stale sources or missing/mis-sized PNGs.

The source image stays unchanged. Paired recipes normally use the lab's synthetic 12-pixel leftward translation with reflected borders. The stereo walkthrough uses three textured planes with known 8/16/24-pixel disparities so depth differences are visible. Generation verifies their measured depth medians against the example calibration; these are illustrated synthetic depths, not real camera measurements. Numeric fields are normalized for display by the lab's existing stage renderer; their display brightness is not a native measurement. Flow colours, masks and geometric overlays are described beside their images. Transparency is retained in the cutout. The lab provides native pixel values and custom-image experiments.

Samples and processing code are part of this repository under its Apache-2.0 license. No external photographs are used.

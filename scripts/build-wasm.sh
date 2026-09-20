#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cache vendor build lib
version=5.0.0
for project in opencv opencv_contrib; do
  archive=".cache/$project-$version.tar.gz"
  if [[ ! -f "$archive" ]]; then
    curl -fL --retry 3 "https://github.com/opencv/$project/archive/refs/tags/$version.tar.gz" -o "$archive"
  fi
done
sha256sum -c scripts/sources.sha256
for project in opencv opencv_contrib; do
  if [[ ! -d "vendor/$project-$version" ]]; then
    tar -xzf ".cache/$project-$version.tar.gz" -C vendor
  fi
done
python3 scripts/prepare-dependencies.py
docker build -t opencv-js-builder:4.0.3 .
docker run --rm --init --user "$(id -u):$(id -g)" \
  -e EM_CACHE=/work/.cache/emscripten -e OPENCV_JS_WHITELIST=/work/scripts/bindings-config.py \
  -e BUILD_JOBS="${BUILD_JOBS:-6}" -v "$PWD:/work" -w /work \
  opencv-js-builder:4.0.3 bash scripts/build-in-container.sh
python3 scripts/extract-docs.py
node scripts/finalize-types.mjs
node scripts/namespace-types.mjs

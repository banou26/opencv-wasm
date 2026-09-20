#!/usr/bin/env bash
set -euo pipefail
python3 vendor/opencv-5.0.0/modules/js/generator/embindgen.py \
  --parser vendor/opencv-5.0.0/modules/python/src2/hdr_parser.py \
  --output_file build/wasm5/modules/js_bindings_generator/gen/bindings.cpp \
  --config build/wasm5/modules/js_bindings_generator/gen_js_config.json \
  --whitelist scripts/bindings-config.py
python3 scripts/check-bindings.py

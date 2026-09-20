#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work opencv-js-builder:4.0.3 \
  python3 -m pip install --disable-pip-version-check --upgrade --target /work/.cache/python-reference5 opencv-contrib-python-headless==5.0.0.93 numpy==2.2.6
docker run --rm --user "$(id -u):$(id -g)" -e PYTHONPATH=/work/.cache/python-reference5 -v "$PWD:/work" -w /work opencv-js-builder:4.0.3 \
  python3 scripts/python-reference.py
docker run --rm --user "$(id -u):$(id -g)" -e PYTHONPATH=/work/.cache/python-reference5 -v "$PWD:/work" -w /work opencv-js-builder:4.0.3 \
  python3 scripts/python-behavior-reference.py

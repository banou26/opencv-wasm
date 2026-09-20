FROM emscripten/emsdk:4.0.3@sha256:8dd584d0b33bfae94f57cc000adf02d94621aaf94b848371d98a24b891b84ee5
RUN apt-get update && apt-get install -y --no-install-recommends libeigen3-dev=3.4.0-2ubuntu2 && rm -rf /var/lib/apt/lists/*
RUN cd /emsdk/upstream/emscripten && npm ci --ignore-scripts
COPY scripts/patch-emscripten.py /tmp/patch-emscripten.py
RUN python3 /tmp/patch-emscripten.py

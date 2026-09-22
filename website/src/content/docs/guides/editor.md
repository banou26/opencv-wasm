---
title: Visual node editor
description: Build OpenCV processing graphs, inspect intermediate results, and generate video in your browser.
---

[Open the opencv-wasm editor](/editor/) to connect operations and see their results.
It runs locally in your browser, using OpenCV WASM for computation, WebCodecs for
video, and WebGPU for the main preview. Use desktop Chrome with WebGPU available.

## Start with a clip

Drop an H.264 MP4 onto the canvas to create a **Video Source**, or choose **Open
video**. Connect its video output to **Extract Video Frame**. A **Time** node's
integer frame index drives which frame gets extracted as you scrub the timeline.

Frame operations consume that extracted image. Connect them to **Output**, then
render the full clip at your chosen frame rate and inspect the generated video.
The included **Camera in-betweens** prefab is composed of ordinary editable nodes.

## Read and build a graph

- Right-click the canvas or press **Shift A** to add nodes. Search names,
  algorithms or parameters; small spelling mistakes are accepted.
- Drag between matching typed sockets. Every parameter can use an inline value
  or a connected value from another node.
- Hover a node's **ⓘ** button for its description, or click to pin it open.
- Right-click a node and choose **Select for preview** to inspect it on the right.
  Clicking a node normally keeps the current preview target.
- Enable previews on the nodes themselves to follow intermediate results.
- Drag the timeline to scrub, scroll over the large image to zoom, and drag it to
  pan. The pixel inspector shows the underlying numeric values.
- Press **< / >** (or comma / period) to step the active preview one frame at a
  time, including when the player has focus. Rendered videos pause and select
  the exact output frame. Their canvas keeps the last image visible while the
  decoder prepares the requested frame, without displaying intermediate keyframes.
- In the rendered player, enter a frame number or drag the timeline to seek.
  Press **Space** on the focused image to play/pause. Playback has speed, loop
  and fullscreen controls; it may skip frames to keep pace, while paused stepping
  selects every frame individually.
- Select nodes and press **Ctrl G** to create a custom node with typed inputs and
  outputs. Open its internal graph in a tab to keep editing it.

An image and a coverage mask both travel through frame sockets. Read the node
description and preview its input to distinguish scene colors from numeric mask
data. In **Fill revealed borders**, subtraction compares transformed coverage
masks; it does not compare character colors.

## Save your work

Choose **Project folder** to save and reopen graphs, original media, and exports.
New folders use `opencv-graph.json`, with clips in `media/` and generated files in
`exports/`. Existing `cadence-graph.json` folders remain compatible and retain their
original manifest name when saved. Your clips are processed on your machine and
are not uploaded to the documentation site.

The editor was formerly Cadence Editor. Its source and full Git history now live
in this repository under `editor/`. It retains the interpolation tools and adds a
place to experiment with OpenCV processing alongside the algorithm documentation.
The available nodes cover a subset of the library, not every OpenCV API.

This editor's typed graph is its own execution system. The [G-API guide](/guides/graphs/)
covers the separate OpenCV graph API available to TypeScript applications.

## Generate without a video

Open **Procedural stripe texture** in the editor's prefab library. Image
Coordinates and Seeded Noise feed three editable color-channel groups made of
Pixel Math nodes. Combine RGB creates the image; Time drives wrapped X/Y
translations to animate it. Open a channel group to inspect the arithmetic.

The generated timeline runs at 24 fps. Set **Through frame** for its length,
then save a PNG or **Render video** at your chosen output fps. You can build
other patterns from the **Generate** category, Pixel Math, and ordinary image
operations without attaching any video.

## Render the motion-vectors cookbook

Choose **Regional motion vectors** and attach a video. The prefab follows the
[motion-vectors cookbook](/cookbook/motion-vectors/): coarse pan compensation,
forward and reverse Farneback fields, texture and round-trip checks, regional
medians, and sparse arrows over the footage. Every stage is an editable node;
open the groups to inspect their internal arithmetic and transforms.

Render its Output to see the vectors as a video. Adjust the shared cell-size
Number, flow window, tolerance, texture threshold and arrow scale. Regional
Median Flow's **residual** mode subtracts the dominant image translation.
Gray crosses indicate insufficient evidence; dots indicate near-zero motion.
The **Working frame pair** group limits the longest side to 640 pixels by
default; increase **Max side** for more detail, or open the group to change its
sizing arithmetic. Vectors are measured in these working-image pixels.

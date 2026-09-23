import { initOpenCV } from '@banou/opencv-wasm'
import manifest from '../wasm.generated.json'
import { loadWasmChunks } from '../../../shared/wasm-chunks'
import { ResultCache } from '../engine/cache'
import { orderedParallel, renderFrameBatches, renderWorkerCount, usesSceneAnalysis } from '../engine/parallel-render'
import { evaluateInspection } from './evaluate'
import { RenderPool } from './render-pool'
import type { RenderFrame } from './render-protocol'
import { parseDocument } from '../engine/graph'
import { GENERATED_FPS, outputCount, outputTime } from '../engine/time'
import type { Lease } from '../engine/types'
import { Presenter } from '../gpu/presenter'
import { VideoSource } from '../video/source'
import { MovieEncoder } from '../video/encoder'
import type { Inspection, WorkerCommand, WorkerEvent } from '../protocol'
import { displayPixels } from './kernels'
import type { Payload } from './kernels'
import { drawFlow } from './flow-kernels'
import { payloadSummary } from './payload'

const scope = self as DedicatedWorkerGlobalScope
const post = (event: WorkerEvent, transfer: Transferable[] = []) => scope.postMessage(event, transfer)
let lastYield = 0
// Give incoming seeks/cancellation a turn, without paying a nested timer delay per scalar node.
const wait = async () => {
  if (performance.now() - lastYield < 8) return
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  lastYield = performance.now()
}
const cache = new ResultCache<Payload>(512 * 1024 ** 2)
let presenter: Presenter | undefined, source: VideoSource | undefined
const sources = new Map<string, VideoSource>()
let displayed: Lease<Payload> | undefined
let pixels: Uint8Array<ArrayBuffer> | undefined, width = 0, height = 0
let latest = 0, running = false
type Job = Extract<WorkerCommand, { type: 'load' | 'inspect' | 'bake' }>
let pending: Job | undefined
let pendingThumbnails: Extract<WorkerCommand, { type: 'thumbnails' }> | undefined
let thumbnailGeneration = 0
let initialization: Promise<void> | undefined
let wasmBinary: Uint8Array<ArrayBuffer> | undefined, renderAbort: AbortController | undefined

const evaluate = (value: Inspection, request: number, extraCancelled = () => false, silent = false, holdLastFrame = false) => evaluateInspection(value, {
  cache, sources, source, cancelled: () => request !== latest || extraCancelled(), yield: wait, holdLastFrame,
  status: silent ? undefined : status => { if (request === latest) post({ type: 'status', request, value: status }) },
})

/** Frame lists show a contact sheet; selecting Pyramid Level exposes its actual pixels. */
const visualization = (value: Payload, gain: number): { rgba: Uint8Array<ArrayBuffer>; width: number; height: number } | undefined => {
  if (value.kind === 'flow') {
    const preview = drawFlow(value, value.base, 48, 2, 0.55, false, false)
    try { return { rgba: displayPixels(preview, gain), width: preview.mat.cols, height: preview.mat.rows } } finally { preview.mat.delete() }
  }
  const frame = value.kind === 'frame' ? value : value.kind === 'motion' ? value.preview : undefined
  if (frame) return { rgba: displayPixels(frame, gain), width: frame.mat.cols, height: frame.mat.rows }
  if (value.kind !== 'frames') return
  const columns = Math.min(3, value.frames.length), width = columns * 240, height = Math.ceil(value.frames.length / columns) * 190
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#182019'; ctx.fillRect(0, 0, width, height)
  for (const [i, frame] of value.frames.entries()) {
    const raw = new OffscreenCanvas(frame.mat.cols, frame.mat.rows)
    raw.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(displayPixels(frame, gain)), raw.width, raw.height), 0, 0)
    const scale = Math.min(220 / raw.width, 145 / raw.height), x = (i % columns) * 240 + 10, y = Math.floor(i / columns) * 190 + 30
    ctx.drawImage(raw, x, y, raw.width * scale, raw.height * scale)
    ctx.fillStyle = '#d0ddc6'; ctx.font = '12px sans-serif'; ctx.fillText(`Level ${i} · ${raw.width} × ${raw.height}`, x, y - 10)
  }
  return { rgba: new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer), width, height }
}

const work = async (job: Job) => {
  await initialization
  if (!presenter) throw new Error('The preview device is not ready')
  if (job.type === 'load') {
    const nextSource = await VideoSource.open(job.file)
    if (job.request !== latest) { nextSource.close(); return }
    displayed?.release(); displayed = undefined; pixels = undefined
    nextSource.info.id = job.asset
    if (sources.has(job.asset)) cache.clear()
    sources.get(job.asset)?.close()
    sources.set(job.asset, nextSource)
    source ??= nextSource
    post({ type: 'source', request: job.request, value: nextSource.info })
    return
  }
  if (job.type === 'inspect') {
    const started = performance.now(), result = await evaluate(job.value, job.request)
    if (job.request !== latest) { result.release(); return }
    try {
      const value = result.value
      const frame = value.kind === 'frame' ? value : value.kind === 'motion' ? value.preview : undefined
      const visual = visualization(value, job.value.gain)
      if (visual) { width = visual.width; height = visual.height; pixels = visual.rgba; presenter.show(pixels, width, height) }
      else { width = 0; height = 0; pixels = undefined }
      displayed?.release(); displayed = result
      post({ type: 'result', request: job.request, selected: job.value.selected, path: job.value.path, frame: job.value.frame, width, height, kind: value.kind, sources: result.sources, summary: payloadSummary(value), scalar: value.kind === 'scalar' ? value.value : undefined, motion: value.kind === 'motion' ? { dx: value.dx, dy: value.dy, response: value.response } : undefined, range: frame?.range ?? 'unit', elapsed: performance.now() - started, cacheBytes: cache.bytes, cacheEntries: cache.size })
    } catch (error) { if (displayed !== result) result.release(); throw error }
    return
  }
  const reference = sources.get(job.value.referenceAsset ?? '') ?? source
  const timelineFps = reference?.info.fps ?? GENERATED_FPS
  if (!Number.isInteger(job.start) || !Number.isInteger(job.end) || job.start < 0 || job.end < job.start || job.end >= (reference?.info.frameCount ?? 100000)) throw new Error('Choose a valid inclusive frame range')
  if (![24, 25, 30, 50, 60, 120].includes(job.fps)) throw new Error('Choose a supported output frame rate')
  if (!['compact', 'high', 'maximum'].includes(job.quality)) throw new Error('Choose a supported render quality')
  const total = outputCount(job.start, job.end, timelineFps, job.fps)
  if (total > 100_000) throw new Error('Choose a shorter output range')
  parseDocument(job.value.doc)
  const started = performance.now()
  const sceneAnalysis = job.workers === 0 && usesSceneAnalysis(job.value.doc, job.value.selected, job.value.port, job.value.path)
  const workers = renderWorkerCount(job.workers, total, navigator.hardwareConcurrency, (navigator as WorkerNavigator & { deviceMemory?: number }).deviceMemory, sceneAnalysis)
  const controller = new AbortController(); renderAbort = controller
  let encoder: MovieEncoder | undefined, pool: RenderPool | undefined
  let count = 0, outputWidth = 0, outputHeight = 0
  post({ type: 'bake-progress', request: job.request, done: 0, total, workers })
  const consume = async (rgba: Uint8Array<ArrayBuffer>, width: number, height: number, index: number) => {
    if (job.request !== latest) return
    if (!encoder) { encoder = await MovieEncoder.create(width, height, job.fps, job.quality); outputWidth = width; outputHeight = height }
    if (width !== outputWidth || height !== outputHeight) throw new Error('Output dimensions changed during rendering. Use a fixed Resize before Output.')
    await encoder.add(rgba, index); count++
    post({ type: 'bake-progress', request: job.request, done: count, total, workers })
  }
  try {
    try {
      if (workers > 1) {
        if (!wasmBinary) throw new Error('The native runtime is not ready')
        pool = new RenderPool(workers, controller.signal)
        await pool.initialize({ type: 'init', wasm: wasmBinary, files: [...sources].map(([asset, video]) => ({ asset, file: video.inputFile })), source: source?.info.id, value: job.value, budget: cache.budget })
        const batches = renderFrameBatches(total, job.start, timelineFps, job.fps)
        await orderedParallel(batches.length, workers, async (batch, slot) => {
          const frames: RenderFrame[] = []
          for (const index of batches[batch]!) frames.push(await pool!.frame(slot, index, outputTime(index, job.start, timelineFps, job.fps)))
          return frames
        }, async frames => {
          for (const frame of frames) await consume(frame.pixels, frame.width, frame.height, frame.index)
        }, () => job.request !== latest)
      } else {
        for (let index = 0; index < total && job.request === latest; index++) {
          const frame = outputTime(index, job.start, timelineFps, job.fps)
          // Extend each input clip with its final drawing, including N+1 dependencies.
          const result = await evaluate({ ...job.value, frame }, job.request, () => false, false, true)
          try {
            if (job.request !== latest) break
            if (result.value.kind !== 'frame') throw new Error('Select an image output to bake. Scalar outputs are available in Inspect.')
            // Display gain never changes the encoded pixels, in either execution mode.
            await consume(displayPixels(result.value, 1), result.value.mat.cols, result.value.mat.rows, index)
          } finally { result.release() }
          await wait()
        }
      }
    } catch (error) { if (job.request === latest) throw error }
    finally { pool?.close() }
    const blob = count ? await encoder!.finish() : undefined
    post({ type: 'bake-done', request: job.request, count, start: job.start, fps: job.fps, workers, elapsed: performance.now() - started, cancelled: job.request !== latest, blob })
  } finally { encoder?.close(); if (renderAbort === controller) renderAbort = undefined }

}

/** Thumbnails use the same native cache, but never replace the main inspector surface. */
const thumbnails = async (job: Extract<WorkerCommand, { type: 'thumbnails' }>) => {
  await initialization
  const request = latest, cancelled = () => job.generation !== thumbnailGeneration || request !== latest
  for (const node of job.nodes) {
    if (cancelled()) return
    try {
      const result = await evaluate({ ...job.value, selected: node, port: null }, request, cancelled, true)
      try {
        if (cancelled()) return
        const value = result.value
        const visual = visualization(value, job.value.gain)
        if (!visual) post({ type: 'thumbnail', generation: job.generation, path: job.value.path, node, frame: job.value.frame, kind: value.kind, summary: payloadSummary(value), scalar: value.kind === 'scalar' ? value.value : undefined })
        else {
          const raw = new OffscreenCanvas(visual.width, visual.height), context = raw.getContext('2d')
          if (!context) throw new Error('Cannot create node preview')
          context.putImageData(new ImageData(new Uint8ClampedArray(visual.rgba), raw.width, raw.height), 0, 0)
          const width = 320, height = Math.max(1, Math.round(width * raw.height / raw.width)), small = new OffscreenCanvas(width, height), ctx = small.getContext('2d')
          if (!ctx) throw new Error('Cannot resize node preview')
          ctx.drawImage(raw, 0, 0, width, height)
          const bitmap = small.transferToImageBitmap()
          if (cancelled()) { bitmap.close(); return }
          post({ type: 'thumbnail', generation: job.generation, path: job.value.path, node, frame: job.value.frame, kind: value.kind, bitmap }, [bitmap])
        }
      } finally { result.release() }
    } catch (error) {
      if (cancelled()) return
      post({ type: 'thumbnail', generation: job.generation, path: job.value.path, node, frame: job.value.frame, error: error instanceof Error ? error.message : String(error) })
    }
    await wait()
  }
}

const pump = async () => {
  if (running) return
  running = true
  try {
    while (pending || pendingThumbnails) {
      if (!pending && pendingThumbnails) { const job = pendingThumbnails; pendingThumbnails = undefined; try { await thumbnails(job) } catch (error) { post({ type: 'error', request: latest, message: String(error) }) } continue }
      const job = pending!; pending = undefined
      try { await work(job) }
      catch (error) { if (job.request === latest || job.type === 'bake') post({ type: 'error', request: job.request, message: error instanceof Error ? error.message : String(error) }) }
    }
  } finally { running = false }
}

scope.onmessage = ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === 'init') {
    if (initialization) return
    initialization = (async () => {
      const [gpu] = await Promise.all([Presenter.create(data.canvas, message => post({ type: 'error', request: latest, message, fatal: true })), loadWasmChunks(manifest).then(binary => { wasmBinary = binary; return initOpenCV({ wasmBinary }) })])
      presenter = gpu.presenter; post({ type: 'ready', adapter: gpu.adapter })
    })()
    initialization.catch(error => post({ type: 'error', request: 0, message: String(error), fatal: true }))
  } else if (data.type === 'load' || data.type === 'inspect' || data.type === 'bake') {
    renderAbort?.abort(); latest = data.request; pending = data; pendingThumbnails = undefined; void pump()
  } else if (data.type === 'thumbnails') { thumbnailGeneration = data.generation; pendingThumbnails = data; void pump() }
  else if (data.type === 'cancel') { renderAbort?.abort(); latest = data.request; pending = undefined; pendingThumbnails = undefined }
  else if (data.type === 'budget') { cache.budget = Math.max(64 * 1024 ** 2, Math.min(1024 ** 3, data.bytes)); cache.trim() }
  else if (data.type === 'pixel') {
    const x = Math.floor(data.x), y = Math.floor(data.y)
    if (x < 0 || y < 0 || x >= width || y >= height || !pixels) return
    const at = (y * width + x) * 4
    const native = displayed?.value
    const rgba = native?.kind === 'frame' ? Array.from(native.mat.data32F.subarray(at, at + 4)) : Array.from(pixels.subarray(at, at + 4), v => v / 255)
    post({ type: 'pixel', request: data.request, x, y, rgba })
  } else if (data.type === 'export' && pixels) {
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
    canvas.convertToBlob({ type: 'image/png' }).then(blob => post({ type: 'export', request: data.request, blob }), error => post({ type: 'error', request: data.request, message: String(error) }))
  }
}

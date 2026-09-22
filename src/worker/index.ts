import { initOpenCV } from '@banou/opencv-wasm'
import wasmUrl from '@banou/opencv-wasm/opencv_js.wasm?url'
import { ResultCache } from '../engine/cache'
import { execute } from '../engine/execute'
import { parseDocument } from '../engine/graph'
import { planGraph } from '../engine/plan'
import { outputCount, outputTime } from '../engine/time'
import type { Lease } from '../engine/types'
import { Presenter } from '../gpu/presenter'
import { VideoSource } from '../video/source'
import { MovieEncoder } from '../video/encoder'
import type { Inspection, WorkerCommand, WorkerEvent } from '../protocol'
import { displayPixels, runKernel } from './kernels'
import type { Payload } from './kernels'

const scope = self as DedicatedWorkerGlobalScope
const post = (event: WorkerEvent, transfer: Transferable[] = []) => scope.postMessage(event, transfer)
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const cache = new ResultCache<Payload>(512 * 1024 ** 2)
let presenter: Presenter | undefined, source: VideoSource | undefined
const sources = new Map<string, VideoSource>()
const catalog = () => Object.fromEntries([...sources].map(([id, video]) => [id, video.info]))
let displayed: Lease<Payload> | undefined
let pixels: Uint8Array<ArrayBuffer> | undefined, width = 0, height = 0
let latest = 0, running = false
type Job = Extract<WorkerCommand, { type: 'load' | 'inspect' | 'bake' }>
let pending: Job | undefined
let pendingThumbnails: Extract<WorkerCommand, { type: 'thumbnails' }> | undefined
let thumbnailGeneration = 0
let initialization: Promise<void> | undefined

const evaluate = async (value: Inspection, request: number, extraCancelled = () => false, silent = false) => {
  if (!source) throw new Error('Load a video clip first')
  const currentSource = sources.get(value.referenceAsset ?? '') ?? source
  const plan = planGraph(parseDocument(value.doc), value.selected, value.port, value.frame, currentSource.info.id, currentSource.info.frameCount, value.path, catalog())
  return execute(plan, {
    cache, cancelled: () => request !== latest || extraCancelled(), yield: wait, now: () => performance.now(),
    status: status => { if (request === latest && !silent) post({ type: 'status', request, value: status }) },
    kernel: (step, inputs) => {
      const inputSource = step.asset ? sources.get(step.asset)! : currentSource
      if (step.node.type === 'source') for (const other of sources.values()) if (other !== inputSource) other.close()
      return runKernel(step, inputs, inputSource, () => request !== latest || extraCancelled())
    },
  })
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
      if (frame) {
        const rgba = displayPixels(frame, job.value.gain)
        width = frame.mat.cols; height = frame.mat.rows
        presenter.show(rgba, width, height); pixels = rgba
      }
      displayed?.release(); displayed = result
      post({ type: 'result', request: job.request, selected: job.value.selected, path: job.value.path, frame: job.value.frame, width, height, scalar: value.kind === 'scalar' ? value.value : undefined, motion: value.kind === 'motion' ? { dx: value.dx, dy: value.dy, response: value.response } : undefined, range: frame?.range ?? 'unit', elapsed: performance.now() - started, cacheBytes: cache.bytes, cacheEntries: cache.size })
    } catch (error) { if (displayed !== result) result.release(); throw error }
    return
  }
  const reference = sources.get(job.value.referenceAsset ?? '') ?? source
  if (!reference) throw new Error('Load a clip before baking')
  if (!Number.isInteger(job.start) || !Number.isInteger(job.end) || job.start < 0 || job.end < job.start) throw new Error('Choose a valid inclusive frame range')
  if (![24, 25, 30, 50, 60, 120].includes(job.fps)) throw new Error('Choose a supported output frame rate')
  const total = outputCount(job.start, job.end, reference.info.fps, job.fps)
  if (total > 100_000) throw new Error('Choose a shorter output range')
  const doc = parseDocument(job.value.doc)
  for (const frame of [job.start, outputTime(total - 1, job.start, reference.info.fps, job.fps)]) planGraph(doc, job.value.selected, job.value.port, frame, reference.info.id, reference.info.frameCount, job.value.path, catalog())
  let encoder: MovieEncoder | undefined
  let count = 0
  try {
    for (let index = 0; index < total && job.request === latest; index++) {
      const frame = outputTime(index, job.start, reference.info.fps, job.fps)
      const result = await evaluate({ ...job.value, frame }, job.request)
      try {
        if (job.request !== latest) break
        if (result.value.kind !== 'frame') throw new Error('Select an image output to bake. Scalar outputs are available in Inspect.')
        // Display gain is an inspection aid; encode the actual node output at unit gain.
        encoder ??= await MovieEncoder.create(result.value.mat.cols, result.value.mat.rows, job.fps)
        await encoder.add(displayPixels(result.value, 1), index)
        count++
      } finally { result.release() }
      post({ type: 'bake-progress', request: job.request, done: count, total })
      await wait()
    }
  } catch (error) { if (job.request === latest) { encoder?.close(); throw error } }
  try {
    const blob = count ? await encoder!.finish() : undefined
    post({ type: 'bake-done', request: job.request, count, start: job.start, fps: job.fps, cancelled: job.request !== latest, blob })
  } finally { encoder?.close() }
}

/** Thumbnails use the same native cache, but never replace the main inspector surface. */
const thumbnails = async (job: Extract<WorkerCommand, { type: 'thumbnails' }>) => {
  await initialization
  if (!source) return
  const request = latest, cancelled = () => job.generation !== thumbnailGeneration || request !== latest
  for (const node of job.nodes) {
    if (cancelled()) return
    try {
      const result = await evaluate({ ...job.value, selected: node, port: null }, request, cancelled, true)
      try {
        if (cancelled()) return
        const value = result.value
        if (value.kind === 'scalar') post({ type: 'thumbnail', generation: job.generation, path: job.value.path, node, frame: job.value.frame, scalar: value.value })
        else {
          const frame = value.kind === 'motion' ? value.preview : value
          const raw = new OffscreenCanvas(frame.mat.cols, frame.mat.rows), context = raw.getContext('2d')
          if (!context) throw new Error('Cannot create node preview')
          context.putImageData(new ImageData(new Uint8ClampedArray(displayPixels(frame, job.value.gain)), raw.width, raw.height), 0, 0)
          const width = 320, height = Math.max(1, Math.round(width * raw.height / raw.width)), small = new OffscreenCanvas(width, height), ctx = small.getContext('2d')
          if (!ctx) throw new Error('Cannot resize node preview')
          ctx.drawImage(raw, 0, 0, width, height)
          const bitmap = small.transferToImageBitmap()
          if (cancelled()) { bitmap.close(); return }
          post({ type: 'thumbnail', generation: job.generation, path: job.value.path, node, frame: job.value.frame, bitmap }, [bitmap])
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
      const [gpu] = await Promise.all([Presenter.create(data.canvas, message => post({ type: 'error', request: latest, message, fatal: true })), initOpenCV({ wasmUrl })])
      presenter = gpu.presenter; post({ type: 'ready', adapter: gpu.adapter })
    })()
    initialization.catch(error => post({ type: 'error', request: 0, message: String(error), fatal: true }))
  } else if (data.type === 'load' || data.type === 'inspect' || data.type === 'bake') {
    latest = data.request; pending = data; pendingThumbnails = undefined; void pump()
  } else if (data.type === 'thumbnails') { thumbnailGeneration = data.generation; pendingThumbnails = data; void pump() }
  else if (data.type === 'cancel') { latest = data.request; pending = undefined; pendingThumbnails = undefined }
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

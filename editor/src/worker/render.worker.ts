import { initOpenCV } from '@banou/opencv-wasm'
import { ResultCache } from '../engine/cache'
import { VideoSource } from '../video/source'
import { evaluateInspection } from './evaluate'
import { displayPixels } from './kernels'
import type { Payload } from './payload'
import type { Inspection } from '../protocol'
import type { RenderCommand, RenderEvent } from './render-protocol'

const cache = new ResultCache<Payload>(512 * 1024 ** 2), sources = new Map<string, VideoSource>()
let value: Inspection | undefined, source: VideoSource | undefined, running = false
const post = (event: RenderEvent, transfer: Transferable[] = []) => self.postMessage(event, { transfer })

/** One request at a time gives each native heap exclusive ownership of its matrices. */
self.onmessage = async ({ data }: MessageEvent<RenderCommand>) => {
  if (running) { post({ type: 'error', message: 'Render worker received overlapping requests' }); return }
  running = true
  try {
    if (data.type === 'init') {
      await initOpenCV({ wasmBinary: data.wasm })
      cache.budget = data.budget; value = data.value
      for (const { asset, file } of data.files) {
        const video = await VideoSource.open(file); video.info.id = asset; sources.set(asset, video)
      }
      source = sources.get(data.source ?? '')
      post({ type: 'ready' })
    } else {
      if (!value) throw new Error('Render worker has not initialized')
      const result = await evaluateInspection({ ...value, frame: data.time }, { cache, sources, source, cancelled: () => false, yield: async () => {}, holdLastFrame: true })
      try {
        if (result.value.kind !== 'frame') throw new Error('Select an image output to render')
        const pixels = displayPixels(result.value, 1)
        post({ type: 'frame', index: data.index, width: result.value.mat.cols, height: result.value.mat.rows, pixels }, [pixels.buffer])
      } finally { result.release() }
    }
  } catch (error) { post({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
  finally { running = false }
}

import type { OpenCV } from '../../../lib/index.js'
import type * as Runtime from '../../../lib/index.js'
import type { LabRequest, LabResponse } from '../lib/lab/types'
import { Experiment } from '../lib/lab/context'
import { filters } from '../lib/lab/filters'
import { regions } from '../lib/lab/regions'
import { learning } from '../lib/lab/learning'
import { pairs } from '../lib/lab/pairs'
import { geometry } from '../lib/lab/geometry'
import { models } from '../lib/lab/models'
import { cook } from '../lib/lab/cookbook'
import { loadWasmChunks } from '../lib/wasm-chunks'
import wasm from '../data/wasm.generated.json'
let diagnostics: string[] = []
let instance: Promise<{ cv: OpenCV; runtime: typeof Runtime }> | undefined
const load = () =>
  (instance ??= (async () => {
    const path = '/runtime/index.js'
    const runtime = (await import(/* @vite-ignore */ path)) as typeof Runtime
    const cv = await runtime.createOpenCV({
      wasmBinary: await loadWasmChunks(wasm),
      printErr: (text) => {
        diagnostics.push(text)
        diagnostics = diagnostics.slice(-8)
      }
    })
    return { cv, runtime }
  })().catch((error) => {
    instance = undefined
    throw error
  }))
self.onmessage = async ({ data }: MessageEvent<LabRequest>) => {
  let experiment: Experiment | undefined
  try {
    const { cv, runtime } = await load(),
      start = performance.now()
    diagnostics = []
    cv.setRNGSeed(42)
    experiment = new Experiment(cv, runtime, data)
    if (
      !cook(experiment) &&
      !filters(experiment) &&
      !regions(experiment) &&
      !learning(experiment) &&
      !pairs(experiment) &&
      !geometry(experiment) &&
      !(await models(experiment))
    )
      throw new Error(`Unknown algorithm: ${data.algorithm}`)
    if (experiment.out.empty()) throw new Error('The algorithm produced no output image.')
    const result = runtime.toImageData(cv, experiment.out),
      elapsed = performance.now() - start
    const response: LabResponse = {
      id: data.id,
      algorithm: data.algorithm,
      pixels: result.data,
      width: result.width,
      height: result.height,
      elapsed,
      version: cv.getVersionString(),
      note: experiment.note,
      native: experiment.native,
      stages: experiment.stages,
      download: experiment.download
    }
    const transfer: Transferable[] = [result.data.buffer]
    if (response.native) transfer.push(response.native.values.buffer)
    for (const stage of experiment.stages) {
      transfer.push(stage.pixels.buffer)
      if (stage.native) transfer.push(stage.native.values.buffer)
    }
    self.postMessage(response, { transfer })
  } catch (error) {
    self.postMessage({
      id: data.id,
      error:
        error instanceof Error
          ? error.message
          : `Native OpenCV error (${String(error)}). ${diagnostics.length ? diagnostics.join('\n') : 'Check input dimensions and algorithm requirements.'}`
    } satisfies LabResponse)
  } finally {
    experiment?.dispose()
  }
}

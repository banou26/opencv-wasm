import { initOpenCV } from '@banou/opencv-wasm'
import { regionalFineGrid } from 'cadence/regional'
import { loadWasmChunks } from '../../shared/wasm-chunks'
import manifest from '../src/wasm.generated.json'
import { defaultParams } from '../src/engine/specs'
import type { NodeType, Bundle } from '../src/engine/types'
import { VideoSource } from '../src/video/source'
import { regionalKernel } from '../src/worker/regional-kernels'
import type { Payload } from '../src/worker/payload'

/** Test-only Vite entry: capture exact editor decode/kernel inputs, without dense fields or pixels. */
export const captureRegionalSnapshot = async (file: File) => {
  await initOpenCV({ wasmBinary: await loadWasmChunks(manifest) })
  const video = await VideoSource.open(file), bundles: Bundle<Payload>[] = []
  const parameters: Record<string, unknown> = {}, timings: Record<string, number> = {}
  let payload: Payload = { kind: 'video', asset: video.info.id, info: video.info }
  const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  try {
    for (const type of ['sceneRange', 'regionalMotion', 'regionalPool', 'regionalTracks', 'regionalHistory'] as NodeType[]) {
      const params = { ...defaultParams(type), ...(type === 'sceneRange' ? { first: 0, last: video.info.frameCount - 1 } : {}) }
      parameters[type] = params
      const start = performance.now()
      const bundle = await regionalKernel({ key: type, node: { id: type, type, params, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 },
        { [type === 'sceneRange' ? 'in:video:clip' : 'in:regions:data']: payload }, id => id === video.info.id ? video : undefined, () => false)
      if (!bundle) throw new Error(`Missing regional stage: ${type}`)
      bundles.push(bundle); payload = bundle.outputs['out:regions:data']!
      timings[type] = performance.now() - start
    }
    if (payload.kind !== 'regions' || !payload.data.sequence || !payload.data.tracks || !payload.data.families) throw new Error('Incomplete regional snapshot')
    const data = payload.data, sequence = data.sequence!
    const analysisFrameHashes = []
    for (const frame of data.scene.frames) analysisFrameHashes.push(await sha256(frame.data.slice().buffer))
    return {
      schema: 'cadence-editor-regional-snapshot', schemaVersion: 1, runtimeSha256: manifest.sha256,
      source: { ...video.info, sha256: await sha256(await file.arrayBuffer()), byteLength: file.size },
      decode: 'VideoSource.frameAt -> VideoFrame.copyTo RGBA sRGB -> OpenCV COLOR_RGBA2BGR -> INTER_AREA',
      analysis: { width: sequence.width, height: sequence.height, frameCount: sequence.frameCount, first: data.scene.first, last: data.scene.last, frameHashes: analysisFrameHashes },
      parameters, timings, tracks: data.tracks!, families: data.families!,
      grids: sequence.pairs.map(pair => ({ frame: pair.frame, grids: [regionalFineGrid(pair)] })),
    }
  } finally { bundles.reverse().forEach(bundle => bundle.dispose()); video.close() }
}

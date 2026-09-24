import { initOpenCV } from '@banou/opencv-wasm'
import { groupFrameVectors, poolVectorCandidates, regionalFineGrid } from 'cadence/regional'
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

/** Test-only export of exact full-scene decoder pixels and selected direct-motion pairs. */
export const captureVectorSnapshot = async (file: File, requestedPairs: number[]) => {
  await initOpenCV({ wasmBinary: await loadWasmChunks(manifest) })
  const video = await VideoSource.open(file), bundles: Bundle<Payload>[] = []
  const parameters: Record<string, unknown> = {}, timings: Record<string, number> = {}
  let payload: Payload = { kind: 'video', asset: video.info.id, info: video.info }
  const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  try {
    if (!requestedPairs.length || requestedPairs.some(frame => !Number.isSafeInteger(frame) || frame < 0 || frame >= video.info.frameCount - 1)) throw new RangeError('Snapshot pairs must have an outgoing source frame')
    for (const type of ['sceneRange', 'vectorCandidates', 'vectorGroups'] as NodeType[]) {
      const params = { ...defaultParams(type), ...(type === 'sceneRange' ? { first: 0, last: video.info.frameCount - 1 } : {}) }
      parameters[type] = params
      const start = performance.now()
      const bundle = await regionalKernel({ key: type, node: { id: type, type, params, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 },
        { [type === 'sceneRange' ? 'in:video:clip' : 'in:regions:data']: payload }, id => id === video.info.id ? video : undefined, () => false)
      if (!bundle) throw new Error(`Missing direct stage: ${type}`)
      bundles.push(bundle); payload = bundle.outputs['out:regions:data']!
      timings[type] = performance.now() - start
    }
    if (payload.kind !== 'regions' || !payload.data.sequence || !payload.data.frameVectorGroups) throw new Error('Incomplete direct snapshot')
    const data = payload.data, sequence = data.sequence!, groups = data.frameVectorGroups!
    const indices = [...new Set(requestedPairs.flatMap(frame => [frame, frame + 1]))].sort((a, b) => a - b)
    const frames = []
    for (const index of indices) {
      const frame = data.scene.frames[index]!
      frames.push({ index, width: frame.width, height: frame.height, sha256: await sha256(frame.data.slice().buffer), data: Array.from(frame.data) })
    }
    const serialize = (frame: typeof groups.frames[number]) => ({ ...frame, labels: Array.from(frame.labels), confidence: Array.from(frame.confidence) })
    const pairs = [...new Set(requestedPairs)].sort((a, b) => a - b).map(index => {
      const pair = sequence.pairs.find(pair => pair.frame === index)!, verifiedGrid = pair.grids[0]!, rawGrid = poolVectorCandidates(pair.flow, verifiedGrid.cellSize)
      const raw = groupFrameVectors({ width: sequence.width, height: sequence.height, frameCount: 2, pairs: [{ ...pair, frame: 0, grids: [rawGrid] }] }, groups.options).frames[0]!
      return { frame: index, pan: pair.flow.pan, rawGrid, verifiedGrid, corrections: data.vectorBorderCorrections?.find(frame => frame.frame === index)?.corrections ?? [], rawGroups: { ...serialize(raw), frame: index }, verifiedGroups: serialize(groups.frames.find(frame => frame.frame === index)!) }
    })
    return {
      schema: 'cadence-editor-vector-snapshot', schemaVersion: 1, runtimeSha256: manifest.sha256,
      source: { ...video.info, sha256: await sha256(await file.arrayBuffer()), byteLength: file.size },
      decode: 'Full scene VideoSource.frameAt -> VideoFrame.copyTo RGBA sRGB -> OpenCV COLOR_RGBA2BGR -> INTER_AREA',
      analysis: { width: sequence.width, height: sequence.height, frameCount: sequence.frameCount, first: data.scene.first, last: data.scene.last, frames },
      parameters, timings, pairs,
    }
  } finally { bundles.reverse().forEach(bundle => bundle.dispose()); video.close() }
}

import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV } from '@banou/opencv-wasm'
import { ResultCache } from '../src/engine/cache'
import { evaluateGraph } from '../src/engine/evaluate'
import { parseDocument } from '../src/engine/graph'
import { regionalLayersGraph } from '../src/engine/regional-prefab'
import { defaultParams } from '../src/engine/specs'
import type { Params } from '../src/engine/types'
import type { VideoSource } from '../src/video/source'
import { runKernel } from '../src/worker/kernels'
import { image, parameterValue, payloadBundle, type Payload } from '../src/worker/payload'
import type { RegionalData } from '../src/worker/regional-data'
import { regionalDisplayGeometry, regionalKernel } from '../src/worker/regional-kernels'

beforeAll(async () => { await initOpenCV() }, 60000)

const fixture = (): RegionalData => ({
  stage: 'scene',
  scene: { asset: 'clip', first: 2, last: 4, sourceWidth: 8, sourceHeight: 6,
    frames: Array.from({ length: 3 }, () => ({ width: 4, height: 3, data: new Uint8Array(4 * 3 * 3).fill(50) })) },
})
const step = (params: Params = {}) => ({ key: 'display', node: { id: 'ninspect', type: 'regionalInspect' as const, params: { ...defaultParams('regionalInspect'), frame: 2, view: 'source', ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 2 })
const input = (data = fixture()): Record<string, Payload> => ({ 'in:regions:data': { kind: 'regions', data } })
const mockVideo = (copy?: () => void, acquire?: () => void) => {
  const requested: number[] = [], closed: number[] = [], rgba = new Uint8Array(8 * 6 * 4)
  for (let i = 0; i < 8 * 6; i++) rgba.set([i % 2 ? 230 : 10, 70, 20, 255], i * 4)
  const info = { id: 'clip', name: 'fixture', width: 8, height: 6, frameCount: 5, fps: 24, codec: 'test', decoder: 'software' as const, warnings: [] }
  const video = { info, frameAt: async (index: number) => {
    requested.push(index); acquire?.()
    return { displayWidth: 8, displayHeight: 6, visibleRect: null, copyTo: async (out: Uint8Array) => { copy?.(); out.set(rgba) }, close: () => closed.push(index) }
  } } as unknown as VideoSource
  return { video, requested, closed, rgba, info }
}

test('regional display geometry is capped to source size and independent of analysis', () => {
  const data = fixture()
  expect(regionalDisplayGeometry(data.scene, 0)).toEqual({ width: 4, height: 3 })
  expect(regionalDisplayGeometry(data.scene, 960)).toEqual({ width: 8, height: 6 })
  expect(regionalDisplayGeometry(data.scene, 6)).toEqual({ width: 6, height: 5 })
  expect(regionalDisplayGeometry(data.scene, 1)).toEqual({ width: 1, height: 1 })
  expect(regionalDisplayGeometry({ ...data.scene, sourceWidth: 1920, sourceHeight: 1080 }, 960)).toEqual({ width: 960, height: 540 })
  for (const value of [-1, .5, 1281, NaN, Infinity]) expect(() => regionalDisplayGeometry(data.scene, value)).toThrow(/Display max side/)
})

test('inspector decodes the requested original frame and preserves detail absent from analysis', async () => {
  const data = fixture(), original = structuredClone(data), source = mockVideo(), assets: string[] = []
  const bundle = await regionalKernel(step({ frame: 3 }), input(data), id => { assets.push(id); return source.video }, () => false)
  try {
    const result = image(bundle!.outputs['out:frame:image']!)
    expect([result.mat.cols, result.mat.rows]).toEqual([8, 6])
    for (let i = 0; i < source.rgba.length; i++) expect(result.mat.data32F[i]).toBeCloseTo(source.rgba[i]! / 255, 6)
    expect(data).toEqual(original)
    expect(assets).toEqual(['clip']); expect(source.requested).toEqual([3]); expect(source.closed).toEqual([3])
  } finally { bundle!.dispose() }
})

test('analysis-size displays reuse cached pixels and missing high-detail sources fail explicitly', async () => {
  const source = mockVideo()
  for (const displayMaxSide of [0, 4]) {
    const bundle = await regionalKernel(step({ displayMaxSide }), input(), () => source.video, () => false)
    try { expect([image(bundle!.outputs['out:frame:image']!).mat.cols, image(bundle!.outputs['out:frame:image']!).mat.rows]).toEqual([4, 3]) }
    finally { bundle!.dispose() }
  }
  expect(source.requested).toEqual([])
  await expect(regionalKernel(step(), input(), () => undefined, () => false)).rejects.toThrow(/Attach the original video/)
  await expect(regionalKernel(step({ frame: 1 }), input(), () => source.video, () => false)).rejects.toThrow(/analyzed range/)
  expect(source.requested).toEqual([])
})

test('source-backed displays close frames on copy errors and both cancellation boundaries', async () => {
  const failing = mockVideo(() => { throw new Error('copy failed') })
  await expect(regionalKernel(step(), input(), () => failing.video, () => false)).rejects.toThrow('copy failed')
  expect(failing.closed).toEqual([2])
  for (const phase of ['acquire', 'copy'] as const) {
    let cancelled = false
    const cancel = () => { cancelled = true }, source = mockVideo(phase === 'copy' ? cancel : undefined, phase === 'acquire' ? cancel : undefined)
    await expect(regionalKernel(step(), input(), () => source.video, () => cancelled)).rejects.toThrow(/cancelled/)
    expect(source.closed).toEqual([2])
  }
  const source = mockVideo()
  await expect(regionalKernel(step(), input(), () => source.video, () => true)).rejects.toThrow(/cancelled/)
  expect(source.requested).toEqual([])
})

test('chart-only regional views do not decode the original video', async () => {
  const data = fixture(), source = mockVideo()
  data.sequence = { width: 4, height: 3, frameCount: 3, pairs: [] }
  data.analysis = { frames: [], groups: [] }
  data.tracks = { width: 4, height: 3, frameCount: 3, cellSize: 8, tracks: [], groups: [], frames: [] }
  data.families = { width: 4, height: 3, frameCount: 3, cellSize: 8, options: { tolerance: .75, minimumOverlap: 4, proximityWeight: .25 }, families: [], frames: [], comparisons: [] }
  for (const view of ['timeline', 'velocities', 'conflicts']) {
    const bundle = await regionalKernel(step({ view }), input(data), () => source.video, () => false)
    try { expect(image(bundle!.outputs['out:frame:image']!).mat.cols).toBeGreaterThan(8) }
    finally { bundle!.dispose() }
  }
  expect(source.requested).toEqual([])
})

test('changing display resolution invalidates only the inspector cache', async () => {
  const doc = regionalLayersGraph(), data = fixture(), source = mockVideo(), calls = new Map<string, number>(), cache = new ResultCache<Payload>(1024 ** 2)
  const inspect = doc.nodes.find(node => node.id === 'nsourceview')!
  const evaluate = () => evaluateGraph(doc, inspect.id, null, 2, [], {
    cache, assets: { clip: source.info }, sourceId: 'clip', parameter: parameterValue, cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {},
    kernel: async (resolved, inputs) => {
      calls.set(resolved.node.type, (calls.get(resolved.node.type) ?? 0) + 1)
      if (resolved.node.type === 'time') return payloadBundle({ 'out:scalar:index': { kind: 'scalar', value: 2 } })
      if (resolved.node.type === 'clip') return payloadBundle({ 'out:video:clip': { kind: 'video', asset: 'clip', info: source.info } })
      if (resolved.node.type === 'sceneRange') return payloadBundle({ 'out:regions:data': { kind: 'regions', data } })
      return await regionalKernel(resolved, inputs, () => source.video, () => false) ?? runKernel(resolved, inputs, undefined, () => false, doc)
    },
  })
  try {
    for (const displayMaxSide of [0, 8, 0, 8]) {
      inspect.params.displayMaxSide = displayMaxSide
      const result = await evaluate()
      try { expect(image(result.value).mat.cols).toBe(displayMaxSide || 4) } finally { result.release() }
    }
    expect(calls.get('sceneRange')).toBe(1); expect(calls.get('regionalInspect')).toBe(2)
    expect(source.requested).toEqual([2])
  } finally { cache.clear() }
})

test('saved regional inspectors gain display defaults in root and nested graphs without losing parameters', () => {
  const doc = regionalLayersGraph(), nested = regionalLayersGraph()
  for (const graph of [doc, nested]) for (const node of graph.nodes) if (node.type === 'regionalInspect') delete node.params.displayMaxSide
  const custom = doc.nodes.find(node => node.id === 'nsourceview')!
  custom.params = { ...custom.params, frame: 17, cellSize: '8', groupPage: 4, displayMaxSide: 0 }
  doc.definitions = [{ id: 'gtest', name: 'Nested review', inputs: [], outputs: [], graph: { ...nested, nodes: [
    ...nested.nodes,
    { id: 'ninput', type: 'groupInput', params: {}, position: { x: 0, y: 0 } },
    { id: 'noutput', type: 'groupOutput', params: {}, position: { x: 0, y: 0 } },
  ] } }]
  const parsed = parseDocument(doc)
  expect(parsed.nodes.find(node => node.id === custom.id)!.params).toEqual(custom.params)
  for (const graph of [parsed, parsed.definitions![0]!.graph]) for (const node of graph.nodes) if (node.type === 'regionalInspect' && !(graph === parsed && node.id === custom.id)) expect(node.params.displayMaxSide).toBe(960)
  expect(doc.nodes.find(node => node.id === 'nreview')!.params.displayMaxSide).toBeUndefined()
})

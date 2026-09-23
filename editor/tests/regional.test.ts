import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV } from '@banou/opencv-wasm'
import { groupMotionHistories, type AnalysisFrame, type RegionalTracks } from 'cadence/regional'
import { regionalLayersGraph } from '../src/engine/regional-prefab'
import { parseDocument, validateConnection } from '../src/engine/graph'
import { ResultCache } from '../src/engine/cache'
import { evaluateGraph } from '../src/engine/evaluate'
import { defaultParams, specFor } from '../src/engine/specs'
import type { NodeType, Params } from '../src/engine/types'
import { runKernel } from '../src/worker/kernels'
import { clonePayload, image, parameterValue, payloadBundle, type Payload } from '../src/worker/payload'
import { regionalKernel, sceneGeometry } from '../src/worker/regional-kernels'
import type { RegionalData } from '../src/worker/regional-data'
import { renderRegional } from '../src/worker/regional-render'
import { evaluateInspection } from '../src/worker/evaluate'
import type { VideoSource } from '../src/video/source'

beforeAll(async () => { await initOpenCV() }, 60000)
const fixture = (count = 8): RegionalData => {
  const width = 128, height = 96, world = new Uint8Array((width + count) * height * 3)
  let seed = 9327
  // Structured artwork, not independent pixel noise masquerading as texture.
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width + count; x += 8) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = 35 + (seed >>> 24) % 180
    for (let yy = y; yy < Math.min(height, y + 8); yy++) for (let xx = x; xx < Math.min(width + count, x + 8); xx++) world.fill(value, (yy * (width + count) + xx) * 3, (yy * (width + count) + xx) * 3 + 3)
  }
  const frames: AnalysisFrame[] = []
  for (let f = 0; f < count; f++) {
    const data = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++) data.set(world.subarray((y * (width + count) + f) * 3, (y * (width + count) + f + width) * 3), y * width * 3)
    frames.push({ width, height, data })
  }
  return { stage: 'scene', scene: { asset: 'clip', first: 0, last: count - 1, sourceWidth: width, sourceHeight: height, frames } }
}
const step = (type: NodeType, params: Params = {}) => ({ key: 'test', node: { id: 'n1', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 })

test('regional prefab has real staged contracts and only inspectors depend on Time', () => {
  const doc = parseDocument(regionalLayersGraph())
  expect(doc.nodes.filter(n => n.type === 'regionalInspect')).toHaveLength(10)
  expect(new Set(doc.nodes.filter(n => n.type === 'regionalInspect').map(n => specFor(n, doc).title)).size).toBe(10)
  expect(doc.edges.filter(e => e.source === 'ntime').every(e => doc.nodes.find(n => n.id === e.target)?.type === 'regionalInspect')).toBe(true)
  expect(validateConnection(doc, { source: 'nscene', sourceHandle: 'out:regions:data', target: 'ntracks', targetHandle: 'in:regions:data' })).toMatch(/stages must match/)
  expect(validateConnection(doc, { source: 'ndense', sourceHandle: 'out:regions:data', target: 'ngridview', targetHandle: 'in:regions:data' })).toBeNull()
  expect(validateConnection(doc, { source: 'nhistory', sourceHandle: 'out:regions:data', target: 'ntiming', targetHandle: 'in:regions:data' })).toBeNull()
  expect(validateConnection(doc, { source: 'ntracks', sourceHandle: 'out:regions:data', target: 'ntiming', targetHandle: 'in:regions:data' })).toBeNull()
  expect(validateConnection(doc, { source: 'nhistory', sourceHandle: 'out:regions:data', target: 'ntracks', targetHandle: 'in:regions:data' })).toMatch(/stages must match/)
})

test('whole-scene native analysis executes once across scrub order and exposes every stage', async () => {
  const doc = regionalLayersGraph(), data = fixture(), cache = new ResultCache<Payload>(64 * 1024 ** 2)
  const info = { id: 'clip', name: 'fixture', width: 128, height: 96, frameCount: 8, fps: 24, codec: 'test', decoder: 'software' as const, warnings: [] }
  const calls = new Map<string, number>()
  const evaluate = (selected: string, time: number, port: string | null = null) => evaluateGraph(doc, selected, port, time, [], {
    cache, assets: { clip: info }, sourceId: 'clip', parameter: parameterValue, cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {},
    kernel: async (step, inputs) => {
      calls.set(step.node.type, (calls.get(step.node.type) ?? 0) + 1)
      if (step.node.type === 'clip') return payloadBundle({ 'out:video:clip': { kind: 'video', asset: 'clip', info } })
      if (step.node.type === 'sceneRange') return payloadBundle({ 'out:regions:data': { kind: 'regions', data } })
      return runKernel(step, inputs, undefined, () => false, doc)
    },
  })
  try {
    for (const time of [3, 0, 6, 2, 7]) {
      const result = await evaluate('n5', time)
      try { const frame = image(result.value); expect(frame.mat.cols).toBe(256); expect(frame.mat.rows).toBe(192); expect(frame.mat.data32F.some(v => v > .5)).toBe(true) } finally { result.release() }
    }
    for (const type of ['sceneRange', 'regionalMotion', 'regionalPool', 'regionalTracks', 'regionalHistory', 'regionalTiming']) expect(calls.get(type)).toBe(1)
    const dense = await evaluate('ndense', 5, 'out:regions:data')
    try {
      if (dense.value.kind !== 'regions') throw new Error('Missing regions')
      expect(dense.value.data.sequence!.pairs).toHaveLength(7)
      expect(dense.value.data.sequence!.pairs.every(p => p.grids.length === 0)).toBe(true)
      expect(dense.value.data.sequence!.pairs[0]!.flow.valid.some(v => v !== 0)).toBe(true)
    } finally { dense.release() }
    const tracks = await evaluate('ntracks', 1, 'out:regions:data')
    try { if (tracks.value.kind !== 'regions') throw new Error('Missing tracks'); expect(tracks.value.data.tracks!.groups.length).toBeGreaterThan(0); expect(tracks.value.data.sequence!.pairs[0]!.grids.map(g => g.cellSize)).toEqual([96, 48, 24, 12, 8]) } finally { tracks.release() }
    const history = await evaluate('nhistory', 1, 'out:regions:data')
    try {
      if (history.value.kind !== 'regions') throw new Error('Missing history')
      const current = history.value.data
      expect(current.families).toEqual(groupMotionHistories(current.tracks!))
      expect(current.families!.families.length).toBeGreaterThan(0)
      const legacyTiming = await regionalKernel(step('regionalTiming'), { 'in:regions:data': { kind: 'regions', data: { ...current, stage: 'tracks', families: undefined } } }, () => undefined, () => false)
      const newTiming = await evaluate('ntiming', 1, 'out:regions:data')
      try {
        const legacy = legacyTiming!.outputs['out:regions:data']!
        if (newTiming.value.kind !== 'regions' || legacy.kind !== 'regions') throw new Error('Missing timing')
        expect(newTiming.value.data.analysis).toEqual(legacy.data.analysis)
        expect(renderRegional(legacy.data, 1, 'review', 24).summary).toContain('Bottom: motion groups / drawing events.')
        expect(renderRegional(newTiming.value.data, 1, 'review', 24).summary).toContain('Bottom: motion families / original-region drawing events.')
      } finally { legacyTiming!.dispose(); newTiming.release() }
    } finally { history.release() }
    const final = await evaluate('nreview', 7, 'out:string:summary')
    try { expect(final.value.kind).toBe('string'); if (final.value.kind === 'string') expect(final.value.value).toContain('final frame, no outgoing pair') } finally { final.release() }
    for (const id of ['nsourceview', 'nflowview', 'nvalidview', 'ngridview', 'ntracksview', 'nfamiliesview', 'neventsview']) {
      const result = await evaluate(id, 2, 'out:frame:image')
      try { expect(image(result.value).mat.cols).toBe(128) } finally { result.release() }
    }
    const timeline = await evaluate('ntimeview', 2, 'out:string:summary')
    try { if (timeline.value.kind !== 'string') throw new Error('Missing timing summary'); expect(timeline.value.value).toContain('completed hold lengths'); expect(timeline.value.value).toContain('?') } finally { timeline.release() }
    const velocities = await evaluate('nvelocityview', 2, 'out:string:summary')
    try { if (velocities.value.kind !== 'string') throw new Error('Missing velocity summary'); expect(velocities.value.value).toContain('analysis pixels per source pair'); expect(velocities.value.value).toContain('regions') } finally { velocities.release() }
  } finally { cache.clear() }
}, 60000)

test('scene decoding is explicit, closes owned frames, and preserves source pixels', async () => {
  const closed: number[] = [], requested: number[] = [], rgba = new Uint8Array(128 * 96 * 4)
  for (let i = 0; i < 128 * 96; i++) rgba.set([200, 70, 10, 255], i * 4)
  const original = rgba.slice()
  const video = { info: { id: 'clip', width: 128, height: 96, frameCount: 6 }, frameAt: async (index: number) => { requested.push(index); return { displayWidth: 128, displayHeight: 96, visibleRect: null, copyTo: async (out: Uint8Array) => { out.set(rgba) }, close: () => closed.push(index) } } } as unknown as VideoSource
  const input = { 'in:video:clip': { kind: 'video', asset: 'clip', info: video.info } } satisfies Record<string, Payload>
  const bundle = await regionalKernel(step('sceneRange', { first: 2, last: 4, maxSide: 128 }), input, () => video, () => false)
  try {
    expect(requested).toEqual([2, 3, 4]); expect(closed).toEqual(requested); expect(rgba).toEqual(original)
    const value = bundle!.outputs['out:regions:data']!
    if (value.kind !== 'regions') throw new Error('Missing scene')
    expect(value.data.scene.frames[0]!.data.subarray(0, 3)).toEqual(new Uint8Array([10, 70, 200]))
    expect(bundle!.bytes).toBeGreaterThan(128 * 96 * 3 * 3)
  } finally { bundle!.dispose() }
  await expect(regionalKernel(step('sceneRange', { first: 2, last: 4, maxSide: 128 }), input, () => video, () => true)).rejects.toThrow(/cancelled/)
  expect(requested).toEqual([2, 3, 4])
})

test('scene range and stage checks fail before allocation or hidden inference', async () => {
  expect(() => sceneGeometry(1920, 1080, 0, 116, 320, 117)).not.toThrow()
  for (const args of [[1920, 1080, 0, 117, 320, 117], [1920, 1080, 5, 5, 320, 117], [1920, 1080, 0, 499, 640, 500]] as const) expect(() => sceneGeometry(args[0], args[1], args[2], args[3], args[4], args[5])).toThrow()
  await expect(regionalKernel(step('regionalTiming'), { 'in:regions:data': { kind: 'regions', data: fixture() } }, () => undefined, () => false)).rejects.toThrow(/requires tracks/)
  expect(() => renderRegional(fixture(), 99, 'source', 24)).toThrow(/analyzed range/)
  expect(() => renderRegional(fixture(), 0, 'events', 24)).toThrow(/requires dense/)
})

test('regional payload cloning owns arrays and unsupported flow is not stationary motion', () => {
  const data = fixture(2), frame = data.scene.frames[0]!, pixels = frame.width * frame.height
  data.stage = 'motion'; data.sequence = { width: frame.width, height: frame.height, frameCount: 2, pairs: [{ frame: 0, grids: [], flow: { width: frame.width, height: frame.height, vectors: new Float32Array(pixels * 2), valid: new Uint8Array(pixels), roundTrip: new Float32Array(pixels), pan: { dx: 0, dy: 0, response: 0, used: false } } }] }
  data.sequence.pairs[0]!.flow.valid[1000] = 255
  const copy = clonePayload({ kind: 'regions', data })
  frame.data[0] = 0
  if (copy.kind !== 'regions') throw new Error('Missing copy')
  expect(copy.data.scene.frames[0]!.data).not.toBe(frame.data)
  const raster = renderRegional(data, 0, 'flow', 24)
  expect([...raster.pixels.subarray(1000 * 4, 1000 * 4 + 3)]).toEqual([245, 245, 245])
  expect(raster.pixels[0]).toBeLessThan(100)
})

test('motion-family diagnostics preserve support, show membership and leave missing histories unknown', () => {
  const data = fixture(6), { width, height } = data.scene.frames[0]!
  const tracks: RegionalTracks = { width, height, frameCount: 6, cellSize: 8, tracks: [], groups: [{ id: 4, trackIds: [] }, { id: 9, trackIds: [] }], frames: Array.from({ length: 5 }, (_, frame) => ({ frame, observations: frame === 2 ? [] : [{ id: 4, cells: [0], dx: frame, dy: -frame, spread: 0 }, { id: 9, cells: [15], dx: frame, dy: -frame, spread: 0 }] })) }
  data.stage = 'history'; data.tracks = tracks; data.families = groupMotionHistories(tracks)
  data.sequence = { width, height, frameCount: 6, pairs: tracks.frames.map(({ frame }) => ({ frame, flow: { width, height, vectors: new Float32Array(width * height * 2), valid: new Uint8Array(width * height), roundTrip: new Float32Array(width * height), pan: { dx: 0, dy: 0, response: 0, used: false } }, grids: [{ cellSize: 8, columns: width / 8, rows: height / 8, cells: Array.from({ length: width * height / 64 }, (_, id) => ({ x: id % (width / 8) * 8, y: Math.floor(id / (width / 8)) * 8, width: 8, height: 8, samples: 64, accepted: 64, coverage: 1, dx: 0, dy: 0, spread: 0, coherent: true })) }] })) }
  const source = renderRegional(data, 0, 'source', 8), family = renderRegional(data, 0, 'families', 8)
  expect(family.summary).toContain('2 original regions -> 1 motion families')
  expect(family.summary).toContain('Family 4: regions 4, 9; present 4, 9; dx 0.000, dy 0.000')
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4
    if (!(y < 8 && (x < 8 || x >= width - 8))) expect(family.pixels.subarray(offset, offset + 4)).toEqual(source.pixels.subarray(offset, offset + 4))
  }
  expect(renderRegional(data, 2, 'families', 8).pixels).toEqual(renderRegional(data, 2, 'source', 8).pixels)
  expect(renderRegional(data, 5, 'families', 8).summary).toContain('unobserved in this pair')
  const velocities = renderRegional(data, 0, 'velocities', 8)
  expect(velocities.summary).toContain('F4: regions 4, 9')
  expect(velocities.summary).toContain('2:?')
  expect(velocities.summary).toContain('3:3.000,-3.000')
  expect(() => renderRegional(data, 0, 'velocities', 8, 1)).toThrow(/outside/)
  const clone = clonePayload({ kind: 'regions', data })
  if (clone.kind !== 'regions') throw new Error('Missing clone')
  clone.data.families!.families[0]!.regionIds.push(99)
  expect(data.families.families[0]!.regionIds).toEqual([4, 9])
})

test('oversized ranges refuse before decoding or enumerating unbounded provenance', async () => {
  const doc = regionalLayersGraph(), clip = doc.nodes.find(n => n.id === 'n1')!, range = doc.nodes.find(n => n.id === 'nscene')!
  range.params.last = 1000000000
  doc.nodes = [clip, range]; doc.edges = doc.edges.filter(e => e.source === 'n1' && e.target === 'nscene')
  const info = { id: 'clip', name: 'oversized', width: 128, height: 96, frameCount: 1000000001, fps: 24, codec: 'test', decoder: 'software' as const, warnings: [] }
  const video = { info, close: () => {}, frameAt: () => { throw new Error('Must not decode') } } as unknown as VideoSource
  const cache = new ResultCache<Payload>(1024 ** 2)
  try {
    await expect(evaluateInspection({ doc, selected: 'nscene', port: 'out:regions:data', frame: 0, gain: 1, referenceAsset: 'clip' }, { cache, sources: new Map([['clip', video]]), cancelled: () => false, yield: async () => {} })).rejects.toThrow(/budget/)
  } finally { cache.clear() }
})

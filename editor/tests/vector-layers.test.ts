import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV, Mat, matFromArray, cvtColor, CV_8UC3, CV_32F, COLOR_BGR2RGBA } from '@banou/opencv-wasm'
import { estimateVectorCandidates, groupFrameVectors, poolVectorCandidates, type AnalysisFrame, type MotionCell } from 'cadence/regional'
import { ResultCache } from '../src/engine/cache'
import { evaluateGraph } from '../src/engine/evaluate'
import { connect, groupNodes, parseDocument, validateConnection } from '../src/engine/graph'
import { motionVectorsGraph } from '../src/engine/motion-prefab'
import { DEFAULT_RENDER_WORKERS, usesSceneAnalysis } from '../src/engine/parallel-render'
import { planGraph } from '../src/engine/plan'
import { explicitGraph } from '../src/engine/prefabs'
import { defaultParams, specFor } from '../src/engine/specs'
import type { NodeType, Params } from '../src/engine/types'
import { vectorLayersGraph } from '../src/engine/vector-prefab'
import type { VideoSource } from '../src/video/source'
import { runKernel } from '../src/worker/kernels'
import { clonePayload, image, parameterValue, payloadBundle, type Frame, type Payload } from '../src/worker/payload'
import type { RegionalData } from '../src/worker/regional-data'
import { regionalKernel } from '../src/worker/regional-kernels'
import { renderVectorPanels } from '../src/worker/vector-render'

beforeAll(async () => { await initOpenCV() }, 60000)

const step = (type: NodeType, params: Params = {}) => ({ key: 'test', node: { id: 'ntest', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 })
const input = (data: RegionalData): Record<string, Payload> => ({ 'in:regions:data': { kind: 'regions', data } })
const candidatesFixture = (): RegionalData => {
  const width = 40, height = 8
  const cells: MotionCell[] = Array.from({ length: 5 }, (_, id) => ({ x: id * 8, y: 0, width: 8, height: 8, dx: id === 0 ? null : 1, dy: id === 0 ? null : 0, accepted: id === 0 ? 0 : 32, coverage: id === 0 ? 0 : .5, spread: id === 0 ? null : id === 1 ? 4 : .1, coherent: id > 1 }))
  const frames = Array.from({ length: 2 }, () => ({ width, height, data: new Uint8Array(width * height * 3).fill(30) }))
  return { stage: 'vector-candidates', scene: { asset: 'clip', first: 7, last: 8, sourceWidth: width, sourceHeight: height, frames },
    sequence: { width, height, frameCount: 2, pairs: [{ frame: 0, flow: { width, height, vectors: new Float32Array(width * height * 2), valid: new Uint8Array(width * height), roundTrip: new Float32Array(width * height), pan: { dx: 0, dy: 0, response: 0, used: false } }, grids: [{ cellSize: 8, columns: 5, rows: 1, cells }] }] } }
}
const groupedFixture = (): RegionalData => {
  const data = candidatesFixture()
  return { ...data, stage: 'vector-groups', frameVectorGroups: groupFrameVectors(data.sequence!) }
}
const sceneFixture = (): RegionalData => {
  const width = 96, height = 64, count = 7, frames: AnalysisFrame[] = []
  for (let frame = 0; frame < count; frame++) {
    const data = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cellX = Math.floor((x + frame) / 8), cellY = Math.floor(y / 8)
      const value = 20 + (Math.imul(cellX + 37, 71) ^ Math.imul(cellY + 13, 37)) % 210
      data.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3)
    }
    frames.push({ width, height, data })
  }
  return { stage: 'scene', scene: { asset: 'clip', first: 0, last: count - 1, sourceWidth: width, sourceHeight: height, frames } }
}

test('direct prefab has a separate pipeline, four independent outputs and no completion dependency', () => {
  const doc = parseDocument(vectorLayersGraph())
  expect(explicitGraph('vectorLayers')).toEqual(vectorLayersGraph())
  expect(doc.nodes.filter(node => node.type === 'output')).toHaveLength(1)
  expect(doc.nodes.some(node => node.type.startsWith('regional'))).toBe(false)
  expect(doc.edges.filter(edge => edge.source === 'ntime').map(edge => edge.target)).toEqual(['ncandidateview', 'nview'])
  expect(specFor(doc.nodes.find(node => node.id === 'nview')!, doc).outputs.filter(port => port.type === 'frame').map(port => port.id)).toEqual(['out:frame:source', 'out:frame:candidates', 'out:frame:groups', 'out:frame:confidence'])
  expect(planGraph(doc, 'n5', null, 2, 'clip', 7).steps.filter(step => step.node.type === 'frameLayout').map(step => step.node.params.direction)).toEqual(['horizontal', 'horizontal', 'vertical'])
  expect(planGraph(doc, 'ncandidateview', 'out:frame:candidates', 2, 'clip', 7).steps.some(step => step.node.type === 'vectorGroups')).toBe(false)
  expect(validateConnection(doc, { source: 'nscene', sourceHandle: 'out:regions:data', target: 'ngroups', targetHandle: 'in:regions:data' })).toMatch(/stages must match/)
  expect(usesSceneAnalysis(doc, 'n5')).toBe(true)
  expect(DEFAULT_RENDER_WORKERS).toBe(4)
  expect(defaultParams('vectorCandidates')).toEqual({ cellSize: 8, window: 25, levels: 4, roundTrip: 1.5, textureFraction: .005 })
  expect(defaultParams('vectorGroups')).toEqual({ tolerance: .75, splitSubtleMotion: true })
  expect(specFor(doc.nodes.find(node => node.id === 'ngroups')!, doc).version).toBe(5)
  expect(specFor(doc.nodes.find(node => node.id === 'ngroups')!, doc).title).toBe('Frame Velocity Groups')
})

test('candidate rendering retains weak arrows, distinguishes unknown support and does not invent groups', () => {
  const data = candidatesFixture(), original = structuredClone(data), rendered = renderVectorPanels(data, 7)
  expect(rendered.panels.groups).toEqual(rendered.panels.source)
  expect(rendered.panels.candidates).not.toEqual(rendered.panels.source)
  const pixel = (name: keyof typeof rendered.panels, x: number, y = 4) => rendered.panels[name].slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4)
  expect(pixel('candidates', 4)).toEqual(pixel('source', 4))
  expect(pixel('candidates', 13)).not.toEqual(pixel('source', 13))
  expect(pixel('confidence', 4)).not.toEqual(pixel('confidence', 12))
  expect(pixel('confidence', 12)).not.toEqual(pixel('confidence', 20))
  expect(rendered.summary).toContain('Candidate vectors: 4; mixed/weak 1')
  expect(rendered.summary).toContain('Motion-group panel is unpainted before grouping')
  expect(data).toEqual(original)
})

test('saved direct-motion graphs retire history controls and wires while preserving velocity tolerance', () => {
  const original = vectorLayersGraph()
  original.nodes.find(node => node.id === 'ngroups')!.params = { tolerance: .5, minimumOverlap: 4, modeRadius: .75, minimumModeCells: 4 }
  for (const control of ['minimumOverlap', 'modeRadius', 'minimumModeCells']) original.edges.push({ id: `eold${control}`, source: 'ntime', sourceHandle: 'out:scalar:index', target: 'ngroups', targetHandle: `param:${control}` })
  const restored = parseDocument(original)
  expect(restored.nodes.find(node => node.id === 'ngroups')!.params).toEqual({ tolerance: .5, splitSubtleMotion: true })
  expect(restored.edges.some(edge => edge.id.startsWith('eold'))).toBe(false)
  const nested = groupNodes(vectorLayersGraph(), undefined, ['ngroups'], 'Direct groups', 'gdirect', 'ndirect')
  const node = nested.definitions![0]!.graph.nodes.find(node => node.type === 'vectorGroups')!
  node.params.modeRadius = 0; node.params.minimumOverlap = 8; node.params.minimumModeCells = 2; node.params.splitSubtleMotion = false
  const reopened = parseDocument(JSON.parse(JSON.stringify(nested)))
  expect(reopened.definitions![0]!.graph.nodes.find(node => node.type === 'vectorGroups')!.params).toEqual({ ...defaultParams('vectorGroups'), splitSubtleMotion: false })
  expect(original.nodes.find(node => node.id === 'ngroups')!.params.minimumOverlap).toBe(4)
})

test('subtle-motion switch retains typed wiring through a saved custom-node scope', () => {
  const original = vectorLayersGraph()
  original.nodes.push({ id: 'nsubtle', type: 'boolean', params: { value: false }, position: { x: 1000, y: 500 } })
  const wire = { source: 'nsubtle', sourceHandle: 'out:boolean:value', target: 'ngroups', targetHandle: 'param:splitSubtleMotion' }
  expect(validateConnection(original, wire)).toBeNull()
  const wired = connect(original, wire)
  const nested = groupNodes(wired, undefined, ['nsubtle', 'ngroups'], 'Frame groups', 'gsubtle', 'nsubtlegroup')
  const restored = parseDocument(JSON.parse(JSON.stringify(nested)))
  expect(restored.definitions![0]!.graph.edges).toContainEqual(expect.objectContaining(wire))
  const plan = planGraph(restored, 'nview', 'out:frame:groups', 0, 'clip', 7)
  expect(plan.steps.some(step => step.node.type === 'boolean' && step.node.params.value === false)).toBe(true)
})

test('group inspector paints every candidate including mixed cells without a temporal history filter', () => {
  const data = groupedFixture(), original = structuredClone(data), rendered = renderVectorPanels(data, 7)
  const at = (pixels: Uint8Array, x: number) => pixels.slice((4 * 40 + x) * 4, (4 * 40 + x) * 4 + 4)
  expect(new Set([4, 12, 20, 28, 36].map(x => at(rendered.panels.confidence, x).join(','))).size).toBe(3)
  expect(at(rendered.panels.groups, 4)).toEqual(at(rendered.panels.source, 4))
  for (let x = 8; x < 40; x++) expect(at(rendered.panels.groups, x)).not.toEqual(at(rendered.panels.source, x))
  expect(rendered.summary).toContain('unknown 1; mixed assigned 1; coherent assigned 3')
  expect(rendered.summary).toContain('Candidate cells: 4; grouped cells: 4; temporal filtering: none')
  expect(rendered.summary).toContain('1 frame-local motion groups; maximum radius 0.75')
  expect(rendered.summary).toContain('Subtle motion separation: enabled; candidate support preserved')
  expect(rendered.summary).not.toMatch(/ambiguous|unassigned candidate|minimum shared/)
  expect(data).toEqual(original)
})

test('group inspector refuses stale history data and missing current-frame assignments', () => {
  const data = groupedFixture()
  expect(() => renderVectorPanels({ ...data, frameVectorGroups: undefined }, 7)).toThrow(/recompute legacy/)
  data.frameVectorGroups!.frames[0]!.labels[1] = -1
  expect(() => renderVectorPanels(data, 7)).toThrow(/preserve every candidate/)
})

test('last frame has no fabricated motion and all four panel buffers are independent', () => {
  const data = groupedFixture(), rendered = renderVectorPanels(data, 8)
  for (const panel of Object.values(rendered.panels)) expect(panel).toEqual(rendered.panels.source)
  expect(rendered.summary).toContain('final frame, no outgoing pair')
  rendered.panels.source[0] = 255
  for (const name of ['candidates', 'groups', 'confidence'] as const) expect(rendered.panels[name][0]).toBe(30)
  expect(() => renderVectorPanels(data, 9)).toThrow(/analyzed range/)
  expect(() => renderVectorPanels({ ...data, stage: 'scene' }, 7)).toThrow(/requires vector candidates/)
  expect(() => renderVectorPanels(data, 7, undefined, Infinity)).toThrow(/display gain/)
})

test('motion group colors do not repeat every six IDs', () => {
  const data = groupedFixture(), frame = data.frameVectorGroups!.frames[0]!
  frame.labels[1] = 0; frame.labels[2] = 6
  data.sequence!.pairs[0]!.grids[0]!.cells[1]!.coherent = true; frame.confidence[1] = 2
  const { panels } = renderVectorPanels(data, 7)
  const color = (x: number) => panels.groups.slice((4 * 40 + x) * 4, (4 * 40 + x) * 4 + 3)
  expect(color(12)).not.toEqual(color(20))
})

test('four direct-motion outputs share one original decode at independent display resolution', async () => {
  const data = groupedFixture(), rgba = new Uint8Array(80 * 16 * 4)
  for (let i = 0; i < 80 * 16; i++) rgba.set([i % 2 ? 200 : 10, 80, 25, 255], i * 4)
  data.scene.sourceWidth = 80; data.scene.sourceHeight = 16
  const requested: number[] = [], closed: number[] = []
  const video = { frameAt: async (index: number) => { requested.push(index); return { displayWidth: 80, displayHeight: 16, visibleRect: null, copyTo: async (out: Uint8Array) => out.set(rgba), close: () => closed.push(index) } } } as unknown as VideoSource
  const bundle = await regionalKernel(step('vectorInspect', { frame: 7 }), input(data), () => video, () => false)
  try {
    for (const key of ['source', 'candidates', 'groups', 'confidence']) {
      const output = image(bundle!.outputs[`out:frame:${key}`])
      expect([output.mat.cols, output.mat.rows]).toEqual([80, 16])
    }
    const source = image(bundle!.outputs['out:frame:source'])
    for (let i = 0; i < rgba.length; i++) expect(source.mat.data32F[i]).toBeCloseTo(rgba[i]! / 255, 6)
    expect(requested).toEqual([7]); expect(closed).toEqual([7])
  } finally { bundle!.dispose() }
  await expect(regionalKernel(step('vectorInspect', { frame: 7 }), input({ ...data, stage: 'scene' }), () => video, () => false)).rejects.toThrow(/requires vector candidates/)
  expect(requested).toEqual([7])
})

test('native candidate and direct grouping stages use the shared core without regional completion', async () => {
  const data = sceneFixture(), original = structuredClone(data)
  const candidateBundle = await regionalKernel(step('vectorCandidates'), input(data), () => undefined, () => false)
  try {
    const candidate = candidateBundle!.outputs['out:regions:data']!
    if (candidate.kind !== 'regions') throw new Error('Expected candidate data')
    expect(candidate.data.sequence!.pairs).toHaveLength(6)
    const expected = estimateVectorCandidates(data.scene.frames[0]!, data.scene.frames[1]!)
    expect(candidate.data.sequence!.pairs[0]!.flow).toEqual(expected)
    expect(candidate.data.sequence!.pairs[0]!.grids).toEqual([poolVectorCandidates(expected, 8)])
    const groupedBundle = await regionalKernel(step('vectorGroups'), input(candidate.data), () => undefined, () => false)
    try {
      const grouped = groupedBundle!.outputs['out:regions:data']!
      if (grouped.kind !== 'regions') throw new Error('Expected grouped data')
      expect(grouped.data.frameVectorGroups).toEqual(groupFrameVectors(candidate.data.sequence!))
      expect(grouped.data.tracks).toBeUndefined(); expect(grouped.data.families).toBeUndefined(); expect(grouped.data.completion).toBeUndefined()
    } finally { groupedBundle!.dispose() }
  } finally { candidateBundle!.dispose() }
  expect(data).toEqual(original)
  await expect(regionalKernel(step('vectorCandidates'), input(data), () => undefined, () => true)).rejects.toThrow(/cancelled/)
  await expect(regionalKernel(step('vectorGroups'), input(data), () => undefined, () => false)).rejects.toThrow(/requires vector-candidates/)
})

test('candidate estimator matches the original Regional motion vectors graph on identical analysis pixels', async () => {
  const data = sceneFixture(), a = data.scene.frames[0]!, b = data.scene.frames[1]!
  for (const frame of [a, b]) for (let p = 0; p < frame.data.length; p += 3) {
    frame.data[p + 1] = Math.round(frame.data[p + 1]! * .7)
    frame.data[p + 2] = 255 - frame.data[p + 2]!
  }
  const frames: Frame[] = [a, b].map(frame => {
    using bgr = matFromArray(frame.height, frame.width, CV_8UC3, frame.data), rgba = new Mat()
    cvtColor(bgr, rgba, COLOR_BGR2RGBA)
    const mat = new Mat(); rgba.convertTo(mat, CV_32F, 1 / 255)
    return { kind: 'frame', mat, range: 'unit' }
  })
  const doc = motionVectorsGraph(), cache = new ResultCache<Payload>(32 * 1024 ** 2)
  doc.nodes.find(node => node.id === 'ncell')!.params.value = 8
  const info = { id: 'clip', name: 'fixture', width: a.width, height: a.height, frameCount: 2, fps: 24, codec: 'test', decoder: 'software' as const, warnings: [] }
  const evaluate = (selected: string, port: string) => evaluateGraph(doc, selected, port, 0, [], {
    cache, assets: { clip: info }, sourceId: 'clip', parameter: parameterValue, cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {},
    kernel: async (request, inputs) => {
      if (request.node.type === 'clip') return payloadBundle({ 'out:video:clip': { kind: 'video', asset: 'clip', info } })
      if (request.node.type === 'readFrame') return payloadBundle({ 'out:frame:image': clonePayload(frames[Number(request.node.params.frame)]!) })
      return runKernel(request, inputs, undefined, () => false, doc)
    },
  })
  try {
    const expected = estimateVectorCandidates(a, b), pooled = poolVectorCandidates(expected, 8)
    const forward = await evaluate('nforward', 'field'), accepted = await evaluate('naccepted', 'out:frame:image')
    const grid = await evaluate('ngrid', 'out:flow:field'), support = await evaluate('ngrid', 'out:frame:image')
    try {
      if (forward.value.kind !== 'flow' || grid.value.kind !== 'flow') throw new Error('Expected flow fields')
      expect(forward.value.mat.data32F).toEqual(expected.vectors)
      const mask = image(accepted.value).mat.data32F, cells = image(support.value).mat.data32F, vectors = grid.value.mat.data32F
      expect(Uint8Array.from(expected.valid, (_, p) => mask[p * 4]! > .5 ? 255 : 0)).toEqual(expected.valid)
      for (const cell of pooled.cells) {
        const p = cell.y * a.width + cell.x
        expect(cells[p * 4]).toBe(cell.dx === null ? 0 : 1)
        if (cell.dx !== null) {
          expect(vectors[p * 2]).toBe(Math.fround(cell.dx))
          expect(vectors[p * 2 + 1]).toBe(Math.fround(cell.dy!))
        }
      }
    } finally { forward.release(); accepted.release(); grid.release(); support.release() }
  } finally { cache.clear(); frames.forEach(frame => frame.mat.delete()) }
})

test('direct analysis caches across scrub order and display edits; velocity edits reuse candidates', async () => {
  const doc = vectorLayersGraph(), data = sceneFixture(), calls = new Map<string, number>(), cache = new ResultCache<Payload>(32 * 1024 ** 2)
  const info = { id: 'clip', name: 'fixture', width: 96, height: 64, frameCount: 7, fps: 24, codec: 'test', decoder: 'software' as const, warnings: [] }
  const evaluate = (selected: string, time: number, port: string | null = null) => evaluateGraph(doc, selected, port, time, [], {
    cache, assets: { clip: info }, sourceId: 'clip', parameter: parameterValue, cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {},
    kernel: async (request, inputs) => {
      calls.set(request.node.type, (calls.get(request.node.type) ?? 0) + 1)
      if (request.node.type === 'clip') return payloadBundle({ 'out:video:clip': { kind: 'video', asset: 'clip', info } })
      if (request.node.type === 'sceneRange') return payloadBundle({ 'out:regions:data': { kind: 'regions', data } })
      return runKernel(request, inputs, undefined, () => false, doc)
    },
  })
  try {
    for (const frame of [4, 0, 2, 6, 1]) {
      const result = await evaluate('n5', frame)
      try { expect([image(result.value).mat.cols, image(result.value).mat.rows]).toEqual([192, 128]) } finally { result.release() }
    }
    for (const type of ['sceneRange', 'vectorCandidates', 'vectorGroups']) expect(calls.get(type)).toBe(1)
    expect([...calls.keys()].some(type => type.startsWith('regional'))).toBe(false)
    doc.nodes.find(node => node.id === 'nview')!.params.gain = 5
    const display = await evaluate('nview', 2, 'out:frame:candidates'); display.release()
    expect(calls.get('vectorCandidates')).toBe(1); expect(calls.get('vectorGroups')).toBe(1)
    doc.nodes.find(node => node.id === 'ngroups')!.params.tolerance = .5
    const groups = await evaluate('nview', 2, 'out:frame:groups'); groups.release()
    expect(calls.get('vectorCandidates')).toBe(1); expect(calls.get('vectorGroups')).toBe(2)
    doc.nodes.find(node => node.id === 'ngroups')!.params.splitSubtleMotion = false
    const summary = await evaluate('nview', 2, 'out:string:summary')
    try {
      expect(summary.value.kind).toBe('string')
      if (summary.value.kind === 'string') {
        expect(summary.value.value).toContain('temporal filtering: none')
        expect(summary.value.value).toContain('frame-local motion groups; maximum radius 0.5')
        expect(summary.value.value).toContain('Subtle motion separation: disabled; candidate support preserved')
      }
    } finally { summary.release() }
    expect(calls.get('vectorCandidates')).toBe(1); expect(calls.get('vectorGroups')).toBe(3)
    doc.nodes.find(node => node.id === 'ncandidates')!.params.cellSize = 12
    const candidates = await evaluate('ncandidateview', 2, 'out:frame:candidates'); candidates.release()
    expect(calls.get('vectorCandidates')).toBe(2); expect(calls.get('vectorGroups')).toBe(3)
  } finally { cache.clear() }
})

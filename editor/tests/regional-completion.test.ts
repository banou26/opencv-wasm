import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV } from '@banou/opencv-wasm'
import { completeMotionSupport, type MotionCompletionOptions, type RegionalMotionSequence } from 'cadence/regional'
import { defaultParams, specFor, validateParams } from '../src/engine/specs'
import { groupNodes, parseDocument } from '../src/engine/graph'
import { regionalLayersGraph } from '../src/engine/regional-prefab'
import { regionalKernel } from '../src/worker/regional-kernels'
import { regionalSummary, type RegionalData } from '../src/worker/regional-data'
import { renderCompletionPanels, renderRegional } from '../src/worker/regional-render'
import { runKernel, displayPixels } from '../src/worker/kernels'
import { image } from '../src/worker/payload'
import { planGraph } from '../src/engine/plan'
import type { Bundle, GraphDocument } from '../src/engine/types'
import type { Payload } from '../src/worker/payload'

beforeAll(async () => { await initOpenCV() }, 60000)

const fixture = (frameCount = 3): RegionalData => {
  const width = 72, height = 40, cellSize = 8, columns = 9, rows = 5, seeds = [20, 24]
  const pairs = Array.from({ length: frameCount - 1 }, (_, frame) => frame)
  const sequence: RegionalMotionSequence = { width, height, frameCount, pairs: pairs.map(frame => ({ frame,
    flow: { width, height, vectors: new Float32Array(width * height * 2), valid: new Uint8Array(width * height), roundTrip: new Float32Array(width * height), pan: { dx: 0, dy: 0, response: 0, used: false } },
    grids: [{ cellSize, columns, rows, cells: Array.from({ length: columns * rows }, (_, id) => ({
      x: id % columns * cellSize, y: Math.floor(id / columns) * cellSize, width: cellSize, height: cellSize, samples: 64,
      accepted: seeds.includes(id) ? 64 : 0, coverage: seeds.includes(id) ? 1 : 0,
      dx: seeds.includes(id) ? 0 : null, dy: seeds.includes(id) ? 0 : null, spread: seeds.includes(id) ? 0 : null, coherent: seeds.includes(id),
    })) }],
  })) }
  return { stage: 'history', sequence,
    tracks: { width, height, cellSize, frameCount, tracks: [], groups: [{ id: 1, trackIds: [] }],
      frames: pairs.map(frame => ({ frame, observations: [{ id: 1, cells: [...seeds], dx: 0, dy: 0, spread: 0 }] })) },
    scene: { asset: 'clip', first: 10, last: 9 + frameCount, sourceWidth: width, sourceHeight: height, frames: Array.from({ length: frameCount }, () => ({ width, height, data: new Uint8Array(width * height * 3).fill(80) })) },
    families: { width, height, cellSize, frameCount, options: { tolerance: .75, minimumOverlap: 4, proximityWeight: 0 }, comparisons: [], families: [{ id: 1, regionIds: [1] }],
      frames: pairs.map(frame => ({ frame, observations: [{ id: 1, regionIds: [1], cells: [...seeds], dx: 0, dy: 0, spread: 0 }] })) },
  }
}
const step = (options: MotionCompletionOptions = {}) => ({ key: 'completion', node: { id: 'ncomplete', type: 'regionalComplete' as const, params: { ...defaultParams('regionalComplete'), ...options }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 })

test('four completion frame ports stay independently inspectable and layouts reproduce legacy pixels', async () => {
  const source = fixture(), data: RegionalData = { ...source, stage: 'completion', completion: completeMotionSupport(source.sequence!, source.families!) }
  const doc = regionalLayersGraph(), node = doc.nodes.find(node => node.id === 'ncompletionview')!
  const ports = specFor(node, doc).outputs
  expect(ports.map(port => port.id)).toEqual(['out:frame:source', 'out:frame:measured', 'out:frame:completed', 'out:frame:provenance', 'out:string:summary'])
  for (const port of ports) expect(planGraph(doc, node.id, port.id, 10, 'clip', 13).target.port).toBe(port.id)
  const before = structuredClone(data), held: Bundle<Payload>[] = []
  try {
    for (const frame of [10, 12]) {
      const bundle = await regionalKernel({ key: 'panels', node: { ...node, params: { ...node.params, frame, displayMaxSide: 0 } }, frame, inputs: {} }, { 'in:regions:data': { kind: 'regions', data } }, () => { throw new Error('Analysis display must not decode') }, () => false)
      held.push(bundle!)
      const panels = renderCompletionPanels(data, frame)
      for (const key of ['source', 'measured', 'completed', 'provenance'] as const) {
        const output = image(bundle!.outputs[`out:frame:${key}`])
        expect([output.mat.cols, output.mat.rows]).toEqual([72, 40])
        expect(displayPixels(output, 1)).toEqual(panels.panels[key])
      }
      const join = async (a: Payload, b: Payload, direction: string) => {
        const result = await runKernel({ key: direction, node: { id: direction, type: 'frameLayout', params: { direction }, position: { x: 0, y: 0 } }, frame, inputs: {} }, { 'in:frame:a': a, 'in:frame:b': b }, undefined, () => false)
        held.push(result)
        return result.outputs['out:frame:image']!
      }
      const top = await join(bundle!.outputs['out:frame:source']!, bundle!.outputs['out:frame:measured']!, 'horizontal')
      const bottom = await join(bundle!.outputs['out:frame:completed']!, bundle!.outputs['out:frame:provenance']!, 'horizontal')
      const combined = image(await join(top, bottom, 'vertical')), legacy = renderRegional(data, frame, 'completion', 8)
      expect([combined.mat.cols, combined.mat.rows]).toEqual([legacy.width, legacy.height])
      expect(displayPixels(combined, 1)).toEqual(legacy.pixels)
      expect(bundle!.outputs['out:string:summary']).toEqual({ kind: 'string', value: panels.summary })
      expect(bundle!.bytes).toBe(72 * 40 * 4 * 4 * 4)
    }
    expect(data).toEqual(before)
  } finally { held.reverse().forEach(bundle => bundle.dispose()) }
})

test('saved combined completion inspectors retain their exact old port and graph topology', () => {
  const legacy: GraphDocument = { version: 1, definitions: [], nodes: [
    { id: 'nold', type: 'regionalInspect', params: { ...defaultParams('regionalInspect'), view: 'completion' }, position: { x: 0, y: 0 } },
    { id: 'nout', type: 'output', params: {}, position: { x: 400, y: 0 } },
  ], edges: [{ id: 'e:nout:in:frame:image', source: 'nold', sourceHandle: 'out:frame:image', target: 'nout', targetHandle: 'in:frame:image' }] }
  const restored = parseDocument(JSON.parse(JSON.stringify(legacy)))
  expect(restored).toEqual(legacy)
  expect(specFor(restored.nodes[0]!, restored).outputs.map(port => port.id)).toEqual(['out:frame:image', 'out:string:summary'])
})

test('completion controls use bounded whole fine-grid distances', () => {
  expect(defaultParams('regionalComplete')).toEqual({ maxHoleDistance: 6, maxBorderDistance: 6, competitorClearance: 2, fillIsolated: true, bridgeTemporal: true })
  for (const key of ['maxHoleDistance', 'maxBorderDistance', 'competitorClearance']) {
    for (const value of [0, 32]) expect(validateParams('regionalComplete', { ...defaultParams('regionalComplete'), [key]: value })).toBeNull()
    for (const value of [-1, .5, 33, NaN]) expect(validateParams('regionalComplete', { ...defaultParams('regionalComplete'), [key]: value })).not.toBeNull()
  }
  const doc = regionalLayersGraph(), spec = specFor(doc.nodes.find(node => node.id === 'ncomplete')!, doc)
  for (const key of ['fillIsolated', 'bridgeTemporal']) {
    expect(spec.inputs.find(port => port.parameter === key)?.type).toBe('boolean')
    for (const value of [true, false]) expect(validateParams('regionalComplete', { ...defaultParams('regionalComplete'), [key]: value })).toBeNull()
    for (const value of [0, 1, 'true']) expect(validateParams('regionalComplete', { ...defaultParams('regionalComplete'), [key]: value })).not.toBeNull()
  }
})

test('saved root and nested completion nodes gain missing cleanup toggles without changing explicit settings or outputs', () => {
  for (const nested of [false, true]) {
    let doc = regionalLayersGraph()
    if (nested) doc = groupNodes(doc, undefined, ['ncomplete'], 'Completion', 'gcompletion', 'ncompletiongroup')
    const body = nested ? doc.definitions!.find(definition => definition.id === 'gcompletion')!.graph : doc
    const node = body.nodes.find(node => node.id === 'ncomplete')!
    delete node.params.fillIsolated; delete node.params.bridgeTemporal
    node.params.maxHoleDistance = 4
    const restored = parseDocument(JSON.parse(JSON.stringify(doc)))
    const restoredBody = nested ? restored.definitions!.find(definition => definition.id === 'gcompletion')!.graph : restored
    expect(restoredBody.nodes.find(node => node.id === 'ncomplete')!.params).toEqual({ ...defaultParams('regionalComplete'), maxHoleDistance: 4 })
    expect(restored.nodes.filter(node => node.type === 'output').map(node => node.id)).toEqual(['n5'])
    expect(restored.edges).toEqual(doc.edges)
    node.params.fillIsolated = false
    const explicit = parseDocument(JSON.parse(JSON.stringify(doc)))
    const explicitBody = nested ? explicit.definitions!.find(definition => definition.id === 'gcompletion')!.graph : explicit
    expect(explicitBody.nodes.find(node => node.id === 'ncomplete')!.params).toMatchObject({ fillIsolated: false, bridgeTemporal: true, maxHoleDistance: 4 })
  }
})

test('completion kernel checkpoints per pair, matches shared core and preserves original evidence', async () => {
  const data = fixture(), before = structuredClone(data)
  for (const options of [{}, { maxBorderDistance: 0 }, { maxHoleDistance: 0, maxBorderDistance: 0, competitorClearance: 4 }, { fillIsolated: false }, { bridgeTemporal: false }, { fillIsolated: false, bridgeTemporal: false }]) {
    for (const stage of ['history', 'timing'] as const) {
      const input = { ...data, stage, ...(stage === 'timing' ? { analysis: { frames: [], groups: [] } } : {}) }
      const bundle = await regionalKernel(step(options), { 'in:regions:data': { kind: 'regions', data: input } }, () => { throw new Error('Completion must not decode source video') }, () => false)
      try {
        const value = bundle!.outputs['out:regions:data']!
        if (value.kind !== 'regions') throw new Error('Missing completion')
        expect(value.data.completion).toEqual(completeMotionSupport(data.sequence!, data.families!, options))
        expect(value.data.stage).toBe('completion')
        expect(value.data.scene).toBe(data.scene); expect(value.data.sequence).toBe(data.sequence); expect(value.data.families).toBe(data.families)
        expect(value.data.tracks).toBe(data.tracks)
        expect(value.data.analysis).toBe(input.analysis)
        expect(regionalSummary(value.data)).toContain('Support completion (cell-pair counts):')
      } finally { bundle!.dispose() }
    }
  }
  let checkpoints = 0
  await expect(regionalKernel(step(), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => ++checkpoints > 1)).rejects.toThrow(/cancelled/)
  expect(checkpoints).toBe(2)
  expect(data).toEqual(before)
  await expect(regionalKernel(step(), { 'in:regions:data': { kind: 'regions', data: { ...data, stage: 'tracks' } } }, () => undefined, () => false)).rejects.toThrow(/requires motion-history/)
  await expect(regionalKernel(step(), { 'in:regions:data': { kind: 'regions', data: { ...data, stage: 'timing', families: undefined } } }, () => undefined, () => false)).rejects.toThrow(/requires motion-history/)
})

test('cleanup provenance has distinct colors and counts without changing measured support', () => {
  const data = fixture(), completion = completeMotionSupport(data.sequence!, data.families!, { maxHoleDistance: 0, maxBorderDistance: 0, fillIsolated: false, bridgeTemporal: false })
  const frame = completion.frames[0]!, observation = frame.observations[0]!
  observation.isolatedCells = [21]; observation.temporalCells = [23]
  frame.counts.isolated = 1; frame.counts.temporal = 1; frame.counts.unknown -= 2
  const raster = renderRegional({ ...data, completion }, 10, 'completion', 8)
  const pixel = (panel: number, cell: number) => {
    const x = panel % 2 * 72 + cell % 9 * 8 + 4, y = Math.floor(panel / 2) * 40 + Math.floor(cell / 9) * 8 + 4
    return [...raster.pixels.subarray((y * raster.width + x) * 4, (y * raster.width + x + 1) * 4)]
  }
  expect(pixel(1, 21)).toEqual([80, 80, 80, 255]); expect(pixel(1, 23)).toEqual([80, 80, 80, 255])
  expect(pixel(2, 21)).toEqual(pixel(1, 20)); expect(pixel(2, 23)).toEqual(pixel(1, 20))
  expect(pixel(3, 21)).toEqual([176, 96, 134, 255])
  expect(pixel(3, 23)).toEqual([74, 135, 179, 255])
  expect(raster.summary).toContain('isolated 1; temporal 1')
  expect(raster.summary).toContain('pink isolated holes; blue temporal holes')
  expect(regionalSummary({ ...data, completion })).toContain('isolated 1; temporal 1')
  expect(data.families!.frames[0]!.observations[0]!.cells).toEqual([20, 24])
})

test('temporal cleanup uses both adjacent pairs even when geometric completion is disabled', async () => {
  const data = fixture(4)
  for (const frame of [0, 2]) {
    Object.assign(data.sequence!.pairs[frame]!.grids[0]!.cells[22]!, { accepted: 64, coverage: 1, coherent: true, dx: 0, dy: 0, spread: 0 })
    data.families!.frames[frame]!.observations[0]!.cells.push(22)
  }
  const original = structuredClone(data)
  for (const bridgeTemporal of [true, false]) {
    const options = { maxHoleDistance: 0, maxBorderDistance: 0, fillIsolated: false, bridgeTemporal }
    const bundle = await regionalKernel(step(options), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => false)
    try {
      const value = bundle!.outputs['out:regions:data']!
      if (value.kind !== 'regions') throw new Error('Missing completion')
      expect(value.data.completion).toEqual(completeMotionSupport(data.sequence!, data.families!, options))
      expect(value.data.completion!.frames[1]!.observations[0]!.temporalCells).toEqual(bridgeTemporal ? [22] : [])
      expect(value.data.completion!.frames[0]!.counts.temporal).toBe(0)
      expect(value.data.completion!.frames[2]!.counts.temporal).toBe(0)
    } finally { bundle!.dispose() }
  }
  expect(data).toEqual(original)
})

test('temporal cleanup bridges longer and leading gaps only with sufficient full-scene witnesses', async () => {
  const cases = [
    { witnesses: [0, 3], repaired: [1, 2] }, { witnesses: [2, 3], repaired: [0, 1] },
    { witnesses: [3], repaired: [] }, { witnesses: [0, 1], repaired: [] },
  ]
  for (const { witnesses, repaired } of cases) {
    const data = fixture(5)
    for (const frame of witnesses) {
      Object.assign(data.sequence!.pairs[frame]!.grids[0]!.cells[22]!, { accepted: 64, coverage: 1, coherent: true, dx: 0, dy: 0, spread: 0 })
      data.families!.frames[frame]!.observations[0]!.cells.push(22)
    }
    const original = structuredClone(data), options = { maxHoleDistance: 0, maxBorderDistance: 0, fillIsolated: false }
    const bundle = await regionalKernel(step(options), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => false)
    try {
      const value = bundle!.outputs['out:regions:data']!
      if (value.kind !== 'regions') throw new Error('Missing completion')
      expect(value.data.completion).toEqual(completeMotionSupport(data.sequence!, data.families!, options))
      expect(value.data.completion!.frames.filter(frame => frame.observations[0]!.temporalCells.includes(22)).map(frame => frame.frame)).toEqual(repaired)
      expect(value.data.completion!.frames).toHaveLength(4)
    } finally { bundle!.dispose() }
    expect(data).toEqual(original)
  }
})

test('completion checkpoints preparation passes without exposing null checkpoints as frames', async () => {
  const data = fixture(5), original = structuredClone(data)
  let checkpoints = 0
  for (const bridgeTemporal of [true, false]) {
    checkpoints = 0
    const bundle = await regionalKernel(step({ bridgeTemporal }), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => { checkpoints++; return false })
    try {
      const value = bundle!.outputs['out:regions:data']!
      if (value.kind !== 'regions') throw new Error('Missing completion')
      expect(value.data.completion!.frames.map(frame => frame.frame)).toEqual([0, 1, 2, 3])
      expect(checkpoints).toBe(bridgeTemporal ? 17 : 9)
    } finally { bundle!.dispose() }
  }
  checkpoints = 0
  await expect(regionalKernel(step(), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => ++checkpoints === 2)).rejects.toThrow(/cancelled/)
  expect(checkpoints).toBe(2)
  expect(data).toEqual(original)
})

test('isolated cleanup is independently switchable and preserves original measurements', async () => {
  const data = fixture(), surround = [13, 21, 23, 31]
  for (const pair of data.sequence!.pairs) for (const cell of surround) Object.assign(pair.grids[0]!.cells[cell]!, { accepted: 64, coverage: 1, coherent: true, dx: 0, dy: 0, spread: 0 })
  for (const frame of data.families!.frames) frame.observations[0]!.cells.push(...surround)
  const original = structuredClone(data)
  for (const fillIsolated of [true, false]) {
    const options = { maxHoleDistance: 0, maxBorderDistance: 0, fillIsolated, bridgeTemporal: false }
    const bundle = await regionalKernel(step(options), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => false)
    try {
      const value = bundle!.outputs['out:regions:data']!
      if (value.kind !== 'regions') throw new Error('Missing completion')
      expect(value.data.completion).toEqual(completeMotionSupport(data.sequence!, data.families!, options))
      expect(value.data.completion!.frames[0]!.observations[0]!.isolatedCells).toEqual(fillIsolated ? [22] : [])
      expect(value.data.completion!.frames[0]!.observations[0]!.measuredCells).toEqual([13, 20, 21, 23, 24, 31])
    } finally { bundle!.dispose() }
  }
  expect(data).toEqual(original)
})

test('completion raster separates measured and inferred support without painting unknown cells or changing other views', () => {
  const data = fixture(), completion = completeMotionSupport(data.sequence!, data.families!, { maxBorderDistance: 0 })
  expect(completion.frames[0]!.observations[0]!.holeCells).toEqual([21, 22, 23])
  const completed = { ...data, completion }, before = structuredClone(completed)
  const raster = renderRegional(completed, 10, 'completion', 8)
  expect([raster.width, raster.height]).toEqual([144, 80])
  expect(raster.summary).toContain('measured 2; motion-associated 0; inferred holes 3; inferred border 0')
  expect(raster.summary).toContain('Inferred support is not measured family membership, recovered pixels or a pixel-accurate silhouette')
  const pixel = (panel: number, cell: number) => {
    const x = panel % 2 * 72 + cell % 9 * 8 + 4, y = Math.floor(panel / 2) * 40 + Math.floor(cell / 9) * 8 + 4
    return [...raster.pixels.subarray((y * raster.width + x) * 4, (y * raster.width + x + 1) * 4)]
  }
  expect(pixel(0, 21)).toEqual([80, 80, 80, 255])
  expect(pixel(1, 21)).toEqual(pixel(0, 21))
  expect(pixel(2, 21)).toEqual(pixel(1, 20))
  expect(pixel(3, 20)).toEqual([122, 122, 131, 255])
  expect(pixel(3, 21)).toEqual([176, 139, 75, 255])
  for (let panel = 0; panel < 4; panel++) expect(pixel(panel, 0)).toEqual([80, 80, 80, 255])
  const final = renderRegional(completed, 12, 'completion', 8)
  expect(final.summary).toContain('final frame, no outgoing pair')
  expect(final.summary).toContain('No completion evidence for this frame.')
  expect(final.pixels.every((value, index) => value === (index % 4 === 3 ? 255 : 80))).toBe(true)
  for (const view of ['source', 'flow', 'validity', 'cells', 'families'] as const) expect(renderRegional(completed, 10, view, 8)).toEqual(renderRegional(data, 10, view, 8))
  expect(completed).toEqual(before)
  expect(() => renderRegional(data, 10, 'completion', 8)).toThrow(/requires support completion/)
  const border = completeMotionSupport(data.sequence!, data.families!, { maxHoleDistance: 0 })
  expect(border.frames[0]!.observations[0]!.borderCells).toContain(18)
  const borderRaster = renderRegional({ ...data, completion: border }, 10, 'completion', 8)
  const borderPixel = ((40 + 2 * 8 + 4) * borderRaster.width + 72 + 4) * 4
  expect([...borderRaster.pixels.subarray(borderPixel, borderPixel + 4)]).toEqual([72, 164, 142, 255])
})

test('source-backed completion scales discrete support and keeps contradictory coherent cells unpainted', () => {
  const data = fixture(), blocker = data.sequence!.pairs[0]!.grids[0]!.cells[22]!
  Object.assign(blocker, { accepted: 64, coverage: 1, coherent: true, dx: 4, dy: 0, spread: 0 })
  const completion = completeMotionSupport(data.sequence!, data.families!, { maxBorderDistance: 0 })
  expect(completion.frames[0]!.counts.blocked).toBeGreaterThan(0)
  expect(completion.frames[0]!.observations[0]!.holeCells).not.toContain(22)
  const source = { width: 145, height: 81, data: new Uint8Array(145 * 81 * 3).fill(110) }
  const raster = renderRegional({ ...data, completion }, 10, 'completion', 8, 0, source)
  expect([raster.width, raster.height]).toEqual([290, 162])
  expect(raster.summary).toContain('145 x 81 display / 72 x 40 analysis')
  const x = source.width + Math.ceil(4 * 8 * source.width / 72) + 2, y = source.height + Math.ceil(2 * 8 * source.height / 40) + 2
  expect([...raster.pixels.subarray((y * raster.width + x) * 4, (y * raster.width + x + 1) * 4)]).toEqual([110, 110, 110, 255])
})

test('motion association retains neighboring-pair context in the kernel and has separate purple provenance', async () => {
  const data = fixture()
  for (const pair of data.sequence!.pairs) Object.assign(pair.grids[0]!.cells[21]!, { accepted: 64, coverage: 1, coherent: true, dx: 0, dy: 0, spread: 0 })
  const before = structuredClone(data), expected = completeMotionSupport(data.sequence!, data.families!)
  expect(expected.frames[0]!.observations[0]!.motionCells).toContain(21)
  const bundle = await regionalKernel(step(), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => false)
  try {
    const value = bundle!.outputs['out:regions:data']!
    if (value.kind !== 'regions') throw new Error('Missing completion')
    expect(value.data.completion).toEqual(expected)
    expect(regionalSummary(value.data)).toContain('motion 2')
    const raster = renderRegional(value.data, 10, 'completion', 8)
    const pixel = (panel: number) => {
      const x = panel % 2 * 72 + 3 * 8 + 4, y = Math.floor(panel / 2) * 40 + 2 * 8 + 4
      return [...raster.pixels.subarray((y * raster.width + x) * 4, (y * raster.width + x + 1) * 4)]
    }
    expect(pixel(1)).toEqual([80, 80, 80, 255])
    expect(pixel(3)).toEqual([140, 102, 178, 255])
    expect(raster.summary).toContain('motion-associated 1')
    expect(data).toEqual(before)
  } finally { bundle!.dispose() }
  data.sequence!.pairs[1]!.grids[0]!.cells[21]!.dx = 4
  const contradicted = await regionalKernel(step(), { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => false)
  try {
    const value = contradicted!.outputs['out:regions:data']!
    if (value.kind !== 'regions') throw new Error('Missing completion')
    expect(value.data.completion).toEqual(completeMotionSupport(data.sequence!, data.families!))
    expect(value.data.completion!.frames[0]!.observations[0]!.motionCells).not.toContain(21)
  } finally { contradicted!.dispose() }
})

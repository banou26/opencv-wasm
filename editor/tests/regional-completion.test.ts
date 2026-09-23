import { expect, test } from 'vite-plus/test'
import { completeMotionSupport, type MotionCompletionOptions, type RegionalMotionSequence } from 'cadence/regional'
import { defaultParams, validateParams } from '../src/engine/specs'
import { regionalKernel } from '../src/worker/regional-kernels'
import { regionalSummary, type RegionalData } from '../src/worker/regional-data'
import { renderRegional } from '../src/worker/regional-render'

const fixture = (): RegionalData => {
  const width = 72, height = 40, cellSize = 8, columns = 9, rows = 5, seeds = [20, 24]
  const sequence: RegionalMotionSequence = { width, height, frameCount: 3, pairs: Array.from({ length: 2 }, (_, frame) => ({ frame,
    flow: { width, height, vectors: new Float32Array(width * height * 2), valid: new Uint8Array(width * height), roundTrip: new Float32Array(width * height), pan: { dx: 0, dy: 0, response: 0, used: false } },
    grids: [{ cellSize, columns, rows, cells: Array.from({ length: columns * rows }, (_, id) => ({
      x: id % columns * cellSize, y: Math.floor(id / columns) * cellSize, width: cellSize, height: cellSize, samples: 64,
      accepted: seeds.includes(id) ? 64 : 0, coverage: seeds.includes(id) ? 1 : 0,
      dx: seeds.includes(id) ? 0 : null, dy: seeds.includes(id) ? 0 : null, spread: seeds.includes(id) ? 0 : null, coherent: seeds.includes(id),
    })) }],
  })) }
  return { stage: 'history', sequence,
    tracks: { width, height, cellSize, frameCount: 3, tracks: [], groups: [{ id: 1, trackIds: [] }],
      frames: [0, 1].map(frame => ({ frame, observations: [{ id: 1, cells: [...seeds], dx: 0, dy: 0, spread: 0 }] })) },
    scene: { asset: 'clip', first: 10, last: 12, sourceWidth: width, sourceHeight: height, frames: Array.from({ length: 3 }, () => ({ width, height, data: new Uint8Array(width * height * 3).fill(80) })) },
    families: { width, height, cellSize, frameCount: 3, options: { tolerance: .75, minimumOverlap: 4, proximityWeight: 0 }, comparisons: [], families: [{ id: 1, regionIds: [1] }],
      frames: [0, 1].map(frame => ({ frame, observations: [{ id: 1, regionIds: [1], cells: [...seeds], dx: 0, dy: 0, spread: 0 }] })) },
  }
}
const step = (options: MotionCompletionOptions = {}) => ({ key: 'completion', node: { id: 'ncomplete', type: 'regionalComplete' as const, params: { ...defaultParams('regionalComplete'), ...options }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 })

test('completion controls use bounded whole fine-grid distances', () => {
  expect(defaultParams('regionalComplete')).toEqual({ maxHoleDistance: 6, maxBorderDistance: 6, competitorClearance: 2 })
  for (const key of ['maxHoleDistance', 'maxBorderDistance', 'competitorClearance']) {
    for (const value of [0, 32]) expect(validateParams('regionalComplete', { ...defaultParams('regionalComplete'), [key]: value })).toBeNull()
    for (const value of [-1, .5, 33, NaN]) expect(validateParams('regionalComplete', { ...defaultParams('regionalComplete'), [key]: value })).not.toBeNull()
  }
})

test('completion kernel checkpoints per pair, matches shared core and preserves original evidence', async () => {
  const data = fixture(), before = structuredClone(data)
  for (const options of [{}, { maxBorderDistance: 0 }, { maxHoleDistance: 0, maxBorderDistance: 0, competitorClearance: 4 }]) {
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

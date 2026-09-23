import { expect, test } from 'vite-plus/test'
import { groupMotionHistories, type RegionalTracks } from 'cadence/regional'
import { parseDocument } from '../src/engine/graph'
import { regionalLayersGraph } from '../src/engine/regional-prefab'
import { defaultParams, SPECS, validateParams } from '../src/engine/specs'
import { regionalKernel } from '../src/worker/regional-kernels'
import { regionalSummary, type RegionalData } from '../src/worker/regional-data'

test('motion-history proximity is a bounded weak default with a distinct cache version', () => {
  const defaults = defaultParams('regionalHistory')
  expect(defaults.proximityWeight).toBe(.25)
  expect(SPECS.regionalHistory.version).toBe(2)
  expect(SPECS.regionalHistory.parameters.find(parameter => parameter.key === 'proximityWeight')).toMatchObject({ kind: 'number', min: 0, max: 4, step: .05 })
  for (const proximityWeight of [0, .25, 4]) expect(validateParams('regionalHistory', { ...defaults, proximityWeight })).toBeNull()
  for (const proximityWeight of [-.01, 4.01, NaN, Infinity, 'weak']) expect(validateParams('regionalHistory', { ...defaults, proximityWeight })).not.toBeNull()
  expect(regionalLayersGraph().nodes.find(node => node.type === 'regionalHistory')!.params.proximityWeight).toBe(.25)
})

test('saved history nodes gain proximity defaults in root and custom graphs without changing explicit settings', () => {
  const doc = regionalLayersGraph(), nested = regionalLayersGraph()
  for (const graph of [doc, nested]) {
    const history = graph.nodes.find(node => node.type === 'regionalHistory')!
    history.params = { tolerance: 1.1, minimumOverlap: 6 }
    graph.nodes.push({ ...history, id: 'nexplicit', params: { ...history.params, proximityWeight: 0 } })
  }
  doc.definitions = [{ id: 'gtest', name: 'Nested history', inputs: [], outputs: [], graph: { ...nested, nodes: [
    ...nested.nodes,
    { id: 'ninput', type: 'groupInput', params: {}, position: { x: 0, y: 0 } },
    { id: 'noutput', type: 'groupOutput', params: {}, position: { x: 0, y: 0 } },
  ] } }]
  const before = structuredClone(doc), parsed = parseDocument(doc)
  for (const graph of [parsed, parsed.definitions![0]!.graph]) {
    expect(graph.nodes.find(node => node.id === 'nhistory')!.params).toEqual({ tolerance: 1.1, minimumOverlap: 6, proximityWeight: .25 })
    expect(graph.nodes.find(node => node.id === 'nexplicit')!.params).toEqual({ tolerance: 1.1, minimumOverlap: 6, proximityWeight: 0 })
  }
  expect(doc).toEqual(before)
  expect(parseDocument(parsed)).toEqual(parsed)
})

test('history kernel forwards proximity weighting while preserving original regions and evidence', async () => {
  // Region 1 matches two mutually contradictory candidates: 2 is a better
  // velocity match far away, while 3 is one cell away with a slightly worse fit.
  const tracks: RegionalTracks = {
    width: 128, height: 8, cellSize: 8, frameCount: 6, tracks: [],
    groups: [1, 2, 3].map(id => ({ id, trackIds: [] })),
    frames: Array.from({ length: 5 }, (_, frame) => ({ frame, observations: [
      { id: 1, cells: [0], dx: 0, dy: 0, spread: 0 },
      { id: 2, cells: [15], dx: -.35, dy: 0, spread: 0 },
      { id: 3, cells: [1], dx: .45, dy: 0, spread: 0 },
    ] })),
  }
  const data: RegionalData = { stage: 'tracks', tracks, scene: {
    asset: 'clip', first: 0, last: 5, sourceWidth: 128, sourceHeight: 8,
    frames: Array.from({ length: 6 }, () => ({ width: 128, height: 8, data: new Uint8Array(128 * 8 * 3) })),
  } }
  const before = structuredClone(data), memberships = []
  for (const proximityWeight of [0, .25, 4]) {
    const params = { ...defaultParams('regionalHistory'), proximityWeight }
    const step = { key: 'history', node: { id: 'nhistory', type: 'regionalHistory' as const, params, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 }
    const bundle = await regionalKernel(step, { 'in:regions:data': { kind: 'regions', data } }, () => undefined, () => false)
    try {
      const value = bundle!.outputs['out:regions:data']!
      if (value.kind !== 'regions') throw new Error('Missing history output')
      expect(value.data.families).toEqual(groupMotionHistories(tracks, { proximityWeight }))
      expect(value.data.families!.options.proximityWeight).toBe(proximityWeight)
      expect(value.data.tracks).toBe(tracks)
      expect(value.data.scene).toBe(data.scene)
      expect(regionalSummary(value.data)).toContain(`Proximity weight: ${proximityWeight}; orders compatible proposals only, not a distance gate`)
      memberships.push(value.data.families!.families.map(family => family.regionIds))
    } finally { bundle!.dispose() }
  }
  expect(memberships).toEqual([[[1, 2], [3]], [[1, 3], [2]], [[1, 3], [2]]])
  expect(data).toEqual(before)
})

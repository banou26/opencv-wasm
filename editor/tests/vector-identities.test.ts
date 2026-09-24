import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV } from '@banou/opencv-wasm'
import { completeFrameVectorSupport, trackFrameVectorIdentities, type FrameVectorGroups } from 'cadence/regional'
import { connect, parseDocument, validateConnection } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import { defaultParams, specFor } from '../src/engine/specs'
import type { NodeType, Params } from '../src/engine/types'
import { vectorLayersGraph } from '../src/engine/vector-prefab'
import { image, type Payload } from '../src/worker/payload'
import { regionalResources, type RegionalData } from '../src/worker/regional-data'
import { regionalKernel } from '../src/worker/regional-kernels'
import { renderVectorCompletionPanels } from '../src/worker/vector-completion-render'

beforeAll(async () => { await initOpenCV() }, 60000)
const step = (type: NodeType, params: Params = {}) => ({ key: 'test', node: { id: 'ntest', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 })
const input = (data: RegionalData): Record<string, Payload> => ({ 'in:regions:data': { kind: 'regions', data } })
const fixture = (): RegionalData => {
  const width = 56, height = 24, frameCount = 4
  const groups: FrameVectorGroups = { width, height, frameCount, cellSize: 8, options: { tolerance: .75, splitSubtleMotion: true, splitDistantRegions: true, proximityGap: 4 }, frames: [] }
  for (let frame = 0; frame < frameCount - 1; frame++) {
    const labels = new Int32Array(21); labels[20] = -1
    if (frame !== 1) {
      for (const cell of [8, 9]) labels[cell] = frame === 0 ? 4 : 1
      for (const cell of [12, 13]) labels[cell] = frame === 0 ? 1 : 4
    }
    const confidence = Uint8Array.from(labels, (label, cell) => label < 0 ? 0 : cell === 8 ? 1 : 2)
    const observations = [...new Set(labels)].filter(id => id >= 0).map(id => {
      const cells = [...labels.keys()].filter(cell => labels[cell] === id)
      return { id, motionId: id, cells, dx: 0, dy: 0, strongCells: cells.filter(cell => confidence[cell] === 2).length }
    })
    groups.frames.push({ frame, labels, confidence, observations })
  }
  return { stage: 'vector-groups', scene: { asset: 'clip', first: 7, last: 10, sourceWidth: width, sourceHeight: height,
    frames: Array.from({ length: frameCount }, () => ({ width, height, data: new Uint8Array(width * height * 3).fill(30) })) }, frameVectorGroups: groups }
}

test('identity stage is explicit, raw inspectors stay raw, and only the final support uses stable colors', () => {
  const doc = parseDocument(vectorLayersGraph()), tracked = doc.nodes.find(node => node.id === 'nidentityview')!
  expect(defaultParams('vectorTrack')).toEqual({ maxGap: 24, matchRadius: 3 })
  expect(defaultParams('vectorIdentityInspect')).toEqual({ frame: 0, stableColors: true, displayMaxSide: 960 })
  expect(specFor(tracked, doc).outputs.filter(port => port.type === 'frame').map(port => port.id)).toEqual(['out:frame:source', 'out:frame:measured', 'out:frame:completed', 'out:frame:provenance'])
  expect(validateConnection(doc, { source: 'ntrack', sourceHandle: 'out:regions:data', target: 'ncomplete', targetHandle: 'in:regions:data' })).toBeNull()
  expect(validateConnection(doc, { source: 'ngroups', sourceHandle: 'out:regions:data', target: 'ncomplete', targetHandle: 'in:regions:data' })).toBeNull()
  expect(validateConnection(doc, { source: 'ncandidates', sourceHandle: 'out:regions:data', target: 'ntrack', targetHandle: 'in:regions:data' })).toMatch(/stages must match/)
  expect(planGraph(doc, 'nview', 'out:frame:groups', 0, 'clip', 4).steps.some(step => step.node.type === 'vectorTrack')).toBe(false)
  expect(planGraph(doc, 'n5', null, 0, 'clip', 4).steps.some(step => step.node.type === 'vectorIdentityInspect')).toBe(true)
  expect(doc.edges).toContainEqual(expect.objectContaining({ source: 'ncomplete', target: 'ncompletionview' }))
})

test('existing untracked completion graphs are not silently migrated', () => {
  let doc = vectorLayersGraph()
  const removed = new Set(['ntrack', 'nidentityview'])
  doc = { ...doc, nodes: doc.nodes.filter(node => !removed.has(node.id)), edges: doc.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)) }
  doc = connect(doc, { source: 'ngroups', sourceHandle: 'out:regions:data', target: 'ncomplete', targetHandle: 'in:regions:data' })
  for (const [port, input] of [['completed', 'a'], ['provenance', 'b']]) doc = connect(doc, { source: 'ncompletionview', sourceHandle: `out:frame:${port}`, target: 'nbottom', targetHandle: `in:frame:${input}` })
  expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(parseDocument(doc))
  expect(parseDocument(doc).nodes.some(node => node.type === 'vectorTrack' || node.type === 'vectorIdentityInspect')).toBe(false)
})

test('stable colors survive local-ID swaps and held gaps without modifying support or filling held foreground', () => {
  const data = fixture(), before = structuredClone(data), groups = data.frameVectorGroups!
  const identities = trackFrameVectorIdentities(groups)
  const completed: RegionalData = { ...data, stage: 'vector-completion', frameVectorSupport: completeFrameVectorSupport(groups), frameVectorIdentities: identities }
  const raw = renderVectorCompletionPanels(completed, 7), tracked = renderVectorCompletionPanels(completed, 7, undefined, identities)
  expect(tracked.panels.source).toEqual(raw.panels.source)
  expect(tracked.panels.provenance).toEqual(raw.panels.provenance)
  expect(tracked.panels.completed).not.toEqual(raw.panels.completed)
  expect(renderVectorCompletionPanels(completed, 7)).toEqual(raw)
  const center = (pixels: Uint8Array | Uint8ClampedArray, cell: number) => {
    const p = ((Math.floor(cell / 7) * 8 + 4) * 56 + cell % 7 * 8 + 4) * 4
    return pixels.slice(p, p + 4)
  }
  const resumed = renderVectorCompletionPanels(completed, 9, undefined, identities)
  for (const cell of [8, 12]) expect(center(resumed.panels.completed, cell)).toEqual(center(tracked.panels.completed, cell))
  for (const cell of [0, 20]) expect(center(tracked.panels.completed, cell)).toEqual(center(raw.panels.completed, cell))
  const held = renderVectorCompletionPanels(completed, 8, undefined, identities)
  expect(center(held.panels.completed, 8)).not.toEqual(center(tracked.panels.completed, 8))
  expect(held.summary).toContain('Dormant tracks: 1, 2')
  expect(held.summary).toContain('Dormant identities do not create foreground masks')
  expect(tracked.summary).toContain('Track 1: local group 4')
  expect(resumed.summary).toContain('Track 1: local group 1; previous source 7')
  const last = renderVectorCompletionPanels(completed, 10, undefined, identities)
  for (const panel of Object.values(last.panels)) expect(panel).toEqual(last.panels.source)
  expect(data).toEqual(before)
  const resources = regionalResources(completed)
  expect(resources.has(identities)).toBe(true)
  expect(resources.has(groups.frames[0]!.labels.buffer)).toBe(true)
})

test('tracked renderer rejects incomplete, colliding or background-changing mappings', () => {
  const data = fixture(), groups = data.frameVectorGroups!, identities = trackFrameVectorIdentities(groups)
  const completed: RegionalData = { ...data, stage: 'vector-completion', frameVectorSupport: completeFrameVectorSupport(groups) }
  const bad = structuredClone(identities)
  bad.frames[0]!.observations.pop()
  expect(() => renderVectorCompletionPanels(completed, 7, undefined, bad)).toThrow(/cover every measured group/)
  const collision = structuredClone(identities)
  collision.frames[0]!.observations.find(item => item.groupId === 4)!.trackId = 0
  expect(() => renderVectorCompletionPanels(completed, 7, undefined, collision)).toThrow(/preserve background/)
  expect(() => renderVectorCompletionPanels(completed, 7, undefined, { ...identities, width: 48 })).toThrow(/geometry/)
})

test('tracking kernel shares original data, passes options and leaves stable-color toggles display-only', async () => {
  const data = fixture(), before = structuredClone(data)
  const tracked = await regionalKernel(step('vectorTrack', { maxGap: 7, matchRadius: 1.5 }), input(data), () => undefined, () => false)
  try {
    const output = tracked!.outputs['out:regions:data']!
    if (output.kind !== 'regions') throw new Error('Expected tracked region data')
    expect(output.data.stage).toBe('vector-identities')
    expect(output.data.frameVectorGroups).toBe(data.frameVectorGroups)
    expect(output.data.frameVectorIdentities!.options).toEqual({ maxGap: 7, matchRadius: 1.5 })
    const completion = await regionalKernel(step('vectorComplete'), input(output.data), () => undefined, () => false)
    try {
      const result = completion!.outputs['out:regions:data']!
      if (result.kind !== 'regions') throw new Error('Expected completed region data')
      expect(result.data.frameVectorSupport).toEqual(completeFrameVectorSupport(data.frameVectorGroups!))
      expect(result.data.frameVectorIdentities).toBe(output.data.frameVectorIdentities)
      const raw = await regionalKernel(step('vectorCompletionInspect', { frame: 7 }), input(result.data), () => undefined, () => false)
      const off = await regionalKernel(step('vectorIdentityInspect', { frame: 7, stableColors: false }), input(result.data), () => undefined, () => false)
      try {
        for (const port of ['source', 'measured', 'completed', 'provenance']) expect(image(off!.outputs[`out:frame:${port}`]).mat.data32F).toEqual(image(raw!.outputs[`out:frame:${port}`]).mat.data32F)
      } finally { off!.dispose(); raw!.dispose() }
    } finally { completion!.dispose() }
  } finally { tracked!.dispose() }
  expect(data).toEqual(before)
  await expect(regionalKernel(step('vectorTrack'), input({ ...data, stage: 'scene' }), () => undefined, () => false)).rejects.toThrow(/requires vector-groups/)
  await expect(regionalKernel(step('vectorTrack'), input(data), () => undefined, () => true)).rejects.toThrow(/cancelled/)
})

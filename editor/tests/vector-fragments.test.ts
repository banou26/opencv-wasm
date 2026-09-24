import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV } from '@banou/opencv-wasm'
import { completeFrameVectorSupport, mergeFrameVectorFragments, trackFrameVectorIdentities, type FrameVectorGroups } from 'cadence/regional'
import { parseDocument, validateConnection } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import { defaultParams } from '../src/engine/specs'
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
  const width = 56, height = 56, frameCount = 4
  const groups: FrameVectorGroups = { width, height, frameCount, cellSize: 8, options: { tolerance: .75, splitSubtleMotion: true, splitDistantRegions: true, proximityGap: 4 }, frames: [] }
  for (let frame = 0; frame < 3; frame++) {
    const labels = new Int32Array(49)
    for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) labels[y * 7 + x] = 1
    if (frame === 1) labels[24] = 2
    labels[48] = -1
    const confidence = Uint8Array.from(labels, (id, cell) => id < 0 ? 0 : cell === 24 ? 1 : 2)
    const observations = [...new Set(labels)].filter(id => id >= 0).map(id => {
      const cells = [...labels.keys()].filter(cell => labels[cell] === id)
      return { id, motionId: id, cells, dx: 0, dy: 0, strongCells: cells.filter(cell => confidence[cell] === 2).length }
    })
    groups.frames.push({ frame, labels, confidence, observations })
  }
  return { stage: 'vector-completion', scene: { asset: 'clip', first: 0, last: 3, sourceWidth: width, sourceHeight: height,
    frames: Array.from({ length: frameCount }, () => ({ width, height, data: new Uint8Array(width * height * 3).fill(30) })) },
  frameVectorGroups: groups, frameVectorSupport: completeFrameVectorSupport(groups), frameVectorIdentities: trackFrameVectorIdentities(groups) }
}

test('fragment stage is explicit and does not replace any raw inspector or silently modify old graphs', () => {
  const doc = parseDocument(vectorLayersGraph())
  expect(defaultParams('vectorFragments')).toEqual({ enabled: true })
  expect(validateConnection(doc, { source: 'nfragments', sourceHandle: 'out:regions:data', target: 'nidentityview', targetHandle: 'in:regions:data' })).toBeNull()
  expect(validateConnection(doc, { source: 'ntrack', sourceHandle: 'out:regions:data', target: 'nfragments', targetHandle: 'in:regions:data' })).toMatch(/stages must match/)
  expect(planGraph(doc, 'ncompletionview', 'out:frame:completed', 0, 'clip', 4).steps.some(step => step.node.type === 'vectorFragments')).toBe(false)
  expect(planGraph(doc, 'nidentityview', 'out:frame:completed', 0, 'clip', 4).steps.some(step => step.node.type === 'vectorFragments')).toBe(true)
  const old = { ...doc, nodes: doc.nodes.filter(node => node.id !== 'nfragments'), edges: doc.edges.filter(edge => edge.target !== 'nfragments').map(edge => edge.source === 'nfragments' ? { ...edge, source: 'ncomplete' } : edge) }
  expect(parseDocument(old).nodes.some(node => node.type === 'vectorFragments')).toBe(false)
})

test('fragment display changes only listed completed membership and pink provenance, preserving measured pixels and opacity', () => {
  const data = fixture(), before = structuredClone(data), identities = data.frameVectorIdentities!
  const fragments = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities)
  expect(fragments.frames[1]!.merges.map(merge => merge.cells)).toEqual([[24]])
  const original = renderVectorCompletionPanels(data, 1, undefined, identities)
  const merged = renderVectorCompletionPanels(data, 1, undefined, identities, fragments)
  expect(merged.panels.source).toEqual(original.panels.source)
  expect(merged.panels.measured).toEqual(original.panels.measured)
  expect(merged.summary).toContain('merged cells 1; components 1')
  for (const port of ['completed', 'provenance'] as const) for (let cell = 0; cell < 49; cell++) {
    const p = ((Math.floor(cell / 7) * 8 + 4) * 56 + cell % 7 * 8 + 4) * 4
    if (cell === 24) expect(merged.panels[port].slice(p, p + 4)).not.toEqual(original.panels[port].slice(p, p + 4))
    else expect(merged.panels[port].slice(p, p + 4)).toEqual(original.panels[port].slice(p, p + 4))
  }
  const disabled = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities, { enabled: false })
  expect(renderVectorCompletionPanels(data, 1, undefined, identities, disabled).panels).toEqual(original.panels)
  expect(data).toEqual(before)
  expect(regionalResources({ ...data, frameVectorFragments: fragments }).has(fragments.frames[1]!.trackLabels.buffer)).toBe(true)
  const final = renderVectorCompletionPanels(data, 3, undefined, identities, fragments)
  for (const panel of Object.values(final.panels)) expect(panel).toEqual(final.panels.source)
})

test('fragment renderer rejects unlisted relabeling, unknown or dominant changes, wrong geometry and missing measured provenance', () => {
  const data = fixture(), identities = data.frameVectorIdentities!
  const fragments = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities)
  const render = (result: typeof fragments) => renderVectorCompletionPanels(data, 1, undefined, identities, result)
  const unlisted = structuredClone(fragments); unlisted.frames[1]!.merges = []
  expect(() => render(unlisted)).toThrow(/explicitly listed/)
  for (const cell of [0, 48]) {
    const changed = structuredClone(fragments); changed.frames[1]!.trackLabels[cell] = 1
    expect(() => render(changed)).toThrow(/explicitly listed/)
  }
  const provenance = structuredClone(fragments); provenance.frames[1]!.merges[0]!.measuredCells = []
  expect(() => render(provenance)).toThrow(/measurements/)
  expect(() => render({ ...fragments, width: 48 })).toThrow(/geometry/)
  expect(() => renderVectorCompletionPanels(data, 1, undefined, undefined, fragments)).toThrow(/stable identity/)
})

test('partial foreground enclosure cannot absorb a fragment with substantial dominant-boundary support', () => {
  const data = fixture(), groups = data.frameVectorGroups!, frame = groups.frames[1]!
  for (const cell of [16, 17, 18]) frame.labels[cell] = 0
  frame.observations = frame.observations.map(group => {
    const cells = [...frame.labels.keys()].filter(cell => frame.labels[cell] === group.id)
    return { ...group, cells, strongCells: cells.filter(cell => frame.confidence[cell] === 2).length }
  })
  const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
  const fragments = mergeFrameVectorFragments(groups, support, identities)
  expect(fragments.frames[1]!.merges).toEqual([])
  const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
  const original = renderVectorCompletionPanels(completed, 1, undefined, identities)
  expect(renderVectorCompletionPanels(completed, 1, undefined, identities, fragments).panels).toEqual(original.panels)
})

test('unknown partial boundaries abstain but cannot replace the minimum measured coverage', () => {
  for (const measuredBackground of [true, false]) {
    const data = fixture(), groups = data.frameVectorGroups!, frame = groups.frames[1]!
    for (const cell of [17, 18, 23, 30]) { frame.labels[cell] = -1; frame.confidence[cell] = 0 }
    frame.labels[16] = measuredBackground ? 0 : -1
    frame.confidence[16] = measuredBackground ? 2 : 0
    frame.observations = frame.observations.map(group => {
      const cells = [...frame.labels.keys()].filter(cell => frame.labels[cell] === group.id)
      return { ...group, cells, strongCells: cells.filter(cell => frame.confidence[cell] === 2).length }
    })
    const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
    const before = structuredClone({ groups, support, identities })
    const fragments = mergeFrameVectorFragments(groups, support, identities)
    expect(fragments.frames[1]!.merges.map(merge => ({ cells: merge.cells, reason: merge.reason }))).toEqual(measuredBackground ? [{ cells: [24], reason: 'partial' }] : [])
    expect({ groups, support, identities }).toEqual(before)
    const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
    const original = renderVectorCompletionPanels(completed, 1, undefined, identities)
    const rendered = renderVectorCompletionPanels(completed, 1, undefined, identities, fragments)
    for (const port of ['source', 'measured'] as const) expect(rendered.panels[port]).toEqual(original.panels[port])
  }
})

test('fragment kernel retains original evidence by reference and stable-colors off bypasses inferred labels', async () => {
  const data = fixture(), before = structuredClone(data)
  const bundle = await regionalKernel(step('vectorFragments'), input(data), () => undefined, () => false)
  try {
    const result = bundle!.outputs['out:regions:data']!
    if (result.kind !== 'regions') throw new Error('Expected fragment data')
    expect(result.data.stage).toBe('vector-fragments')
    for (const key of ['frameVectorGroups', 'frameVectorSupport', 'frameVectorIdentities'] as const) expect(result.data[key]).toBe(data[key])
    const raw = await regionalKernel(step('vectorCompletionInspect', { frame: 1 }), input(result.data), () => undefined, () => false)
    const off = await regionalKernel(step('vectorIdentityInspect', { frame: 1, stableColors: false }), input(result.data), () => undefined, () => false)
    try {
      for (const port of ['source', 'measured', 'completed', 'provenance']) expect(image(off!.outputs[`out:frame:${port}`]).mat.data32F).toEqual(image(raw!.outputs[`out:frame:${port}`]).mat.data32F)
    } finally { off!.dispose(); raw!.dispose() }
  } finally { bundle!.dispose() }
  expect(data).toEqual(before)
  await expect(regionalKernel(step('vectorFragments'), input({ ...data, frameVectorIdentities: undefined }), () => undefined, () => false)).rejects.toThrow(/tracked identities/)
})

test('weak enclosure preserves dominant-moving fragments but permits motion closer to the host', () => {
  for (const childDx of [0, 1.5]) {
    const data = fixture(), groups = data.frameVectorGroups!, frame = groups.frames[1]!
    for (const cell of [17, 18, 23, 30]) { frame.labels[cell] = -1; frame.confidence[cell] = 0 }
    frame.labels[16] = 0
    for (const pair of groups.frames) pair.observations = pair.observations.map(group => {
      const cells = [...pair.labels.keys()].filter(cell => pair.labels[cell] === group.id)
      return { ...group, cells, dx: group.id === 1 ? 2 : group.id === 2 ? childDx : 0, strongCells: cells.filter(cell => pair.confidence[cell] === 2).length }
    })
    const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
    const before = structuredClone({ groups, support, identities })
    const fragments = mergeFrameVectorFragments(groups, support, identities)
    expect(fragments.frames[1]!.merges.map(merge => merge.cells)).toEqual(childDx === 0 ? [] : [[24]])
    expect({ groups, support, identities }).toEqual(before)
    const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
    const original = renderVectorCompletionPanels(completed, 1, undefined, identities)
    const result = renderVectorCompletionPanels(completed, 1, undefined, identities, fragments)
    if (childDx === 0) expect(result.panels).toEqual(original.panels)
    else for (const port of ['source', 'measured'] as const) expect(result.panels[port]).toEqual(original.panels[port])
  }
})

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

test('temporal merge presentation records absolute witness frames and validates original component support', () => {
  const data = fixture(), identities = data.frameVectorIdentities!
  data.scene.first = 10; data.scene.last = 13
  const fragments = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities)
  const merge = fragments.frames[1]!.merges[0]!
  merge.reason = 'temporal'
  merge.temporal = [{ cells: [24], mode: 'bracketed', witnesses: [{ frame: 0, cells: [24] }, { frame: 2, cells: [24] }], commonCells: [24] }]
  const result = renderVectorCompletionPanels(data, 11, undefined, identities, fragments)
  expect(result.summary).toContain('reason temporal')
  expect(result.summary).toContain('component 24; mode bracketed; witness source 10 cells 24; witness source 12 cells 24; common 24')
  expect(result.panels.measured).toEqual(renderVectorCompletionPanels(data, 11, undefined, identities).panels.measured)
  const missing = structuredClone(fragments); delete missing.frames[1]!.merges[0]!.temporal
  expect(() => renderVectorCompletionPanels(data, 11, undefined, identities, missing)).toThrow(/explicit temporal witnesses/)
  const futureOnly = structuredClone(fragments); futureOnly.frames[1]!.merges[0]!.temporal![0]!.witnesses[0].frame = 2
  expect(() => renderVectorCompletionPanels(data, 11, undefined, identities, futureOnly)).toThrow(/witness frames/)
  const fabricated = structuredClone(fragments); fabricated.frames[1]!.merges[0]!.temporal![0]!.witnesses[0].cells = []
  expect(() => renderVectorCompletionPanels(data, 11, undefined, identities, fabricated)).toThrow(/common support/)
  const outside = structuredClone(fragments); outside.frames[1]!.merges[0]!.temporal![0]!.cells = [0]
  expect(() => renderVectorCompletionPanels(data, 11, undefined, identities, outside)).toThrow(/original measured fragment/)
})

test('birth-mode presentation accepts two distinct future witnesses without inventing a preceding frame', () => {
  const data = fixture(), groups = data.frameVectorGroups!, [plain, fragmented] = groups.frames
  groups.frames[0] = { ...fragmented!, frame: 0 }; groups.frames[1] = { ...plain!, frame: 1 }
  const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
  const fragments = mergeFrameVectorFragments(groups, support, identities), merge = fragments.frames[0]!.merges[0]!
  merge.reason = 'temporal'
  merge.temporal = [{ cells: [24], mode: 'birth', witnesses: [{ frame: 1, cells: [24] }, { frame: 2, cells: [24] }], commonCells: [24] }]
  const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
  expect(renderVectorCompletionPanels(completed, 0, undefined, identities, fragments).summary).toContain('mode birth; witness source 1 cells 24; witness source 2 cells 24')
  merge.temporal[0]!.mode = 'bracketed'
  expect(() => renderVectorCompletionPanels(completed, 0, undefined, identities, fragments)).toThrow(/witness frames/)
})

test('temporal display rejects witness records that omit part of the measured fragment', () => {
  const data = fixture(), groups = data.frameVectorGroups!, frame = groups.frames[1]!
  frame.labels[23] = 2
  frame.observations = frame.observations.map(group => {
    const cells = [...frame.labels.keys()].filter(cell => frame.labels[cell] === group.id)
    return { ...group, cells, strongCells: cells.filter(cell => frame.confidence[cell] === 2).length }
  })
  const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
  const fragments = mergeFrameVectorFragments(groups, support, identities), merge = fragments.frames[1]!.merges[0]!
  expect(merge.measuredCells).toEqual([23, 24])
  merge.reason = 'temporal'
  merge.temporal = [{ cells: [24], mode: 'bracketed', witnesses: [{ frame: 0, cells: [24] }, { frame: 2, cells: [24] }], commonCells: [24] }]
  const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
  expect(() => renderVectorCompletionPanels(completed, 1, undefined, identities, fragments)).toThrow(/cover every measured fragment cell/)
})

const enlargedFixture = (current: number): RegionalData => {
  const width = 136, height = 136, frameCount = 5, columns = 17
  const groups: FrameVectorGroups = { width, height, frameCount, cellSize: 8,
    options: { tolerance: .75, splitSubtleMotion: true, splitDistantRegions: true, proximityGap: 4 }, frames: [] }
  for (let frame = 0; frame < frameCount - 1; frame++) {
    const labels = new Int32Array(columns * columns)
    for (let y = 1; y < 16; y++) for (let x = 1; x < 16; x++) labels[y * columns + x] = 1
    if (frame === current) for (let y = 6; y < 11; y++) for (let x = 6; x < 11; x++) labels[y * columns + x] = 2
    const confidence = new Uint8Array(labels.length).fill(2)
    const observations = [...new Set(labels)].map(id => {
      const cells = [...labels.keys()].filter(cell => labels[cell] === id)
      return { id, motionId: id, cells, dx: 0, dy: 0, strongCells: cells.length }
    })
    groups.frames.push({ frame, labels, confidence, observations })
  }
  return { stage: 'vector-completion', scene: { asset: 'clip', first: 0, last: frameCount - 1, sourceWidth: width, sourceHeight: height,
    frames: Array.from({ length: frameCount }, () => ({ width, height, data: new Uint8Array(width * height * 3).fill(30) })) },
  frameVectorGroups: groups, frameVectorSupport: completeFrameVectorSupport(groups), frameVectorIdentities: trackFrameVectorIdentities(groups) }
}

test('enlarged enclosure presentation accepts two past or two future original witnesses', () => {
  for (const current of [0, 3]) {
    const data = enlargedFixture(current), identities = data.frameVectorIdentities!
    const before = structuredClone(data), fragments = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities)
    const merges = fragments.frames[current]!.merges
    expect(merges).toHaveLength(1)
    expect(merges[0]!.measuredCells).toHaveLength(25)
    expect(merges[0]!.temporal?.[0]?.mode).toBe('enclosure')
    expect(merges[0]!.temporal?.[0]?.witnesses.map(witness => witness.frame)).toEqual([1, 2])
    const original = renderVectorCompletionPanels(data, current, undefined, identities)
    const result = renderVectorCompletionPanels(data, current, undefined, identities, fragments)
    expect(result.summary).toContain('enclosure-corroborated 40')
    expect(result.summary).toContain('mode enclosure; witness source 1')
    for (const port of ['source', 'measured'] as const) expect(result.panels[port]).toEqual(original.panels[port])
    expect(result.panels.completed).not.toEqual(original.panels.completed)
    expect(data).toEqual(before)
  }
})

test('enclosure mode rejects smaller components, oversized components and straddling donors', () => {
  const small = fixture(), smallIdentities = small.frameVectorIdentities!
  const smallFragments = mergeFrameVectorFragments(small.frameVectorGroups!, small.frameVectorSupport!, smallIdentities)
  const smallMerge = smallFragments.frames[1]!.merges[0]!
  smallMerge.reason = 'temporal'
  smallMerge.temporal = [{ cells: [24], mode: 'enclosure', witnesses: [{ frame: 0, cells: [24] }, { frame: 2, cells: [24] }], commonCells: [24] }]
  expect(() => renderVectorCompletionPanels(small, 1, undefined, smallIdentities, smallFragments)).toThrow(/only to enlarged/)

  const data = enlargedFixture(2), identities = data.frameVectorIdentities!
  const fragments = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities)
  expect(fragments.frames[2]!.merges[0]!.temporal?.[0]?.mode).toBe('bracketed')
  const straddling = structuredClone(fragments); straddling.frames[2]!.merges[0]!.temporal![0]!.mode = 'enclosure'
  expect(() => renderVectorCompletionPanels(data, 2, undefined, identities, straddling)).toThrow(/witness frames/)
  const oversized = structuredClone(straddling); oversized.options.maxCells = 3
  expect(() => renderVectorCompletionPanels(data, 2, undefined, identities, oversized)).toThrow(/only to enlarged/)
})

test('attachment presentation accepts bounded bilateral or same-side witnesses but never the current pair', () => {
  for (const current of [0, 1]) {
    const data = fixture(), groups = data.frameVectorGroups!, [plain, fragmented] = groups.frames
    if (current === 0) { groups.frames[0] = { ...fragmented!, frame: 0 }; groups.frames[1] = { ...plain!, frame: 1 } }
    const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
    const fragments = mergeFrameVectorFragments(groups, support, identities), merge = fragments.frames[current]!.merges[0]!
    merge.reason = 'temporal'
    merge.temporal = [{ cells: [24], mode: 'attachment', witnesses: [{ frame: current === 0 ? 1 : 0, cells: [24] }, { frame: 2, cells: [24] }], commonCells: [24] }]
    const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
    const original = renderVectorCompletionPanels(completed, current, undefined, identities)
    const result = renderVectorCompletionPanels(completed, current, undefined, identities, fragments)
    expect(result.summary).toContain('mode attachment')
    for (const port of ['source', 'measured'] as const) expect(result.panels[port]).toEqual(original.panels[port])
    merge.temporal[0]!.witnesses[0].frame = current
    expect(() => renderVectorCompletionPanels(completed, current, undefined, identities, fragments)).toThrow(/witness frames/)
  }
  const data = enlargedFixture(2), identities = data.frameVectorIdentities!
  const fragments = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities)
  fragments.frames[2]!.merges[0]!.temporal![0]!.mode = 'attachment'
  expect(() => renderVectorCompletionPanels(data, 2, undefined, identities, fragments)).toThrow(/bounded measured components/)
})

const associationFixture = () => {
  const data = fixture(), identities = data.frameVectorIdentities!
  data.scene.first = 10; data.scene.last = 13
  const fragments = mergeFrameVectorFragments(data.frameVectorGroups!, data.frameVectorSupport!, identities)
  const merge = fragments.frames[1]!.merges[0]!
  merge.reason = 'temporal'
  merge.temporal = [{ cells: [24], mode: 'association', witnesses: [
    { frame: 0, cells: [24], hostCells: [], enclosed: [{ groupId: 2, hostGroupId: 1, cells: [23, 24], currentCells: [24] }] },
    { frame: 2, cells: [24], hostCells: [24], enclosed: [] },
  ], commonCells: [24] }]
  return { data, identities, fragments }
}

test('association presentation exposes direct current cells and full original donor components with absolute frames', () => {
  const { data, identities, fragments } = associationFixture()
  const before = structuredClone({ data, fragments }), original = renderVectorCompletionPanels(data, 11, undefined, identities)
  const result = renderVectorCompletionPanels(data, 11, undefined, identities, fragments)
  expect(result.summary).toContain('mode association; witness source 10 cells 24; witness source 12 cells 24')
  const record = JSON.parse(result.summary.split('\n').find(line => line.startsWith('Association:'))!.slice('Association:'.length))
  expect(record).toEqual({ fromGroupId: 2, toGroupId: 1, cells: [24], witnesses: [
    { frame: 10, hostCells: [], enclosed: [{ groupId: 2, hostGroupId: 1, cells: [23, 24], currentCells: [24] }] },
    { frame: 12, hostCells: [24], enclosed: [] },
  ] })
  for (const port of ['source', 'measured'] as const) expect(result.panels[port]).toEqual(original.panels[port])
  expect({ data, fragments }).toEqual(before)
})

test('association presentation rejects incomplete, overlapping or unbounded donor metadata', () => {
  const { data, identities, fragments } = associationFixture()
  type Evidence = NonNullable<typeof fragments.frames[number]['merges'][number]['temporal']>[number]
  const invalid: ((evidence: Evidence) => void)[] = [
    evidence => { delete evidence.witnesses[0].hostCells },
    evidence => { delete evidence.witnesses[0].enclosed },
    evidence => { evidence.witnesses[0].hostCells = [24] },
    evidence => { evidence.witnesses[1].hostCells = [24, 24] },
    evidence => { evidence.witnesses[0].enclosed![0]!.currentCells = [24, 24] },
    evidence => { evidence.witnesses[0].enclosed![0]!.currentCells = [23] },
    evidence => { evidence.witnesses[0].enclosed![0]!.currentCells = [] },
    evidence => { evidence.witnesses[0].enclosed![0]!.cells = [23, 23] },
    evidence => { evidence.witnesses[0].enclosed!.push(structuredClone(evidence.witnesses[0].enclosed![0]!)) },
    evidence => { evidence.witnesses[0].enclosed![0]!.cells = [49] },
    evidence => { evidence.witnesses[0].enclosed![0]!.cells = Array.from({ length: 21 }, (_, cell) => cell) },
    evidence => { evidence.witnesses[0].enclosed![0]!.groupId = 0 },
    evidence => { evidence.witnesses[0].enclosed![0]!.hostGroupId = 2 },
    evidence => { evidence.witnesses[0].enclosed = [] },
    evidence => { evidence.witnesses[0].enclosed = []; evidence.witnesses[0].hostCells = [24] },
    evidence => { evidence.witnesses[0].frame = 2 },
  ]
  for (const mutate of invalid) {
    const changed = structuredClone(fragments); mutate(changed.frames[1]!.merges[0]!.temporal![0]!)
    expect(() => renderVectorCompletionPanels(data, 11, undefined, identities, changed)).toThrow()
  }
  const extra = structuredClone(fragments); extra.frames[1]!.merges[0]!.temporal![0]!.mode = 'bracketed'
  expect(() => renderVectorCompletionPanels(data, 11, undefined, identities, extra)).toThrow(/association mode/)
})

test('clipped presentation validates individual original components at one edge without altering raw panels', () => {
  const data = fixture(), groups = data.frameVectorGroups!
  for (const frame of groups.frames) {
    frame.labels.fill(1); frame.labels[0] = 0
    if (frame.frame === 1) frame.labels[27] = 2
    frame.confidence.fill(2)
    frame.observations = [...new Set(frame.labels)].map(id => {
      const cells = [...frame.labels.keys()].filter(cell => frame.labels[cell] === id)
      return { id, motionId: id, cells, dx: 0, dy: 0, strongCells: cells.length }
    })
  }
  const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
  const fragments = mergeFrameVectorFragments(groups, support, identities)
  expect(fragments.frames[1]!.merges.map(merge => ({ reason: merge.reason, cells: merge.cells }))).toEqual([{ reason: 'clipped', cells: [27] }])
  const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
  const original = renderVectorCompletionPanels(completed, 1, undefined, identities)
  const result = renderVectorCompletionPanels(completed, 1, undefined, identities, fragments)
  expect(result.summary).toContain('reason clipped')
  for (const port of ['source', 'measured'] as const) expect(result.panels[port]).toEqual(original.panels[port])
  const interior = fixture(), interiorIdentities = interior.frameVectorIdentities!
  const interiorFragments = mergeFrameVectorFragments(interior.frameVectorGroups!, interior.frameVectorSupport!, interiorIdentities)
  interiorFragments.frames[1]!.merges[0]!.reason = 'clipped'
  expect(() => renderVectorCompletionPanels(interior, 1, undefined, interiorIdentities, interiorFragments)).toThrow(/one frame edge/)
})

test('clipped size and edge limits apply to original raw components rather than the aggregate merge record', () => {
  const data = enlargedFixture(2), groups = data.frameVectorGroups!
  for (const frame of groups.frames) {
    frame.labels.fill(1); frame.labels[0] = 0
    if (frame.frame === 2) for (let y = 2; y < 14; y++) { frame.labels[y * 17] = 2; frame.labels[y * 17 + 16] = 2 }
    frame.observations = [...new Set(frame.labels)].map(id => {
      const cells = [...frame.labels.keys()].filter(cell => frame.labels[cell] === id)
      return { id, motionId: id, cells, dx: 0, dy: 0, strongCells: cells.length }
    })
  }
  const support = completeFrameVectorSupport(groups), identities = trackFrameVectorIdentities(groups)
  const fragments = mergeFrameVectorFragments(groups, support, identities), frame = fragments.frames[2]!
  expect(frame.merges).toHaveLength(2)
  expect(frame.merges.every(merge => merge.reason === 'clipped' && merge.measuredCells.length === 12)).toBe(true)
  frame.merges = [{ ...frame.merges[0]!, cells: frame.merges.flatMap(merge => merge.cells), measuredCells: frame.merges.flatMap(merge => merge.measuredCells) }]
  expect(frame.merges[0]!.measuredCells).toHaveLength(24)
  const completed = { ...data, frameVectorSupport: support, frameVectorIdentities: identities }
  expect(renderVectorCompletionPanels(completed, 2, undefined, identities, fragments).summary).toContain('reason clipped')
})

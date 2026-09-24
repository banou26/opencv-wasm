import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV } from '@banou/opencv-wasm'
import { completeFrameVectorSupport, groupFrameVectors, type MotionCell } from 'cadence/regional'
import { connect, parseDocument, validateConnection } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import { defaultParams, specFor } from '../src/engine/specs'
import type { NodeType, Params } from '../src/engine/types'
import { vectorLayersGraph } from '../src/engine/vector-prefab'
import type { VideoSource } from '../src/video/source'
import { image, type Payload } from '../src/worker/payload'
import type { RegionalData } from '../src/worker/regional-data'
import { regionalKernel } from '../src/worker/regional-kernels'
import { renderVectorCompletionPanels } from '../src/worker/vector-completion-render'
import { renderVectorPanels } from '../src/worker/vector-render'

beforeAll(async () => { await initOpenCV() }, 60000)
const step = (type: NodeType, params: Params = {}) => ({ key: 'test', node: { id: 'ntest', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 })
const input = (data: RegionalData): Record<string, Payload> => ({ 'in:regions:data': { kind: 'regions', data } })
const fixture = (): RegionalData => {
  const width = 56, height = 56, unknown = new Set([0, 7, 14, 21, 28, 35, 42, 24, 40])
  const cells: MotionCell[] = Array.from({ length: 49 }, (_, index) => ({ x: index % 7 * 8, y: Math.floor(index / 7) * 8, width: 8, height: 8,
    dx: unknown.has(index) ? null : index === 41 ? 2 : 0, dy: unknown.has(index) ? null : 0, accepted: unknown.has(index) ? 0 : 64,
    coverage: unknown.has(index) ? 0 : 1, spread: unknown.has(index) ? null : .01, coherent: !unknown.has(index) && index !== 9 }))
  const sequence = { width, height, frameCount: 2, pairs: [{ frame: 0, flow: { width, height, vectors: new Float32Array(width * height * 2), valid: new Uint8Array(width * height), roundTrip: new Float32Array(width * height), pan: { dx: 0, dy: 0, response: 0, used: false } }, grids: [{ cellSize: 8, columns: 7, rows: 7, cells }] }] }
  const frameVectorGroups = groupFrameVectors(sequence)
  return { stage: 'vector-completion', scene: { asset: 'clip', first: 7, last: 8, sourceWidth: width, sourceHeight: height, frames: Array.from({ length: 2 }, () => ({ width, height, data: new Uint8Array(width * height * 3).fill(30) })) },
    sequence, frameVectorGroups, frameVectorSupport: completeFrameVectorSupport(frameVectorGroups) }
}

test('direct completion exposes four typed panels and supplies the final comparison', () => {
  const graph = parseDocument(vectorLayersGraph()), inspector = graph.nodes.find(node => node.id === 'ncompletionview')!
  expect(defaultParams('vectorComplete')).toEqual({ fillHoles: true, fillEdges: true, edgeReach: 8 })
  expect(specFor(graph.nodes.find(node => node.id === 'ncomplete')!, graph).version).toBe(8)
  expect(specFor(inspector, graph).outputs.filter(port => port.type === 'frame').map(port => port.id)).toEqual(['out:frame:source', 'out:frame:measured', 'out:frame:completed', 'out:frame:provenance'])
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'ncompletionview', sourceHandle: 'out:frame:completed', target: 'nbottom', targetHandle: 'in:frame:a' }))
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'ncompletionview', sourceHandle: 'out:frame:provenance', target: 'nbottom', targetHandle: 'in:frame:b' }))
  expect(validateConnection(graph, { source: 'ncandidates', sourceHandle: 'out:regions:data', target: 'ncomplete', targetHandle: 'in:regions:data' })).toMatch(/stages must match/)
  expect(validateConnection(graph, { source: 'ngroups', sourceHandle: 'out:regions:data', target: 'ncompletionview', targetHandle: 'in:regions:data' })).toMatch(/stages must match/)
  for (const target of ['ncandidateview', 'nview']) expect(planGraph(graph, target, 'out:frame:groups', 0, 'clip', 2).steps.some(step => step.node.type === 'vectorComplete')).toBe(false)
})

test('existing saved direct-motion graphs remain unchanged instead of acquiring completion nodes', () => {
  let graph = vectorLayersGraph()
  const removed = new Set(['ncomplete', 'ncompletionview'])
  graph = { ...graph, nodes: graph.nodes.filter(node => !removed.has(node.id)), edges: graph.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)) }
  graph = connect(graph, { source: 'nview', sourceHandle: 'out:frame:groups', target: 'nbottom', targetHandle: 'in:frame:a' })
  graph = connect(graph, { source: 'nview', sourceHandle: 'out:frame:confidence', target: 'nbottom', targetHandle: 'in:frame:b' })
  expect(parseDocument(JSON.parse(JSON.stringify(graph)))).toEqual(parseDocument(graph))
  expect(parseDocument(graph).nodes.some(node => node.type === 'vectorComplete')).toBe(false)
})

test('completed support preserves exact measured pixels and exposes inference separately', () => {
  const data = fixture(), original = structuredClone(data), raw = renderVectorPanels({ ...data, stage: 'vector-groups' }, 7)
  const result = renderVectorCompletionPanels(data, 7)
  expect(result.panels.source).toEqual(raw.panels.source)
  expect(result.panels.measured).toEqual(raw.panels.groups)
  const pixel = (panel: keyof typeof result.panels, cell: number) => {
    const x = cell % 7 * 8 + 4, y = Math.floor(cell / 7) * 8 + 4, index = (y * 56 + x) * 4
    return result.panels[panel].slice(index, index + 4)
  }
  for (const cell of [1, 9, 41]) expect(pixel('completed', cell)).toEqual(pixel('measured', cell))
  for (const cell of [0, 24, 40]) {
    expect(pixel('measured', cell)).toEqual(pixel('source', cell))
    expect(pixel('completed', cell)).not.toEqual(pixel('source', cell))
  }
  expect(pixel('completed', 40)).toEqual(pixel('completed', 24))
  expect(pixel('provenance', 40)).toEqual(pixel('provenance', 24))
  expect(new Set([1, 24, 0].map(cell => pixel('provenance', cell).join(','))).size).toBe(3)
  expect(result.summary).toContain('inferred holes 2; inferred edge 7; unknown 0')
  expect(result.summary).toContain('Inferred cells have no measured motion')
  expect(data).toEqual(original)
})

test('disabled completion retains raw measured support and never invents a last-frame pair', () => {
  const data = fixture()
  data.frameVectorSupport = completeFrameVectorSupport(data.frameVectorGroups!, { fillHoles: false, edgeReach: 0 })
  const disabled = renderVectorCompletionPanels(data, 7)
  expect(disabled.panels.completed).toEqual(disabled.panels.measured)
  expect(disabled.summary).toContain('inferred holes 0; inferred edge 0; unknown 9')
  const final = renderVectorCompletionPanels(data, 8)
  for (const panel of Object.values(final.panels)) expect(panel).toEqual(final.panels.source)
  expect(final.summary).toContain('final frame, no outgoing pair')
  final.panels.source[0] = 255
  expect(final.panels.completed[0]).toBe(30)
  expect(() => renderVectorCompletionPanels({ ...data, stage: 'vector-groups' }, 7)).toThrow(/requires completed/)
  data.frameVectorSupport.frames[0]!.labels[1] = 99
  expect(() => renderVectorCompletionPanels(data, 7)).toThrow(/preserve measured/)
})

test('winding diagonal edge pocket retains edge provenance without using inferred boundary cells', () => {
  const original = fixture().frameVectorGroups!, missing = new Set([0, 6, 12])
  const labels = Int32Array.from({ length: 25 }, (_, cell) => missing.has(cell) ? -1 : 0)
  const measured = [...labels.keys()].filter(cell => !missing.has(cell))
  const groups = { ...original, width: 40, height: 40, frames: [{ frame: 0, labels, confidence: Uint8Array.from(labels, label => label >= 0 ? 2 : 0), observations: [{ id: 0, motionId: 0, cells: measured, dx: 0, dy: 0, strongCells: measured.length }] }] }
  const before = structuredClone(groups), support = completeFrameVectorSupport(groups, { fillHoles: false })
  expect(support.frames[0]!.counts).toEqual({ measured: 22, holes: 0, border: 3, unknown: 0 })
  for (const cell of missing) expect(support.frames[0]!.provenance[cell]).toBe(3)
  expect(groups).toEqual(before)
  const data: RegionalData = { stage: 'vector-completion', scene: { asset: 'clip', first: 7, last: 8, sourceWidth: 40, sourceHeight: 40, frames: Array.from({ length: 2 }, () => ({ width: 40, height: 40, data: new Uint8Array(40 * 40 * 3).fill(30) })) }, frameVectorGroups: groups, frameVectorSupport: support }
  const rendered = renderVectorCompletionPanels(data, 7)
  expect(rendered.summary).toContain('inferred holes 0; inferred edge 3; unknown 0')
  expect(rendered.panels.completed).not.toEqual(rendered.panels.measured)
  data.frameVectorSupport = completeFrameVectorSupport(groups, { fillEdges: false })
  expect(data.frameVectorSupport.frames[0]!.counts).toEqual({ measured: 22, holes: 0, border: 0, unknown: 3 })
  const disabled = renderVectorCompletionPanels(data, 7)
  expect(disabled.panels.completed).toEqual(disabled.panels.measured)
})

test('a unanimous full edge closes first, then its enclosed interior records hole inference', () => {
  const original = fixture().frameVectorGroups!
  const labels = Int32Array.from({ length: 25 }, (_, cell) => cell < 20 && cell % 5 > 0 && cell % 5 < 4 ? -1 : 0)
  const measured = [...labels.keys()].filter(cell => labels[cell]! >= 0)
  const groups = { ...original, width: 40, height: 40, frames: [{ frame: 0, labels, confidence: Uint8Array.from(labels, label => label >= 0 ? 2 : 0), observations: [{ id: 0, motionId: 0, cells: measured, dx: 0, dy: 0, strongCells: measured.length }] }] }
  const before = structuredClone(groups)
  const support = completeFrameVectorSupport(groups, { edgeReach: 1 })
  expect(support.frames[0]!.counts).toEqual({ measured: 13, holes: 9, border: 3, unknown: 0 })
  for (const cell of [1, 2, 3]) expect(support.frames[0]!.provenance[cell]).toBe(3)
  for (const cell of [6, 7, 8, 11, 12, 13, 16, 17, 18]) expect(support.frames[0]!.provenance[cell]).toBe(2)
  const data: RegionalData = { stage: 'vector-completion', scene: { asset: 'clip', first: 7, last: 8, sourceWidth: 40, sourceHeight: 40, frames: Array.from({ length: 2 }, () => ({ width: 40, height: 40, data: new Uint8Array(40 * 40 * 3).fill(30) })) }, frameVectorGroups: groups, frameVectorSupport: support }
  const rendered = renderVectorCompletionPanels(data, 7)
  expect(rendered.summary).toContain('Completion order: preserve established 75% edge and bounded support; extend only remaining unknown edges and corners')
  for (const options of [{ fillHoles: false, edgeReach: 1 }, { fillEdges: false, edgeReach: 1 }, { edgeReach: 0 }]) {
    data.frameVectorSupport = completeFrameVectorSupport(groups, options)
    const result = renderVectorCompletionPanels(data, 7)
    expect(result.panels.source).toEqual(rendered.panels.source)
    expect(result.panels.measured).toEqual(rendered.panels.measured)
    expect(data.frameVectorSupport.frames[0]!.counts).toEqual(options.fillHoles === false
      ? { measured: 13, holes: 0, border: 3, unknown: 9 }
      : { measured: 13, holes: 0, border: 0, unknown: 12 })
  }
  expect(groups).toEqual(before)
})

test('edges preserve a 75 percent local winner and use original frame-wide size only without one', () => {
  const original = fixture().frameVectorGroups!
  for (const local of [2, 3]) for (const extras of [0, 1, 3]) {
    const labels = new Int32Array(45).fill(-1)
    for (const cell of [1, 3, 5].slice(0, local)) labels[cell] = 0
    labels[7] = 4
    for (let index = 0; index < extras; index++) labels[20 + index] = 4
    const observations = [4, 0].map(id => {
      const cells = [...labels.keys()].filter(cell => labels[cell] === id)
      return { id, motionId: id, cells, dx: id, dy: 0, strongCells: cells.length }
    })
    const groups = { ...original, width: 72, height: 40, frames: [{ frame: 0, labels, confidence: Uint8Array.from(labels, label => label >= 0 ? 2 : 0), observations }] }
    const before = structuredClone(groups), support = completeFrameVectorSupport(groups, { fillHoles: false, edgeReach: 1 }), completed = support.frames[0]!
    expect(completed.counts.border).toBe(8 - local)
    for (let cell = 0; cell < labels.length; cell++) {
      if (labels[cell]! >= 0) {
        expect(completed.labels[cell]).toBe(labels[cell])
        expect(completed.provenance[cell]).toBe(1)
      } else if (cell < 9) {
        expect(completed.labels[cell]).toBe(local < 3 && extras + 1 > local ? 4 : 0)
        expect(completed.provenance[cell]).toBe(3)
      } else expect(completed.labels[cell]).toBe(-1)
    }
    expect(groups).toEqual(before)
  }
})

test('corners resolve different edge owners with original measured size and lowest-ID ties', () => {
  const original = fixture().frameVectorGroups!
  for (const extras of [0, 1, 2]) {
    const labels = new Int32Array(25).fill(-1)
    labels[9] = 1; labels[21] = 4
    for (let index = 0; index < extras; index++) labels[6 + index] = 4
    const observations = [4, 1].map(id => {
      const cells = [...labels.keys()].filter(cell => labels[cell] === id)
      return { id, motionId: id, cells, dx: id, dy: 0, strongCells: cells.length }
    })
    const groups = { ...original, width: 40, height: 40, frames: [{ frame: 0, labels, confidence: Uint8Array.from(labels, label => label >= 0 ? 2 : 0), observations }] }
    const before = structuredClone(groups), completed = completeFrameVectorSupport(groups, { fillHoles: false, edgeReach: 1 }).frames[0]!
    expect(completed.labels[24]).toBe(extras > 0 ? 4 : 1)
    expect(completed.provenance[24]).toBe(3)
    for (const [cell, label] of labels.entries()) if (label >= 0) expect(completed.labels[cell]).toBe(label)
    expect(groups).toEqual(before)
  }
})

test('a newly proposed bottom owner cannot replace an established right-edge corner', () => {
  const original = fixture().frameVectorGroups!, labels = new Int32Array(25).fill(-1)
  for (const cell of [6, 7, 11, 12, 21]) labels[cell] = 0
  labels[9] = 1; labels[23] = 4
  const observations = [0, 1, 4].map(id => {
    const cells = [...labels.keys()].filter(cell => labels[cell] === id)
    return { id, motionId: id, cells, dx: id, dy: 0, strongCells: cells.length }
  })
  const groups = { ...original, width: 40, height: 40, frames: [{ frame: 0, labels, confidence: Uint8Array.from(labels, label => label >= 0 ? 2 : 0), observations }] }
  const before = structuredClone(groups), completed = completeFrameVectorSupport(groups, { fillHoles: false, edgeReach: 1 }).frames[0]!
  expect(completed.labels[24]).toBe(1)
  expect(completed.labels[22]).toBe(0)
  expect(completed.provenance[24]).toBe(3)
  expect(groups).toEqual(before)
})

test('size-based edge extension preserves previously bounded foreground support', () => {
  const original = fixture().frameVectorGroups!, labels = new Int32Array(70).fill(-1)
  labels.fill(0, 0, 40); labels[60] = 0; labels[61] = 4
  labels.fill(4, 51, 60)
  const observations = [0, 4].map(id => {
    const cells = [...labels.keys()].filter(cell => labels[cell] === id)
    return { id, motionId: id, cells, dx: id, dy: 0, strongCells: cells.length }
  })
  const groups = { ...original, width: 80, height: 56, frames: [{ frame: 0, labels, confidence: Uint8Array.from(labels, label => label >= 0 ? 2 : 0), observations }] }
  const before = structuredClone(groups), completed = completeFrameVectorSupport(groups, { fillHoles: false, edgeReach: 1 }).frames[0]!
  for (const cell of [63, 64, 65, 66, 67, 68]) {
    expect(completed.labels[cell]).toBe(4)
    expect(completed.provenance[cell]).toBe(3)
  }
  expect(completed.labels[62]).toBe(0)
  expect(completed.labels[69]).toBe(0)
  for (const [cell, label] of labels.entries()) if (label >= 0) expect(completed.labels[cell]).toBe(label)
  expect(groups).toEqual(before)
})

test('mixed holes choose the largest measured touching group, not contact votes or an unrelated larger group', () => {
  const original = fixture().frameVectorGroups!
  for (const extras of [8, 6, 5]) {
    const labels = new Int32Array(63).fill(9)
    for (const cell of [22, 23, 30, 32, 39, 40, 41]) labels[cell] = 4
    labels[21] = 1; labels[31] = -1
    for (let cell = 1; cell <= extras; cell++) labels[cell] = 1
    const observations = [9, 4, 1].map(id => {
      const cells = [...labels.keys()].filter(cell => labels[cell] === id)
      return { id, motionId: id, cells, dx: id, dy: 0, strongCells: cells.length }
    })
    const groups = { ...original, width: 72, height: 56, frames: [{ frame: 0, labels, confidence: Uint8Array.from(labels, label => label >= 0 ? 2 : 0), observations }] }
    const before = structuredClone(groups), support = completeFrameVectorSupport(groups, { fillEdges: false }), completed = support.frames[0]!
    expect(completed.labels[31]).toBe(extras >= 6 ? 1 : 4)
    expect(completed.provenance[31]).toBe(2)
    expect(completed.counts).toEqual({ measured: 62, holes: 1, border: 0, unknown: 0 })
    expect(observations[0]!.cells.length).toBeGreaterThan(observations[1]!.cells.length)
    for (const [cell, label] of labels.entries()) if (label >= 0) expect(completed.labels[cell]).toBe(label)
    expect(groups).toEqual(before)
  }
})

test('direct completion kernel uses shared core while preserving the original grouped data', async () => {
  const data = fixture(), grouped: RegionalData = { ...data, stage: 'vector-groups', frameVectorSupport: undefined }, original = structuredClone(grouped)
  const bundle = await regionalKernel(step('vectorComplete'), input(grouped), () => undefined, () => false)
  try {
    const output = bundle!.outputs['out:regions:data']!
    if (output.kind !== 'regions') throw new Error('Expected completion data')
    expect(output.data.stage).toBe('vector-completion')
    expect(output.data.frameVectorSupport).toEqual(completeFrameVectorSupport(grouped.frameVectorGroups!))
    expect(output.data.frameVectorGroups).toBe(grouped.frameVectorGroups)
    expect(output.data.sequence).toBe(grouped.sequence)
  } finally { bundle!.dispose() }
  const disabled = await regionalKernel(step('vectorComplete', { fillHoles: false, fillEdges: false, edgeReach: 0 }), input(grouped), () => undefined, () => false)
  try {
    const output = disabled!.outputs['out:regions:data']!
    if (output.kind !== 'regions') throw new Error('Expected completion data')
    expect(output.data.frameVectorSupport!.options).toEqual({ fillHoles: false, fillEdges: false, edgeReach: 0 })
    expect(output.data.frameVectorSupport!.frames[0]!.labels).toEqual(grouped.frameVectorGroups!.frames[0]!.labels)
  } finally { disabled!.dispose() }
  expect(grouped).toEqual(original)
  await expect(regionalKernel(step('vectorComplete'), input({ ...grouped, stage: 'vector-candidates' }), () => undefined, () => false)).rejects.toThrow(/requires vector-groups/)
  await expect(regionalKernel(step('vectorComplete'), input(grouped), () => undefined, () => true)).rejects.toThrow(/cancelled/)
})

test('direct completion exports independent display-sized ports with one original decode', async () => {
  const data = fixture(), pixels = new Uint8Array(112 * 112 * 4).fill(120), reads: number[] = [], closes: number[] = []
  data.scene.sourceWidth = 112; data.scene.sourceHeight = 112
  const video = { frameAt: async (frame: number) => { reads.push(frame); return { displayWidth: 112, displayHeight: 112, visibleRect: null, copyTo: async (output: Uint8Array) => output.set(pixels), close: () => closes.push(frame) } } } as unknown as VideoSource
  const bundle = await regionalKernel(step('vectorCompletionInspect', { frame: 7 }), input(data), () => video, () => false)
  try {
    const ports = ['source', 'measured', 'completed', 'provenance'].map(port => image(bundle!.outputs[`out:frame:${port}`]).mat)
    for (const mat of ports) expect([mat.cols, mat.rows]).toEqual([112, 112])
    expect(new Set(ports.map(mat => mat.data32F.byteOffset)).size).toBe(4)
    expect(reads).toEqual([7]); expect(closes).toEqual([7])
  } finally { bundle!.dispose() }
})

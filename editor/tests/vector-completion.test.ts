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
  for (const cell of [0, 24]) {
    expect(pixel('measured', cell)).toEqual(pixel('source', cell))
    expect(pixel('completed', cell)).not.toEqual(pixel('source', cell))
  }
  expect(pixel('completed', 40)).toEqual(pixel('source', 40))
  expect(pixel('provenance', 40)).toEqual(pixel('source', 40))
  expect(new Set([1, 24, 0, 40].map(cell => pixel('provenance', cell).join(','))).size).toBe(4)
  expect(result.summary).toContain('inferred holes 1; inferred edge 7; unknown 1')
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

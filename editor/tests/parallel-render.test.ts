import { expect, test } from 'vite-plus/test'
import { DEFAULT_RENDER_WORKERS, orderedParallel, renderFrameBatches, renderWorkerCount, usesSceneAnalysis } from '../src/engine/parallel-render'
import { outputTime } from '../src/engine/time'
import { connect, groupNodes, parseDocument } from '../src/engine/graph'
import { regionalLayersGraph } from '../src/engine/regional-prefab'
import { defaultParams } from '../src/engine/specs'
import type { GraphDocument, GraphNode, NodeType } from '../src/engine/types'

test('parallel results preserve frame order with bounded buffers and exclusive worker slots', async () => {
  const active = new Set<number>(), consumed: number[] = [], completion: number[] = []
  let outstanding = 0, peak = 0, parallel = 0
  await orderedParallel(15, 3, async (index, slot) => {
    expect(active.has(slot)).toBe(false)
    active.add(slot); outstanding++; peak = Math.max(peak, outstanding); parallel = Math.max(parallel, active.size)
    await new Promise(resolve => setTimeout(resolve, index === 0 ? 25 : 1))
    active.delete(slot); completion.push(index); return index * 2
  }, async (value, index) => {
    expect(value).toBe(index * 2); consumed.push(index)
    await new Promise(resolve => setTimeout(resolve, 1)); outstanding--
  }, () => false)
  expect(completion[0]).not.toBe(0)
  expect(consumed).toEqual(Array.from({ length: 15 }, (_, i) => i))
  expect(parallel).toBe(3); expect(peak).toBeLessThanOrEqual(4); expect(outstanding).toBe(0)
})

test('cancellation keeps only a contiguous completed prefix and stops scheduling', async () => {
  const consumed: number[] = [], produced: number[] = []
  let cancelled = false
  await orderedParallel(100, 3, async index => { produced.push(index); return index }, async value => { consumed.push(value); cancelled = consumed.length === 2 }, () => cancelled)
  expect(consumed).toEqual([0, 1]); expect(produced.length).toBeLessThanOrEqual(5)
  await orderedParallel(10, 3, async () => { throw new Error('Already cancelled renders must not start') }, async () => {}, () => true)
})

test('a future worker failure is handled and never skips the failed frame', async () => {
  const consumed: number[] = []
  await expect(orderedParallel(10, 3, async index => {
    if (index === 2) throw new Error('Decoder failed')
    await new Promise(resolve => setTimeout(resolve, 1)); return index
  }, async value => { consumed.push(value) }, () => false)).rejects.toThrow('Decoder failed')
  expect(consumed).toEqual([0, 1])
})

test('automatic concurrency respects short renders, small machines and explicit comparisons', () => {
  expect(renderWorkerCount(0, 100, 32, 8)).toBe(2)
  expect(renderWorkerCount(0, 12, 32, 8)).toBe(1)
  expect(renderWorkerCount(0, 100, 2, 8)).toBe(1)
  expect(renderWorkerCount(0, 100, 8, 2)).toBe(1)
  for (const count of [1, 2, 4, 8, 16] as const) expect(renderWorkerCount(count, 100, 32, 8)).toBe(count)
  expect(renderWorkerCount(16, 100, 8, 8)).toBe(8)
  expect(renderWorkerCount(16, 3, 32, 8)).toBe(3)
  expect(renderWorkerCount(4, 2, 32, 8)).toBe(2)
  expect(renderWorkerCount(1, 100, 32, 8)).toBe(1)
})

test('four-worker default respects device and frame limits without opting into Auto', () => {
  expect(DEFAULT_RENDER_WORKERS).toBe(4)
  expect(renderWorkerCount(DEFAULT_RENDER_WORKERS, 300, 32, 8, true)).toBe(4)
  expect(renderWorkerCount(DEFAULT_RENDER_WORKERS, 300, 2, 8, true)).toBe(2)
  expect(renderWorkerCount(DEFAULT_RENDER_WORKERS, 2, 32, 8, true)).toBe(2)
  expect(renderWorkerCount(DEFAULT_RENDER_WORKERS, 300, 0, undefined, true)).toBe(1)
  expect(renderWorkerCount(0, 300, 32, 8, true)).toBe(1)
})

test('automatic regional rendering reuses one scene cache while explicit worker choices remain available', () => {
  expect(renderWorkerCount(0, 300, 32, 8, true)).toBe(1)
  expect(renderWorkerCount(0, 300, 32, 8, false)).toBe(2)
  for (const count of [1, 2, 4, 8, 16] as const) expect(renderWorkerCount(count, 300, 32, 8, true)).toBe(count)
  expect(renderWorkerCount(16, 3, 8, 8, true)).toBe(3)
})

const node = (id: string, type: NodeType): GraphNode => ({ id, type, params: defaultParams(type), position: { x: 0, y: 0 } })
const withIndependentOutput = (): GraphDocument => {
  const doc = regionalLayersGraph()
  doc.nodes.push(node('nplain', 'source'), node('nplainoutput', 'output'))
  return connect(doc, { source: 'nplain', sourceHandle: 'out:frame:image', target: 'nplainoutput', targetHandle: 'in:frame:image' })
}

test('whole-scene scheduling follows only the chosen target, not disconnected regional branches', () => {
  const doc = parseDocument(withIndependentOutput())
  expect(usesSceneAnalysis(doc, 'n5')).toBe(true)
  expect(usesSceneAnalysis(doc, 'nplainoutput')).toBe(false)
  expect(usesSceneAnalysis(doc, 'n1')).toBe(false)
  expect(usesSceneAnalysis(doc, 'nlast')).toBe(false)
  expect(usesSceneAnalysis(doc, 'nscene')).toBe(true)
  expect(usesSceneAnalysis(doc, 'ndense')).toBe(true)
})

test('nested groups are output-selective, including inspection through an instance path', () => {
  let doc = withIndependentOutput()
  doc = groupNodes(doc, undefined, ['ncompletionview', 'nplain'], 'Two independent images', 'ginner', 'ninner')
  doc = groupNodes(doc, undefined, ['ninner'], 'Nested images', 'gouter', 'nouter')
  const regionalPort = doc.edges.find(e => e.target === 'n5')!.sourceHandle
  const ordinaryPort = doc.edges.find(e => e.target === 'nplainoutput')!.sourceHandle
  expect(usesSceneAnalysis(doc, 'n5')).toBe(true)
  expect(usesSceneAnalysis(doc, 'nplainoutput')).toBe(false)
  expect(usesSceneAnalysis(doc, 'nouter', regionalPort)).toBe(true)
  expect(usesSceneAnalysis(doc, 'nouter', ordinaryPort)).toBe(false)
  expect(usesSceneAnalysis(doc, 'ncompletionview', null, ['nouter', 'ninner'])).toBe(true)
  expect(usesSceneAnalysis(doc, 'nplain', null, ['nouter', 'ninner'])).toBe(false)
})

test('group input dependencies resolve to each instance parent without treating every input as used', () => {
  let doc = withIndependentOutput()
  doc.nodes.push(node('nregionalblur', 'blur'), node('nordinaryblur', 'blur'))
  doc.edges = doc.edges.filter(e => !['n5', 'nplainoutput'].includes(e.target))
  for (const [source, target] of [['nreview', 'nregionalblur'], ['nregionalblur', 'n5'], ['nplain', 'nordinaryblur'], ['nordinaryblur', 'nplainoutput']]) {
    doc = connect(doc, { source: source!, sourceHandle: 'out:frame:image', target: target!, targetHandle: 'in:frame:image' })
  }
  doc = groupNodes(doc, undefined, ['nregionalblur', 'nordinaryblur'], 'Independent inputs', 'ginputs', 'ninputs')
  doc = groupNodes(doc, undefined, ['ninputs'], 'Nested inputs', 'gwrapped', 'nwrapped')
  expect(usesSceneAnalysis(doc, 'n5')).toBe(true)
  expect(usesSceneAnalysis(doc, 'nplainoutput')).toBe(false)
  expect(usesSceneAnalysis(doc, 'nregionalblur', null, ['nwrapped', 'ninputs'])).toBe(true)
  expect(usesSceneAnalysis(doc, 'nordinaryblur', null, ['nwrapped', 'ninputs'])).toBe(false)
})

test('regional dependencies through parameter wires are detected without evaluating dynamic values', () => {
  let doc = withIndependentOutput()
  doc.nodes.push(node('nregionalinfo', 'imageInfo'), node('nordinaryblur', 'blur'))
  doc.edges = doc.edges.filter(e => e.target !== 'nplainoutput')
  const wires = [
    ['nplain', 'out:frame:image', 'nordinaryblur', 'in:frame:image'],
    ['nordinaryblur', 'out:frame:image', 'nplainoutput', 'in:frame:image'],
    ['nreview', 'out:frame:image', 'nregionalinfo', 'in:frame:image'],
    ['nregionalinfo', 'out:scalar:width', 'nordinaryblur', 'param:sigma'],
  ] as const
  for (const [source, sourceHandle, target, targetHandle] of wires) doc = connect(doc, { source, sourceHandle, target, targetHandle })
  expect(usesSceneAnalysis(doc, 'nplainoutput')).toBe(true)
  doc.edges = doc.edges.filter(e => e.targetHandle !== 'param:sigma')
  expect(usesSceneAnalysis(doc, 'nplainoutput')).toBe(false)
})

test('60 fps output reuses source-frame work without losing fractional timestamps or order', () => {
  const batches = renderFrameBatches(141, 0, 24000 / 1001, 60)
  expect(batches.length).toBe(56)
  expect(batches.flat()).toEqual(Array.from({ length: 141 }, (_, i) => i))
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(3)
    expect(new Set(batch.map(i => Math.floor(outputTime(i, 0, 24000 / 1001, 60)))).size).toBe(1)
  }
  expect(batches[0]!.map(i => outputTime(i, 0, 24000 / 1001, 60))).toEqual([0, 0.3996003996003996, 0.7992007992007992])
})

test('batches remain bounded at high output rates and preserve nonzero start times', () => {
  const batches = renderFrameBatches(10, 7, 24, 120)
  expect(batches).toEqual([[0, 1, 2], [3, 4], [5, 6, 7], [8, 9]])
  expect(renderFrameBatches(4, 7, 60, 24)).toEqual([[0], [1], [2], [3]])
  expect(renderFrameBatches(0, 0, 24, 60)).toEqual([])
})

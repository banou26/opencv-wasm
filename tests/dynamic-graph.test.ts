import { expect, test } from 'vite-plus/test'
import { ResultCache } from '../src/engine/cache'
import { evaluateGraph } from '../src/engine/evaluate'
import type { GraphEvaluation } from '../src/engine/evaluate'
import { connect, parseDocument, groupNodes, insertPrefab, validateConnection } from '../src/engine/graph'
import { SPECS, defaultParams } from '../src/engine/specs'
import { explicitGraph } from '../src/engine/prefabs'
import { updateInterface } from '../src/engine/interfaces'
import { updateDataType } from '../src/engine/data-types'
import type { GraphDocument, GraphNode, NodeType, Params } from '../src/engine/types'

const n = (id: string, type: NodeType, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } })
const doc = (...nodes: GraphNode[]): GraphDocument => ({ version: 1, nodes, edges: [] })
const wire = (graph: GraphDocument, source: string, sourceHandle: string, target: string, targetHandle: string) => connect(graph, { source, sourceHandle, target, targetHandle })
const fixture = () => {
  let count = 0, destroyed = 0, cancel = false
  const sourceFrames: number[] = [], parameters: Params[] = []
  const context: GraphEvaluation<string | number | boolean> = {
    cache: new ResultCache(10000), assets: { clip: { frameCount: 40 } }, sourceId: 'clip', cancelled: () => cancel, yield: async () => {}, now: () => 0, status: () => {}, parameter: value => value,
    kernel: async (step, inputs) => {
      count++; parameters.push(step.node.params)
      let outputs: Record<string, string | number | boolean> = {}
      if (step.node.type === 'source') { sourceFrames.push(step.frame); outputs = { 'out:frame:image': step.frame } }
      else if (step.node.type === 'clip') outputs = { 'out:video:clip': step.asset! }
      else if (step.node.type === 'readFrame') {
        const index = Number(step.node.params.frame), frames = context.assets[String(inputs['in:video:clip'])]!.frameCount
        if (index >= frames) throw new Error('Frame is outside this clip')
        sourceFrames.push(index); outputs = { 'out:frame:image': index }
      }
      else if (step.node.type === 'constant') outputs = { 'out:scalar:value': Number(step.node.params.value) }
      else if (step.node.type === 'time') outputs = { 'out:scalar:index': Math.floor(step.frame), 'out:scalar:frame': step.frame }
      else if (step.node.type === 'text') outputs = { 'out:string:value': String(step.node.params.value) }
      else if (step.node.type === 'boolean') outputs = { 'out:boolean:value': Boolean(step.node.params.value) }
      else outputs = { 'out:frame:image': inputs['in:frame:image'] ?? 0, 'out:frame:delta': Number(inputs['in:frame:b']) - Number(inputs['in:frame:a']) }
      return { outputs, bytes: 8, dispose: () => { destroyed++ } }
    },
  }
  return { context, sourceFrames, parameters, cancel: () => { cancel = true }, get count() { return count }, get destroyed() { return destroyed } }
}

test('every builtin parameter has a socket of the correct type and retains its fallback', () => {
  for (const spec of Object.values(SPECS)) for (const p of spec.parameters) {
    const socket = spec.inputs.find(input => input.parameter === p.key)
    expect(socket, `${spec.title}.${p.key}`).toMatchObject({ optional: true, type: p.kind === 'number' ? 'scalar' : p.kind === 'boolean' ? 'boolean' : 'string' })
  }
})
test('all explicit prefabs validate and Video cannot wire directly into an image transform', () => {
  for (const mode of ['filter', 'difference', 'motion', 'mask', 'crop', 'pyramid'] as const) expect(() => parseDocument(explicitGraph(mode))).not.toThrow()
  const graph = doc(n('nclip', 'clip'), n('ngray', 'grayscale'))
  expect(validateConnection(graph, { source: 'nclip', sourceHandle: 'out:video:clip', target: 'ngray', targetHandle: 'in:frame:image' })).toMatch(/video.*frame/)
})
test('computed frame indices are evaluated before a frozen branch is decoded', async () => {
  const f = fixture()
  let graph = doc(n('nsource', 'source'), n('nindex', 'constant', { value: 7 }), n('nread', 'extractFrame'))
  graph = wire(graph, 'nsource', 'out:frame:image', 'nread', 'in:frame:image'); graph = wire(graph, 'nindex', 'out:scalar:value', 'nread', 'param:frame')
  const output = await evaluateGraph(graph, 'nread', null, 2, [], f.context)
  expect(output.value).toBe(7); expect(f.sourceFrames).toEqual([7]); output.release()
  graph.nodes.find(n => n.id === 'nindex')!.params.value = 12
  const next = await evaluateGraph(graph, 'nread', null, 2, [], f.context)
  expect(next.value).toBe(12); next.release(); f.context.cache.clear(); expect(f.destroyed).toBe(f.count)
})
test('a dynamic B offset changes its source time while A stays at the caller time', async () => {
  const f = fixture(); let graph = doc(n('na', 'source'), n('nb', 'constant', { value: 4 }), n('nd', 'delta'))
  graph = wire(graph, 'na', 'out:frame:image', 'nd', 'in:frame:a'); graph = wire(graph, 'na', 'out:frame:image', 'nd', 'in:frame:b'); graph = wire(graph, 'nb', 'out:scalar:value', 'nd', 'param:offset')
  const result = await evaluateGraph(graph, 'nd', null, 5, [], f.context)
  expect(result.value).toBe(4); expect(f.sourceFrames).toEqual([5, 9]); result.release(); f.context.cache.clear()
})
test('dynamic parameters use the same bounds as inline values and release dependencies on rejection', async () => {
  const f = fixture(); let graph = doc(n('ns', 'source'), n('nv', 'constant', { value: -1 }), n('nb', 'blur'))
  graph = wire(graph, 'ns', 'out:frame:image', 'nb', 'in:frame:image'); graph = wire(graph, 'nv', 'out:scalar:value', 'nb', 'param:radius')
  await expect(evaluateGraph(graph, 'nb', null, 0, [], f.context)).rejects.toThrow('Radius')
  expect(f.sourceFrames).toEqual([]); f.context.cache.clear(); expect(f.destroyed).toBe(f.count)
})
test('text values override defaults and survive grouping', async () => {
  const f = fixture(); let graph = doc(n('ns', 'source'), n('nt', 'text', { value: 'average' }), n('ng', 'grayscale'))
  graph = wire(graph, 'ns', 'out:frame:image', 'ng', 'in:frame:image'); graph = wire(graph, 'nt', 'out:string:value', 'ng', 'param:weights')
  graph = groupNodes(graph, undefined, ['ng'], 'Gray', 'ggray', 'ncustom')
  const result = await evaluateGraph(graph, 'ncustom', null, 3, [], f.context)
  expect(result.value).toBe(3); expect(f.parameters.at(-1)?.weights).toBe('average'); result.release(); f.context.cache.clear()
})
test('numeric graphs can run without any video and reuse cached results', async () => {
  const f = fixture(); f.context.sourceId = undefined; f.context.assets = {}
  const graph = doc(n('nv', 'constant', { value: 17 }))
  for (let i = 0; i < 2; i++) { const result = await evaluateGraph(graph, 'nv', null, 0, [], f.context); expect(result.value).toBe(17); result.release() }
  expect(f.count).toBe(1); f.context.cache.clear()
})
test('named record types cannot connect to a different schema, and edits prune only invalid field wires', () => {
  const fields = [{ id: 'amount', label: 'Amount', type: 'scalar' as const, default: 2 }]
  let graph = parseDocument({ ...doc({ ...n('nmake', 'makeRecord'), dataType: 'tfirst', params: { amount: 2 } }, { ...n('nbreak', 'breakRecord'), dataType: 'tfirst' }, { ...n('nother', 'breakRecord'), dataType: 'tsecond' }, n('nvalue', 'constant')), dataTypes: [{ id: 'tfirst', name: 'First', fields }, { id: 'tsecond', name: 'Second', fields }] })
  graph = wire(graph, 'nmake', 'record', 'nbreak', 'record'); graph = wire(graph, 'nvalue', 'out:scalar:value', 'nmake', 'amount')
  expect(validateConnection(graph, { source: 'nmake', sourceHandle: 'record', target: 'nother', targetHandle: 'record' })).toMatch(/types must match/)
  const edited = updateDataType(graph, { id: 'tfirst', name: 'First', fields: [{ id: 'amount', label: 'Label', type: 'string' }] })
  expect(edited.edges).toHaveLength(1); expect(edited.nodes.find(n => n.id === 'nmake')?.params).toEqual({ amount: '' })
})
test('importing a prefab remaps colliding record schemas instead of changing existing types', () => {
  const record = (name: string): GraphDocument => ({ ...doc({ ...n('nmake', 'makeRecord'), dataType: 'trecord', params: { label: name } }), dataTypes: [{ id: 'trecord', name, fields: [{ id: 'label', label: 'Label', type: 'string' }] }] })
  let id = 0
  const result = insertPrefab(record('Original'), record('Imported'), { x: 50, y: 100 }, () => `nnew${++id}`)
  expect(result.dataTypes).toHaveLength(2); expect(result.nodes[0]?.dataType).toBe('trecord'); expect(result.nodes[1]?.dataType).not.toBe('trecord'); expect(() => parseDocument(result)).not.toThrow()
})

test('different subframes with the same computed frame index reuse decoded pixels', async () => {
  const f = fixture(); let graph = doc(n('ns', 'source'), n('nt', 'time'), n('ne', 'extractFrame'))
  graph = wire(graph, 'ns', 'out:frame:image', 'ne', 'in:frame:image'); graph = wire(graph, 'nt', 'out:scalar:index', 'ne', 'param:frame')
  for (const time of [2.1, 2.5, 2.9]) { const result = await evaluateGraph(graph, 'ne', null, time, [], f.context); expect(result.value).toBe(2); result.release() }
  expect(f.sourceFrames).toEqual([2]); expect(f.parameters.filter(p => p.frame === 2)).toHaveLength(1); f.context.cache.clear()
})

test('source traces include cached dependencies after dynamic parameters resolve', async () => {
  const f = fixture(), traces: number[] = []
  f.context.trace = step => { if (step.node.type === 'source') traces.push(step.frame) }
  let graph = doc(n('ns', 'source'), n('nv', 'constant', { value: 7 }), n('ne', 'extractFrame'))
  graph = wire(graph, 'ns', 'out:frame:image', 'ne', 'in:frame:image'); graph = wire(graph, 'nv', 'out:scalar:value', 'ne', 'param:frame')
  for (let i = 0; i < 2; i++) { const result = await evaluateGraph(graph, 'ne', null, 0, [], f.context); result.release() }
  expect(traces).toEqual([7, 7]); expect(f.sourceFrames).toEqual([7]); f.context.cache.clear()
})

test('custom interfaces can change primitive types without keeping an incompatible fallback', () => {
  const definition = { id: 'gvalue', name: 'Value', inputs: [{ id: 'value', label: 'Value', type: 'scalar' as const, default: 7 }], outputs: [{ id: 'value', label: 'Value', type: 'scalar' as const }], graph: { ...doc(n('ninput', 'groupInput'), n('noutput', 'groupOutput')), edges: [{ id: 'evalue', source: 'ninput', sourceHandle: 'value', target: 'noutput', targetHandle: 'value' }] } }
  const graph = parseDocument({ ...doc({ ...n('ninstance', 'group'), definition: definition.id, params: { value: 5 } }), definitions: [definition] })
  const boolean = updateInterface(graph, definition.id, { name: definition.name, inputs: [{ id: 'value', label: 'Enabled', type: 'boolean', default: true }], outputs: [{ id: 'value', label: 'Enabled', type: 'boolean' }] })
  expect(boolean.nodes[0]?.params).toEqual({ value: true }); expect(boolean.definitions?.[0]?.graph.edges).toHaveLength(1)
  const text = updateInterface(boolean, definition.id, { name: definition.name, inputs: [{ id: 'value', label: 'Label', type: 'string', default: 'sky' }], outputs: [{ id: 'value', label: 'Label', type: 'string' }] })
  expect(text.nodes[0]?.params).toEqual({ value: 'sky' }); expect(text.definitions?.[0]?.graph.edges).toHaveLength(1)
})
test('editing a group interface retains named-record context inside its graph', () => {
  let graph: GraphDocument = { ...doc({ ...n('nmake', 'makeRecord'), dataType: 'tdata', params: { amount: 2 } }, { ...n('nbreak', 'breakRecord'), dataType: 'tdata' }), dataTypes: [{ id: 'tdata', name: 'Data', fields: [{ id: 'amount', label: 'Amount', type: 'scalar' }] }] }
  graph = wire(graph, 'nmake', 'record', 'nbreak', 'record'); graph = groupNodes(graph, undefined, ['nbreak'], 'Unpack', 'gunpack', 'ninstance')
  const definition = graph.definitions![0]!
  const renamed = updateInterface(graph, definition.id, { name: 'Read Data', inputs: definition.inputs, outputs: definition.outputs })
  expect(renamed.definitions?.[0]?.name).toBe('Read Data'); expect(renamed.definitions?.[0]?.inputs[0]?.schema).toBe('tdata')
  expect(() => parseDocument(renamed)).not.toThrow()
})

test('rendering holds each explicit clip endpoint and cannot leak that behavior into inspection', async () => {
  const f = fixture()
  f.context.assets.short = { frameCount: 3 }
  f.context.clipFrameCount = value => f.context.assets[String(value)]?.frameCount
  let graph = doc({ ...n('nv', 'clip'), asset: 'short' }, n('nf', 'readFrame', { frame: 3 }))
  graph = wire(graph, 'nv', 'out:video:clip', 'nf', 'in:video:clip')
  const result = await evaluateGraph(graph, 'nf', null, 39.5, [], { ...f.context, holdLastFrame: true })
  expect(result.value).toBe(2); expect(f.sourceFrames).toEqual([2]); result.release()
  expect(graph.nodes[1]?.params.frame).toBe(3)
  await expect(evaluateGraph(graph, 'nf', null, 39.5, [], f.context)).rejects.toThrow('outside this clip')
  graph.nodes[1]!.params.frame = 2
  const cached = await evaluateGraph(graph, 'nf', null, 39.5, [], f.context)
  expect(cached.value).toBe(2); expect(f.sourceFrames).toEqual([2]); cached.release(); f.context.cache.clear()
})
test('rendering legacy N+1 graphs holds the last drawing while inspection still rejects it', async () => {
  const f = fixture(); let graph = doc(n('ns', 'source'), n('nd', 'delta'))
  graph = wire(graph, 'ns', 'out:frame:image', 'nd', 'in:frame:a'); graph = wire(graph, 'ns', 'out:frame:image', 'nd', 'in:frame:b')
  const result = await evaluateGraph(graph, 'nd', null, 39.5, [], { ...f.context, holdLastFrame: true })
  expect(result.value).toBe(0); expect(f.sourceFrames).toEqual([39]); result.release()
  await expect(evaluateGraph(graph, 'nd', null, 39.5, [], f.context)).rejects.toThrow('outside this clip')
  await expect(evaluateGraph(graph, 'nd', null, -1, [], { ...f.context, holdLastFrame: true })).rejects.toThrow('outside this clip')
  f.context.cache.clear()
})

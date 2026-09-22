import { describe, expect, it } from 'vite-plus/test'
import { connect, groupNodes, insertPrefab, parseDocument, starterGraph } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import { graphView } from '../src/engine/definitions'
import { updateInterface } from '../src/engine/interfaces'
import { searchNodes, typoDistance } from '../src/engine/search'

describe('custom-node execution', () => {
  it('Translate compiles to independent X and Y primitives, with no opaque transform kernel', () => {
    const doc = parseDocument(starterGraph('motion')), plan = planGraph(doc, 'n5', null, 2.5, 'clip', 40)
    expect(plan.steps.map(s => s.node.type)).toContain('translateX')
    expect(plan.steps.map(s => s.node.type)).toContain('translateY')
    expect(plan.steps.some(s => s.node.type === 'group')).toBe(false)
    expect(plan.steps.find(s => s.node.type === 'translateY')?.path).toEqual(['n3'])
  })
  it('inspects an internal operation with the exact same parent input values', () => {
    const doc = starterGraph('motion'), root = planGraph(doc, 'n5', null, 5.5, 'clip', 40)
    const inside = planGraph(doc, 'ny', null, 5.5, 'clip', 40, ['n3'])
    expect(inside.target).toEqual(root.target)
    const input = planGraph(doc, 'ninput', 'x', 5.5, 'clip', 40, ['n3'])
    expect(input.target).toEqual(root.steps.find(s => s.node.type === 'translateX')!.inputs['in:scalar:pixels'])
  })
  it('encapsulation preserves outputs and propagates N+1 across the group boundary', () => {
    const doc = starterGraph(), before = planGraph(doc, 'n5', null, 7, 'clip', 40)
    const grouped = groupNodes(doc, undefined, ['n2', 'n3', 'n4'], 'Difference', 'gdifference', 'n99')
    expect(planGraph(grouped, 'n5', null, 7, 'clip', 40).target).toEqual(before.target)
    const internal = planGraph(grouped, 'n4', 'out:scalar:mean', 7, 'clip', 40, ['n99'])
    expect(internal.steps.filter(s => s.node.type === 'source').map(s => s.frame)).toEqual([7, 8])
    expect(internal.target.port).toBe('out:scalar:mean')
  })
  it('supports nested custom nodes and distinct instances with independent numeric defaults', () => {
    let doc = starterGraph('motion')
    doc.edges = doc.edges.filter(e => e.target !== 'n3' || e.targetHandle === 'image')
    doc.nodes.find(n => n.id === 'n3')!.params = { x: 12, y: -3 }
    const original = planGraph(doc, 'n5', null, 2, 'clip', 40).target
    doc = groupNodes(doc, undefined, ['n3'], 'Wrapper', 'gwrapper', 'nwrapper')
    expect(planGraph(doc, 'n5', null, 2, 'clip', 40).target).toEqual(original)
    expect(planGraph(doc, 'ny', null, 2, 'clip', 40, ['nwrapper', 'n3']).target).toEqual(original)
    const translate = doc.definitions!.find(d => d.id === 'gwrapper')!.graph.nodes.find(n => n.id === 'n3')!
    translate.params.x = 20
    expect(planGraph(doc, 'n5', null, 2, 'clip', 40).target).not.toEqual(original)
  })
  it('preserves cache identities when changing only labels, positions or instance IDs', () => {
    const doc = starterGraph('motion'), before = planGraph(doc, 'n5', null, 2.5, 'clip', 40).target
    const definition = doc.definitions![0]!
    definition.name = 'My translate'; definition.inputs[0]!.label = 'My image'; definition.graph.nodes[1]!.position.x += 100
    expect(planGraph(doc, 'n5', null, 2.5, 'clip', 40).target).toEqual(before)
    expect(JSON.stringify(parseDocument(JSON.parse(JSON.stringify(doc))))).toContain('My translate')
  })
  it('refuses missing and recursive definitions before starting native work', () => {
    const doc = starterGraph('motion')
    expect(() => parseDocument({ ...doc, definitions: [] })).toThrow('Missing custom-node')
    doc.definitions![0]!.graph.nodes.push({ id: 'nrecursive', type: 'group', definition: 'gtranslate', params: { x: 0, y: 0 }, position: { x: 1, y: 1 } })
    expect(() => parseDocument(doc)).toThrow('recursive')
  })
  it('type changes remove incompatible internal and external wires, while preserving matching ones', () => {
    const doc = starterGraph('motion'), definition = doc.definitions![0]!
    const changed = updateInterface(doc, definition.id, { name: definition.name, inputs: definition.inputs.map(p => p.id === 'image' ? { ...p, type: 'scalar' } : p), outputs: definition.outputs })
    expect(changed.edges.some(e => e.target === 'n3' && e.targetHandle === 'image')).toBe(false)
    expect(changed.edges.filter(e => e.target === 'n3')).toHaveLength(2)
    expect(graphView(changed, 'gtranslate').edges.some(e => e.source === 'ninput' && e.sourceHandle === 'image')).toBe(false)
    expect(doc.edges.some(e => e.target === 'n3' && e.targetHandle === 'image')).toBe(true)
  })
  it('interface connections use the same frame/scalar type validation as the main graph', () => {
    const view = graphView(starterGraph('motion'), 'gtranslate')
    expect(() => connect(view, { source: 'ninput', sourceHandle: 'x', target: 'nx', targetHandle: 'in:frame:image' })).toThrow('scalar output cannot connect')
  })
  it('merges conflicting libraries without changing the meaning of nested imported definitions', () => {
    const incoming = groupNodes(starterGraph('motion'), undefined, ['n3'], 'Wrapper', 'gwrapper', 'nwrapper')
    const base = structuredClone(incoming)
    base.definitions!.find(d => d.id === 'gtranslate')!.graph.nodes.find(n => n.type === 'translateX')!.params.pixels = 4
    let count = 100
    const combined = insertPrefab(base, incoming, { x: 0, y: 1000 }, () => `n${count++}`)
    expect(combined.definitions).toHaveLength(4)
    const insertedWrapper = combined.nodes.find(n => n.type === 'group' && n.id !== 'nwrapper')!
    const wrapperDefinition = combined.definitions!.find(d => d.id === insertedWrapper.definition)!
    expect(wrapperDefinition.id).not.toBe('gwrapper')
    expect(wrapperDefinition.graph.nodes.find(n => n.type === 'group')!.definition).not.toBe('gtranslate')
  })
})

describe('node menu search', () => {
  it('finds misspelled names and transposed parameter names', () => {
    expect(searchNodes('gausian')[0]).toBe('blur')
    expect(searchNodes('raduis')[0]).toBe('blur')
    expect(searchNodes('threshhold')[0]).toBe('threshold')
    expect(searchNodes('transalte x')[0]).toBe('translateX')
    expect(typoDistance('radius', 'raduis')).toBe(1)
  })
  it('searches algorithm names and properties and rejects irrelevant gibberish', () => {
    expect(searchNodes('sigma')[0]).toBe('blur')
    expect(searchNodes('phaseCorrelate')[0]).toBe('motion')
    expect(searchNodes('cutoff')[0]).toBe('threshold')
    expect(searchNodes('xyzxyzxyz')).toEqual([])
    expect(searchNodes('')).not.toContain('groupInput')
  })
})

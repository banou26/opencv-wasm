import { describe, expect, test } from 'vite-plus/test'
import { connect, parseDocument, removeNode, starterGraph, topological, validateConnection } from '../src/engine/graph'
import { contentKey, planGraph } from '../src/engine/plan'

describe('graph edits and import boundaries', () => {
  test('dependencies precede their consumers even when nodes are shuffled', () => {
    const doc = starterGraph(); doc.nodes.reverse()
    const ids = topological(doc).map(n => n.id)
    for (const e of doc.edges) expect(ids.indexOf(e.source)).toBeLessThan(ids.indexOf(e.target))
  })
  test.each([
    [{ source: 'n3', target: 'n3', sourceHandle: 'out:frame:image', targetHandle: 'in:frame:image' }, 'itself'],
    [{ source: 'n3', target: 'n2', sourceHandle: 'out:frame:image', targetHandle: 'in:frame:image' }, 'cycle'],
    [{ source: 'n4', target: 'n5', sourceHandle: 'out:scalar:mean', targetHandle: 'in:frame:image' }, 'scalar'],
    [{ source: 'missing', target: 'n5' }, 'missing'],
    [{ source: 'n1', target: 'n2', sourceHandle: 'in:frame:a', targetHandle: 'out:frame:image' }, 'socket'],
  ])('rejects an invalid connection through the shared gate', (candidate, message) => {
    const doc = starterGraph(), before = JSON.stringify(doc)
    expect(validateConnection(doc, candidate)).toContain(message)
    expect(() => connect(doc, candidate)).toThrow(message)
    expect(JSON.stringify(doc)).toBe(before)
  })
  test('replacing an occupied input preserves exactly one edge', () => {
    const doc = connect(starterGraph(), { source: 'n1', target: 'n3', sourceHandle: 'out:frame:image', targetHandle: 'in:frame:image' })
    expect(doc.edges.filter(e => e.target === 'n3')).toHaveLength(1)
    expect(doc.edges.find(e => e.target === 'n3')?.source).toBe('n1')
  })
  test('deleting a node drops incident edges and preserves unrelated objects', () => {
    const doc = starterGraph(), next = removeNode(doc, 'n2')
    expect(next.edges.some(e => e.source === 'n2' || e.target === 'n2')).toBe(false)
    expect(next.nodes[0]).toBe(doc.nodes[0])
  })
  test('imported projects go through the same cycle and type checks', () => {
    const doc = starterGraph()
    doc.edges[0] = { id: 'bad', source: 'n3', target: 'n2', sourceHandle: 'out:frame:image', targetHandle: 'in:frame:image' }
    expect(() => parseDocument(doc)).toThrow('cycle')
  })
  test('refuses duplicate ids, duplicate inputs, unknown nodes and malformed params', () => {
    const doc = starterGraph(), first = doc.nodes[0]
    expect(() => parseDocument({ ...doc, nodes: [...doc.nodes, first] })).toThrow()
    expect(() => parseDocument({ ...doc, edges: [...doc.edges, { ...doc.edges[0], id: 'other' }] })).toThrow()
    expect(() => parseDocument({ ...doc, nodes: [{ ...first, type: 'constructor' }] })).toThrow()
    expect(() => parseDocument({ ...doc, nodes: [{ ...first, params: [] }] })).toThrow()
    const blur = doc.nodes.find(n => n.type === 'blur')
    if (!blur) throw new Error('Fixture has no blur')
    blur.params.radius = 0.5
    expect(() => parseDocument(doc)).toThrow('Radius')
  })
})

describe('time demands and cache identity', () => {
  test('plans N and N+1, deduplicating a shared source at offset zero', () => {
    const doc = starterGraph(), plan = planGraph(doc, 'n5', null, 7, 'clip', 30)
    expect(plan.steps.filter(s => s.node.type === 'source').map(s => s.frame)).toEqual([7, 8])
    const delta = doc.nodes.find(n => n.type === 'delta')
    if (!delta) throw new Error('Missing fixture node')
    delta.params.offset = 0
    expect(planGraph(doc, 'n5', null, 7, 'clip', 30).steps.filter(s => s.node.type === 'source')).toHaveLength(1)
  })
  test('fails before execution when a temporal demand falls outside the clip', () => {
    expect(() => planGraph(starterGraph(), 'n5', null, 29, 'clip', 30)).toThrow('outside')
    expect(() => planGraph(starterGraph(), 'n5', null, -1, 'clip', 30)).toThrow('outside')
  })
  test('changing a blur invalidates only itself and its descendants', () => {
    const doc = starterGraph(), a = planGraph(doc, 'n5', null, 3, 'clip', 30)
    const blur = doc.nodes.find(n => n.type === 'blur')
    if (!blur) throw new Error('Missing fixture node')
    blur.params.sigma = 4
    const b = planGraph(doc, 'n5', null, 3, 'clip', 30)
    for (let i = 0; i < a.steps.length; i++) {
      const x = a.steps[i], y = b.steps[i]
      if (!x || !y) throw new Error('Missing step')
      expect(x.key === y.key).toBe(x.node.type === 'source' || x.node.type === 'grayscale')
    }
  })
  test('positions and parameter property order do not invalidate processing', () => {
    const doc = starterGraph(), before = planGraph(doc, 'n5', null, 3, 'clip', 30).target.key
    for (const n of doc.nodes) { n.position.x += 500; n.params = Object.fromEntries(Object.entries(n.params).reverse()) }
    expect(planGraph(doc, 'n5', null, 3, 'clip', 30).target.key).toBe(before)
    expect(contentKey({ a: 0, b: 1 })).toBe(contentKey({ b: 1, a: -0 }))
  })
  test('source identity, time and output ports affect downstream keys', () => {
    const doc = starterGraph(), original = planGraph(doc, 'n5', null, 3, 'clip', 30)
    expect(planGraph(doc, 'n5', null, 4, 'clip', 30).target.key).not.toBe(original.target.key)
    expect(planGraph(doc, 'n5', null, 3, 'other', 30).target.key).not.toBe(original.target.key)
    expect(planGraph(doc, 'n4', 'out:scalar:mean', 3, 'clip', 30).target.port).toBe('out:scalar:mean')
  })
})

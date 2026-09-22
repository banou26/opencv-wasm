import { describe, expect, it } from 'vite-plus/test'
import { connect, insertPrefab, parseDocument, starterGraph } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import { outputCount, outputTime } from '../src/engine/time'

describe('explicit time-driven graphs', () => {
  it('reuses source and measured motion while generating a distinct intermediate frame', () => {
    const doc = starterGraph('motion')
    const a = planGraph(doc, 'n5', null, 12, 'clip', 100), b = planGraph(doc, 'n5', null, 12.5, 'clip', 100)
    expect(a.steps.filter(s => s.node.type === 'source').map(s => s.frame)).toEqual([12, 13])
    for (const type of ['source', 'motion']) expect(a.steps.filter(s => s.node.type === type).map(s => s.key)).toEqual(b.steps.filter(s => s.node.type === type).map(s => s.key))
    expect(a.target.key).not.toBe(b.target.key)
    expect(b.steps.find(s => s.node.type === 'time')?.frame).toBe(12.5)
  })
  it('holds the same transform until a time-dependent socket is actually connected', () => {
    const doc = starterGraph('motion'); doc.edges = doc.edges.filter(e => e.source !== 'n6')
    expect(planGraph(doc, 'n5', null, 12, 'clip', 100).target).toEqual(planGraph(doc, 'n5', null, 12.5, 'clip', 100).target)
  })
  it('rejects invalid time-to-image wiring without changing the prefab', () => {
    const doc = starterGraph('motion'), before = JSON.stringify(doc)
    expect(() => connect(doc, { source: 'n6', target: 'n5', sourceHandle: 'out:scalar:fraction', targetHandle: 'in:frame:image' })).toThrow('scalar output cannot connect')
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('refuses to invent the next drawing at the clip boundary', () => {
    expect(() => planGraph(starterGraph('motion'), 'n5', null, 99.5, 'clip', 100)).toThrow('outside this clip')
  })
})

describe('frame-rate conversion', () => {
  it('samples 24 fps at 60 fps with the expected fractional positions', () => {
    expect(Array.from({ length: 6 }, (_, i) => outputTime(i, 10, 24, 60))).toEqual([10, 10.4, 10.8, 11.2, 11.6, 12])
    expect(outputCount(10, 21, 24, 60)).toBe(30)
  })
  it('keeps exact NTSC boundaries instead of falling one source drawing behind', () => {
    expect(outputTime(5005, 0, 24000 / 1001, 60)).toBe(2000)
    for (const fps of [24, 25, 30, 50, 60, 120]) {
      const count = outputCount(17, 103, 24000 / 1001, fps)
      expect(Math.floor(outputTime(count - 1, 17, 24000 / 1001, fps))).toBeLessThanOrEqual(103)
      expect(outputTime(count, 17, 24000 / 1001, fps)).toBeGreaterThanOrEqual(104)
    }
  })
})

describe('prefabs are ordinary reusable subgraphs', () => {
  for (const name of ['motion', 'filter', 'difference', 'mask'] as const) it(`validates and executes the ${name} prefab as normal nodes`, () => {
    const doc = parseDocument(starterGraph(name)), plan = planGraph(doc, 'n5', null, 0.5, 'clip', 100)
    expect(plan.steps.length).toBeGreaterThan(1)
    expect(doc.nodes.every(n => !('children' in n))).toBe(true)
  })
  it('inserts independent copies, preserving all external nodes and internal wires', () => {
    const base = starterGraph('filter'), prefab = starterGraph('motion'), frozen = JSON.stringify(prefab)
    let counter = 100
    const combined = insertPrefab(base, prefab, { x: 20, y: 800 }, () => `n${counter++}`)
    expect(combined.nodes).toHaveLength(base.nodes.length + prefab.nodes.length)
    expect(combined.edges).toHaveLength(base.edges.length + prefab.edges.length)
    expect(new Set(combined.nodes.map(n => n.id)).size).toBe(combined.nodes.length)
    const last = combined.nodes.at(-1)!
    expect(planGraph(combined, last.id, null, 0.5, 'clip', 100).steps.map(s => s.node.type)).toContain('time')
    combined.nodes.find(n => n.id === 'n103')!.params.x = 50
    expect(JSON.stringify(prefab)).toBe(frozen)
    expect(combined.nodes.slice(0, base.nodes.length)).toEqual(base.nodes)
  })
  it('rejects ID collisions and malformed imported prefabs atomically', () => {
    const doc = starterGraph(), before = JSON.stringify(doc)
    expect(() => insertPrefab(doc, starterGraph(), { x: 0, y: 0 }, () => 'n1')).toThrow('duplicate node')
    expect(() => insertPrefab(doc, { version: 999 }, { x: 0, y: 0 }, () => 'n99')).toThrow('Invalid project')
    expect(JSON.stringify(doc)).toBe(before)
  })
})

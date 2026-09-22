import { describe, expect, it } from 'vite-plus/test'
import { connect, groupNodes, parseDocument } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import { defaultParams } from '../src/engine/specs'
import type { GraphDocument, GraphNode, NodeType } from '../src/engine/types'

const node = (id: string, type: NodeType, params = defaultParams(type)): GraphNode => ({ id, type, params, position: { x: 0, y: 0 } })
const wire = (doc: GraphDocument, source: string, target: string, targetHandle = 'in:frame:image', sourceHandle = 'out:frame:image') => connect(doc, { source, target, targetHandle, sourceHandle })
const fixture = () => wire({ version: 1, nodes: [node('nsource', 'source'), node('nextract', 'extractFrame', { frame: 7 })], edges: [] }, 'nsource', 'nextract')
const frames = (doc: GraphDocument, target = 'nextract', time = 20) => planGraph(doc, target, null, time, 'clip', 32).steps.filter(s => s.node.type === 'source').map(s => s.frame)

describe('Extract Frame', () => {
  it('pins source time and cache identity independently of the timeline', () => {
    const doc = fixture()
    expect(frames(doc)).toEqual([7])
    expect(planGraph(doc, 'nextract', null, 0, 'clip', 32).target).toEqual(planGraph(doc, 'nextract', null, 25.5, 'clip', 32).target)
    doc.nodes[1]!.params.frame = 0
    expect(frames(doc)).toEqual([0])
  })
  it('compares arbitrary fixed frames even when Delta requests a B offset', () => {
    let doc = fixture()
    doc.nodes.push(node('nsecond', 'extractFrame', { frame: 2 }), node('ndelta', 'delta'))
    doc = wire(doc, 'nsource', 'nsecond')
    doc = wire(doc, 'nextract', 'ndelta', 'in:frame:a')
    doc = wire(doc, 'nsecond', 'ndelta', 'in:frame:b')
    expect(frames(doc, 'ndelta', 0)).toEqual([7, 2])
    expect(frames(doc, 'ndelta', 31.5)).toEqual([7, 2])
  })
  it('runs upstream filters at the chosen frame and survives serialization', () => {
    let doc = fixture()
    doc.nodes.push(node('nblur', 'blur'))
    doc = wire(wire(doc, 'nsource', 'nblur'), 'nblur', 'nextract')
    const saved = parseDocument(JSON.parse(JSON.stringify(doc)))
    const plan = planGraph(saved, 'nextract', null, 20, 'clip', 32)
    expect(plan.steps.filter(s => ['source', 'blur'].includes(s.node.type)).map(s => s.frame)).toEqual([7, 7])
  })
  it('preserves the ordering of absolute extraction and relative offsets', () => {
    let before = fixture()
    before.nodes.push(node('noffset', 'offset', { offset: 1 }))
    before = wire(wire(before, 'nsource', 'noffset'), 'noffset', 'nextract')
    expect(frames(before)).toEqual([8])
    let after = fixture()
    after.nodes.push(node('noffset', 'offset', { offset: 1 }))
    after = wire(after, 'nextract', 'noffset')
    expect(frames(after, 'noffset')).toEqual([7])
  })
  it('carries its absolute request through custom-node boundaries', () => {
    let doc = fixture()
    doc.nodes.push(node('noutput', 'output'))
    doc = wire(doc, 'nextract', 'noutput')
    doc = groupNodes(doc, undefined, ['nextract'], 'Hold seventh', 'ghold', 'nhold')
    expect(frames(doc, 'noutput')).toEqual([7])
    const inner = planGraph(doc, 'nextract', null, 21, 'clip', 32, ['nhold'])
    expect(inner.steps.find(s => s.node.type === 'source')?.frame).toBe(7)
  })
  it('rejects negative, fractional and unavailable indices instead of clamping', () => {
    for (const frame of [-1, 1.5, NaN, Infinity]) {
      const doc = fixture(); doc.nodes[1]!.params.frame = frame
      expect(() => parseDocument(doc)).toThrow('Frame N')
      expect(() => planGraph(doc, 'nextract', null, 0, 'clip', 32)).toThrow('Frame N')
    }
    const doc = fixture(); doc.nodes[1]!.params.frame = 32
    expect(() => frames(doc)).toThrow('outside this clip')
  })
})

import { describe, expect, it } from 'vite-plus/test'
import { planGraph } from '../src/engine/plan'
import { parseDocument } from '../src/engine/graph'
import type { GraphDocument } from '../src/engine/types'

const doc: GraphDocument = {
  version: 1,
  nodes: [
    { id: 'na', type: 'source', asset: 'clip-a', assetName: 'first.mp4', params: {}, position: { x: 0, y: 0 } },
    { id: 'nb', type: 'source', asset: 'clip-b', assetName: 'second.mp4', params: {}, position: { x: 0, y: 200 } },
  ],
  edges: [],
}
const assets = { 'clip-a': { frameCount: 10 }, 'clip-b': { frameCount: 4 } }

describe('independent video source bindings', () => {
  it('keeps cache identities distinct for different videos at the same time', () => {
    const a = planGraph(doc, 'na', null, 2, 'clip-a', 10, [], assets)
    const b = planGraph(doc, 'nb', null, 2, 'clip-a', 10, [], assets)
    expect(a.target.key).not.toBe(b.target.key)
    expect(a.steps[0]?.asset).toBe('clip-a')
    expect(b.steps[0]?.asset).toBe('clip-b')
  })
  it('validates each clip length independently of the timeline reference', () => {
    expect(() => planGraph(doc, 'na', null, 7, 'clip-a', 10, [], assets)).not.toThrow()
    expect(() => planGraph(doc, 'nb', null, 7, 'clip-a', 10, [], assets)).toThrow('0 to 3')
  })
  it('asks for missing media instead of substituting the timeline clip', () => {
    expect(() => planGraph(doc, 'nb', null, 0, 'clip-a', 10, [], { 'clip-a': assets['clip-a'] })).toThrow('Reattach second.mp4')
  })
  it('retains bindings across graph serialization and rejects malformed identities', () => {
    expect(parseDocument(JSON.parse(JSON.stringify(doc))).nodes[1]?.asset).toBe('clip-b')
    expect(() => parseDocument({ ...doc, nodes: [{ ...doc.nodes[0], asset: '../clip' }] })).toThrow('Invalid source')
  })
})

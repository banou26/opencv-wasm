import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { SPECS } from './specs'
import type { GraphDocument, GraphNode } from './types'

/** An executable node at one exact source-frame index. */
export type Step = { key: string; node: GraphNode; frame: number; inputs: Record<string, { key: string; port: string }> }
/** Only the ancestors of the requested output appear, in dependency order. */
export type Plan = { steps: Step[]; target: { key: string; port: string }; minFrame: number; maxFrame: number }

/** Stable serialization makes parameter property order irrelevant to cache identity. */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite cache parameter')
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Unsupported cache parameter')
  return encoded
}

/** SHA-256 of semantic inputs, never node positions, labels or selection. */
export const contentKey = (value: unknown): string => bytesToHex(sha256(utf8ToBytes(canonical(value))))

/** Expand time demands recursively. FrameDelta's B branch propagates its offset upstream. */
export const planGraph = (doc: GraphDocument, selected: string, port: string | null, frame: number, sourceId: string, frameCount: number): Plan => {
  if (!Number.isInteger(frame)) throw new Error('Frame index must be an integer')
  const steps: Step[] = [], seen = new Set<string>(), active = new Set<string>()
  let minFrame = frame, maxFrame = frame
  const visit = (id: string, output: string | null, time: number): { key: string; port: string } => {
    const node = doc.nodes.find(n => n.id === id)
    if (!node) throw new Error('Select a node to inspect')
    if (active.has(id)) throw new Error('The graph contains a cycle')
    active.add(id)
    const spec = SPECS[node.type]
    if (node.type === 'output') {
      const edge = doc.edges.find(e => e.target === id)
      if (!edge) throw new Error('Connect an image to Output')
      const target = visit(edge.source, edge.sourceHandle, time)
      active.delete(id)
      return target
    }
    const outputPort = output ?? spec.outputs[0]?.id
    if (!outputPort || !spec.outputs.some(p => p.id === outputPort)) throw new Error('Unknown output socket')
    const inputs: Step['inputs'] = {}
    for (const p of spec.inputs) {
      const edge = doc.edges.find(e => e.target === id && e.targetHandle === p.id)
      if (!edge) throw new Error(`Connect ${spec.title}'s ${p.label} input`)
      const offset = p.offsetParam ? Number(node.params[p.offsetParam]) : 0
      inputs[p.id] = visit(edge.source, edge.sourceHandle, time + offset)
    }
    if (node.type === 'source') {
      if (!sourceId) throw new Error('Load a video clip first')
      if (time < 0 || time >= frameCount) throw new Error(`Frame ${time} is outside this clip (0 to ${frameCount - 1}). Adjust the timeline or B offset.`)
      minFrame = Math.min(minFrame, time); maxFrame = Math.max(maxFrame, time)
    }
    const key = contentKey([node.type, spec.version, node.params, inputs, node.type === 'source' ? [sourceId, time] : null])
    if (!seen.has(key)) { seen.add(key); steps.push({ key, node, frame: time, inputs }) }
    active.delete(id)
    return { key, port: outputPort }
  }
  const target = visit(selected, port, frame)
  return { steps, target, minFrame, maxFrame }
}

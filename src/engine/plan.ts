import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { specFor } from './specs'
import { graphView } from './definitions'
import type { GraphDocument, GraphNode } from './types'

/** An executable node at one exact source-frame index. */
export type Step = { key: string; node: GraphNode; frame: number; path?: string[]; asset?: string; inputs: Record<string, { key: string; port: string }> }
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

export type SourceCatalog = Record<string, { frameCount: number }>

/** Expand custom-node interfaces and time demands into ordinary primitive operations. */
export const planGraph = (root: GraphDocument, selected: string, port: string | null, frame: number, sourceId: string, frameCount: number, path: string[] = [], assets?: SourceCatalog): Plan => {
  if (!Number.isFinite(frame)) throw new Error('Frame time must be finite')
  const steps: Step[] = [], seen = new Set<string>(), active = new Set<string>()
  let minFrame = Infinity, maxFrame = -Infinity
  type Context = { doc: GraphDocument; path: string[]; parent?: Context; instance?: GraphNode; definitions: string[] }
  const rootContext: Context = { doc: root, path: [], definitions: [] }
  const enter = (context: Context, node: GraphNode): Context => {
    if (node.type !== 'group' || !node.definition) throw new Error('Invalid custom-node instance path')
    if (context.definitions.includes(node.definition)) throw new Error('Recursive custom-node definition')
    return { doc: graphView(root, node.definition), path: [...context.path, node.id], parent: context, instance: node, definitions: [...context.definitions, node.definition] }
  }
  const visit = (context: Context, id: string, output: string | null, time: number): { key: string; port: string } => {
    const doc = context.doc, node = doc.nodes.find(n => n.id === id)
    if (!node) throw new Error('Select a node to inspect')
    const address = [...context.path, id].join('/')
    if (active.has(address)) throw new Error('The graph contains a cycle')
    active.add(address)
    const finish = (target: { key: string; port: string }) => { active.delete(address); return target }
    const spec = specFor(node, doc)
    if (node.type === 'output' || node.type === 'groupOutput') {
      const socket = output ?? spec.inputs[0]?.id, edge = doc.edges.find(e => e.target === id && e.targetHandle === socket)
      if (!edge) throw new Error(`Connect ${spec.title}’s ${spec.inputs.find(p => p.id === socket)?.label ?? 'image'} input`)
      return finish(visit(context, edge.source, edge.sourceHandle, time))
    }
    const outputPort = output ?? spec.outputs[0]?.id
    if (!outputPort || !spec.outputs.some(p => p.id === outputPort)) throw new Error('Unknown output socket')
    if (node.type === 'group') {
      const child = enter(context, node), terminal = child.doc.nodes.find(n => n.type === 'groupOutput')
      if (!terminal) throw new Error('Missing Group Outputs node')
      return finish(visit(child, terminal.id, outputPort, time))
    }
    if (node.type === 'groupInput') {
      const parent = context.parent, instance = context.instance
      if (!parent || !instance) throw new Error('Open this custom node through an instance to inspect its inputs')
      const edge = parent.doc.edges.find(e => e.target === instance.id && e.targetHandle === outputPort)
      if (edge) return finish(visit(parent, edge.source, edge.sourceHandle, time))
      const input = spec.outputs.find(p => p.id === outputPort)!
      if (input.type !== 'scalar') throw new Error(`Connect ${specFor(instance, parent.doc).title}’s ${input.label} input in the parent graph`)
      const value = Number(instance.params[input.id] ?? input.default ?? 0), key = contentKey(['constant', 1, { value }, {}, null])
      if (!seen.has(key)) { seen.add(key); steps.push({ key, node: { id: node.id, type: 'constant', params: { value }, position: node.position }, frame: time, path: context.path, inputs: {} }) }
      return finish({ key, port: 'out:scalar:value' })
    }
    const inputs: Step['inputs'] = {}
    for (const p of spec.inputs) {
      const edge = doc.edges.find(e => e.target === id && e.targetHandle === p.id)
      if (!edge && p.optional) continue
      if (!edge) throw new Error(`Connect ${spec.title}’s ${p.label} input`)
      const upstreamTime = p.frameParam ? Number(node.params[p.frameParam]) : time + (p.offsetParam ? Number(node.params[p.offsetParam]) : 0)
      if (!Number.isFinite(upstreamTime) || p.frameParam && (!Number.isInteger(upstreamTime) || upstreamTime < 0)) throw new Error('Frame N must be a non-negative whole number')
      inputs[p.id] = visit(context, edge.source, edge.sourceHandle, upstreamTime)
    }
    const asset = node.type === 'source' ? node.asset ?? sourceId : undefined
    const count = asset && assets ? assets[asset]?.frameCount : frameCount
    if (node.type === 'source') {
      if (node.asset && assets && !assets[node.asset]) throw new Error(`Reattach ${node.assetName ?? 'the video'} to this Video Source node`)
      if (!asset) throw new Error('Load a video clip first')
      if (time < 0 || Math.floor(time) >= count!) throw new Error(`Frame ${time} is outside this clip (0 to ${count! - 1}). Adjust the requested frame index or the branch’s time controls.`)
      minFrame = Math.min(minFrame, Math.floor(time)); maxFrame = Math.max(maxFrame, Math.floor(time))
    }
    const key = contentKey([node.type, spec.version, node.params, inputs, node.type === 'source' ? [asset, Math.floor(time)] : node.type === 'time' ? [sourceId, time] : null])
    if (!seen.has(key)) { seen.add(key); steps.push({ key, node, frame: node.type === 'source' ? Math.floor(time) : time, path: context.path, ...(asset ? { asset } : {}), inputs }) }
    return finish({ key, port: outputPort })
  }
  let context = rootContext
  for (const id of path) { const node = context.doc.nodes.find(n => n.id === id); if (!node) throw new Error('The custom-node instance no longer exists'); context = enter(context, node) }
  const target = visit(context, selected, port, frame)
  return { steps, target, minFrame: Number.isFinite(minFrame) ? minFrame : frame, maxFrame: Number.isFinite(maxFrame) ? maxFrame : frame }
}

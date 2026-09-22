import { contentKey } from './plan'
import type { SourceCatalog, Step } from './plan'
import type { ExecutionContext } from './execute'
import { graphView } from './definitions'
import { primitiveDefault, specFor, validateParams } from './specs'
import type { Bundle, GraphDocument, GraphNode, Lease, Params } from './types'

type Target<T> = { key: string; port: string; lease: Lease<Bundle<T>> }
export type GraphEvaluation<T> = ExecutionContext<T> & {
  /** Convert a typed primitive payload to the serializable parameter it carries. */
  parameter: (value: T) => string | number | boolean
  sourceId?: string
  assets: SourceCatalog
  /** Observe resolved steps, including cache hits, for truthful source-frame provenance. */
  trace?: (step: Step, inputs: Record<string, T>) => void
}

/**
 * Evaluate parameter wires before image/time dependencies. A computed frame index or
 * legacy B offset can therefore change which frames are requested, rather than merely
 * relabeling an already-computed frame. Input leases survive until the native operation has produced an independently owned result.
 */
export const evaluateGraph = async <T>(root: GraphDocument, selected: string, port: string | null, frame: number, path: string[], context: GraphEvaluation<T>): Promise<Lease<T>> => {
  if (!Number.isFinite(frame)) throw new Error('Frame time must be finite')
  const active = new Set<string>()
  type Scope = { doc: GraphDocument; path: string[]; parent?: Scope; instance?: GraphNode; definitions: string[] }
  const check = () => { if (context.cancelled()) throw new Error('Cancelled') }
  const enter = (scope: Scope, node: GraphNode): Scope => {
    if (node.type !== 'group' || !node.definition || scope.definitions.includes(node.definition)) throw new Error('Invalid or recursive custom-node instance')
    return { doc: graphView(root, node.definition), path: [...scope.path, node.id], parent: scope, instance: node, definitions: [...scope.definitions, node.definition] }
  }
  const visit = async (scope: Scope, id: string, requested: string | null, time: number): Promise<Target<T>> => {
    check()
    const node = scope.doc.nodes.find(n => n.id === id)
    if (!node) throw new Error('Select a node to inspect')
    const spec = specFor(node, scope.doc), address = [...scope.path, id].join('/')
    if (active.has(address)) throw new Error('The graph contains a cycle')
    active.add(address)
    const inputs = new Map<string, Target<T>>()
    let transferred = false
    try {
      if (node.type === 'output' || node.type === 'groupOutput') {
        const input = requested ?? spec.inputs[0]?.id, edge = scope.doc.edges.find(e => e.target === id && e.targetHandle === input)
        if (!edge) throw new Error(`Connect ${spec.title}’s ${spec.inputs.find(p => p.id === input)?.label ?? 'frame'} input`)
        return await visit(scope, edge.source, edge.sourceHandle, time)
      }
      const output = requested ?? spec.outputs[0]?.id
      if (!output || !spec.outputs.some(p => p.id === output)) throw new Error('Unknown output socket')
      if (node.type === 'group') {
        const child = enter(scope, node), terminal = child.doc.nodes.find(n => n.type === 'groupOutput')
        if (!terminal) throw new Error('Missing Group Outputs node')
        return await visit(child, terminal.id, output, time)
      }
      if (node.type === 'groupInput') {
        const parent = scope.parent, instance = scope.instance
        if (!parent || !instance) throw new Error('Open a custom node through an instance to inspect its inputs')
        const edge = parent.doc.edges.find(e => e.target === instance.id && e.targetHandle === output)
        if (edge) return await visit(parent, edge.source, edge.sourceHandle, time)
        const input = spec.outputs.find(p => p.id === output)!, fallback = primitiveDefault(input)
        if (fallback === undefined) throw new Error(`Connect ${specFor(instance, parent.doc).title}’s ${input.label} input in the parent graph`)
        const value = instance.params[input.id] ?? fallback, type = input.type === 'scalar' ? 'constant' : input.type === 'boolean' ? 'boolean' : 'text'
        const synthetic: GraphNode = { id: node.id, type, params: { value }, position: node.position }
        return await run(synthetic, time, scope.path, {}, new Map(), `${type === 'constant' ? 'out:scalar' : type === 'text' ? 'out:string' : 'out:boolean'}:value`)
      }
      const params: Params = { ...node.params }
      for (const p of spec.inputs.filter(p => p.parameter)) {
        const edge = scope.doc.edges.find(e => e.target === id && e.targetHandle === p.id)
        if (!edge) continue
        const target = await visit(scope, edge.source, edge.sourceHandle, time)
        inputs.set(p.id, target)
        const value = target.lease.value.outputs[target.port]
        if (value === undefined) throw new Error('A parameter input was not produced')
        params[p.parameter!] = context.parameter(value)
      }
      const invalid = validateParams(node.type, params, spec)
      if (invalid) throw new Error(`${spec.title}: ${invalid}`)
      for (const p of spec.inputs.filter(p => !p.parameter)) {
        const edge = scope.doc.edges.find(e => e.target === id && e.targetHandle === p.id)
        if (!edge && p.optional) continue
        if (!edge) throw new Error(`Connect ${spec.title}’s ${p.label} input`)
        const upstream = p.frameParam ? Number(params[p.frameParam]) : time + (p.offsetParam ? Number(params[p.offsetParam]) : 0)
        if (!Number.isFinite(upstream) || p.frameParam && (!Number.isInteger(upstream) || upstream < 0)) throw new Error('Frame index must be a non-negative whole number')
        inputs.set(p.id, await visit(scope, edge.source, edge.sourceHandle, upstream))
      }
      const resolved = { ...node, params }, refs = Object.fromEntries([...inputs].map(([id, value]) => [id, { key: value.key, port: value.port }]))
      // run() owns these leases, including every failure and cache-hit path.
      transferred = true
      return await run(resolved, time, scope.path, refs, inputs, output)
    } finally {
      active.delete(address)
      if (!transferred) for (const input of inputs.values()) input.lease.release()
    }
  }
  const run = async (node: GraphNode, time: number, path: string[], refs: Step['inputs'], inputs: Map<string, Target<T>>, output: string): Promise<Target<T>> => {
    try {
      const asset = node.type === 'source' || node.type === 'clip' ? node.asset ?? context.sourceId : undefined
      if (node.type === 'source' || node.type === 'clip') {
        if (!asset || !context.assets[asset]) throw new Error(`Attach ${node.assetName ?? 'a video'} to this Video Source node`)
        if (node.type === 'source' && (time < 0 || Math.floor(time) >= context.assets[asset]!.frameCount)) throw new Error(`Frame ${time} is outside this clip`)
      }
      const spec = specFor(node, root)
      // Resolved parameter values carry their own identity. A Time node can emit the
      // same integer frame index at several subframes; that must reuse decoded pixels.
      const dataRefs = Object.fromEntries(Object.entries(refs).filter(([id]) => !spec.inputs.find(p => p.id === id)?.parameter))
      const key = contentKey([node.type, spec.version, node.params, node.dataType, dataRefs, node.type === 'source' ? [asset, Math.floor(time)] : node.type === 'clip' ? asset : node.type === 'time' ? [context.sourceId ?? null, time] : null].map(v => v === undefined ? null : v))
      const payloads = Object.fromEntries([...inputs].map(([id, value]) => {
        const payload = value.lease.value.outputs[value.port]
        if (payload === undefined) throw new Error('A required input was not produced')
        return [id, payload]
      }))
      const step: Step = { key, node, frame: node.type === 'source' ? Math.floor(time) : time, path, ...(asset ? { asset } : {}), inputs: refs }
      context.trace?.(step, payloads)
      let lease = context.cache.acquire(key)
      if (lease) context.status({ node: node.id, path, frame: time, state: 'cached' })
      else {
        await context.yield(); check()
        const start = context.now()
        context.status({ node: node.id, path, frame: time, state: 'running' })
        const bundle = await context.kernel(step, payloads)
        try { check(); lease = context.cache.put(key, bundle) }
        catch (error) { bundle.dispose(); throw error }
        context.status({ node: node.id, path, frame: time, state: 'done', ms: context.now() - start })
      }
      return { key, port: output, lease }
    } finally { for (const input of inputs.values()) input.lease.release() }
  }
  let scope: Scope = { doc: root, path: [], definitions: [] }
  for (const id of path) { const node = scope.doc.nodes.find(n => n.id === id); if (!node) throw new Error('The custom-node instance no longer exists'); scope = enter(scope, node) }
  const target = await visit(scope, selected, port, frame), value = target.lease.value.outputs[target.port]
  if (value === undefined) { target.lease.release(); throw new Error('The selected output was not produced') }
  return { value, release: target.lease.release }
}

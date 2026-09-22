import { defaultParams, SPECS, validateParams } from './specs'
import type { Connection, GraphDocument, GraphEdge, GraphNode, NodeType } from './types'

/** The same validation gates pointer connections, imported graphs and worker execution. */
export const validateConnection = (doc: GraphDocument, c: Connection): string | null => {
  if (c.source === c.target) return 'A node cannot connect to itself'
  const source = doc.nodes.find(n => n.id === c.source), target = doc.nodes.find(n => n.id === c.target)
  if (!source || !target) return 'The connection refers to a missing node'
  const output = SPECS[source.type].outputs.find(p => p.id === c.sourceHandle), input = SPECS[target.type].inputs.find(p => p.id === c.targetHandle)
  if (!output || !input) return 'Connect an output socket to an input socket'
  if (output.type !== input.type) return `A ${output.type} output cannot connect to a ${input.type} input`
  const adjacency = new Map<string, string[]>()
  for (const e of doc.edges) {
    if (e.target === c.target && e.targetHandle === c.targetHandle) continue
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target])
  }
  const stack = [c.target], visited = new Set<string>()
  while (stack.length) {
    const id = stack.pop()
    if (id === undefined || visited.has(id)) continue
    if (id === c.source) return 'This connection would create a cycle'
    visited.add(id)
    stack.push(...(adjacency.get(id) ?? []))
  }
  return null
}

/** Connect or replace one input atomically; invalid edits leave the old graph untouched. */
export const connect = (doc: GraphDocument, c: Connection): GraphDocument => {
  const error = validateConnection(doc, c)
  if (error) throw new Error(error)
  if (!c.sourceHandle || !c.targetHandle) throw new Error('Missing socket')
  const edge: GraphEdge = { ...c, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle, id: `e:${c.target}:${c.targetHandle}` }
  return { ...doc, edges: [...doc.edges.filter(e => e.target !== c.target || e.targetHandle !== c.targetHandle), edge] }
}

/** Remove a node and its incident connections without changing the other nodes. */
export const removeNode = (doc: GraphDocument, id: string): GraphDocument => ({ ...doc, nodes: doc.nodes.filter(n => n.id !== id), edges: doc.edges.filter(e => e.source !== id && e.target !== id) })

/** Topological order for the entire document, including disconnected components. */
export const topological = (doc: GraphDocument): GraphNode[] => {
  const visiting = new Set<string>(), done = new Set<string>(), result: GraphNode[] = []
  const nodes = new Map(doc.nodes.map(n => [n.id, n]))
  const visit = (id: string) => {
    if (done.has(id)) return
    if (visiting.has(id)) throw new Error('The graph contains a cycle')
    const node = nodes.get(id)
    if (!node) throw new Error('Missing node')
    visiting.add(id)
    for (const edge of doc.edges.filter(e => e.target === id)) visit(edge.source)
    visiting.delete(id); done.add(id); result.push(node)
  }
  for (const node of doc.nodes) visit(node.id)
  return result
}

/** Validate untrusted project JSON before it enters either the UI or worker. */
export const parseDocument = (value: unknown): GraphDocument => {
  if (!value || typeof value !== 'object') throw new Error('Not a Cadence project')
  const v = value as Partial<GraphDocument>
  if (v.version !== 1 || !Array.isArray(v.nodes) || !Array.isArray(v.edges) || v.nodes.length > 100 || v.edges.length > 300) throw new Error('Invalid project format or graph too large')
  const ids = new Set<string>()
  for (const n of v.nodes) {
    if (!n || typeof n.id !== 'string' || !/^n[a-z0-9]+$/.test(n.id) || ids.has(n.id) || !Object.hasOwn(SPECS, n.type)) throw new Error('Invalid or duplicate node')
    ids.add(n.id)
    if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params) || !n.position || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) throw new Error('Invalid node data')
    const error = validateParams(n.type, n.params)
    if (error) throw new Error(error)
  }
  let checked: GraphDocument = { version: 1, nodes: v.nodes, edges: [] }
  const sockets = new Set<string>(), edgeIds = new Set<string>()
  for (const e of v.edges) {
    if (!e || typeof e.id !== 'string' || edgeIds.has(e.id)) throw new Error('Invalid or duplicate edge')
    const input = `${e.target}:${e.targetHandle}`
    if (sockets.has(input)) throw new Error('An input has more than one connection')
    sockets.add(input); edgeIds.add(e.id)
    checked = connect(checked, e)
  }
  topological(checked)
  return checked
}

/** Starter graphs demonstrate a filter chain or comparing N with N+1. */
export const starterGraph = (mode: 'difference' | 'filter' = 'difference'): GraphDocument => {
  const make = (id: string, type: NodeType, x: number, y: number): GraphNode => ({ id, type, params: defaultParams(type), position: { x, y } })
  const nodes = [make('n1', 'source', 40, 120), make('n2', 'grayscale', 320, 60), make('n3', 'blur', 600, 60), make('n4', 'delta', 880, 120), make('n5', 'output', 1170, 160)]
  let doc: GraphDocument = { version: 1, nodes: mode === 'filter' ? nodes.filter(n => n.id !== 'n4') : nodes, edges: [] }
  const wire = (source: string, target: string, targetHandle = 'in:frame:image', sourceHandle = 'out:frame:image') => { doc = connect(doc, { source, target, sourceHandle, targetHandle }) }
  wire('n1', 'n2'); wire('n2', 'n3')
  if (mode === 'difference') { wire('n3', 'n4', 'in:frame:a'); wire('n3', 'n4', 'in:frame:b'); wire('n4', 'n5', 'in:frame:image', 'out:frame:delta') }
  else wire('n3', 'n5')
  return doc
}

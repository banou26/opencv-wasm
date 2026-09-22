import { defaultParams, SPECS, validateParams, specFor, PORT_LABELS, primitiveDefault } from './specs'
import { graphView, translateDefinition } from './definitions'
import type { Connection, GraphDocument, GraphEdge, GraphNode, NodeType, NodeDefinition, Port } from './types'

/** The same validation gates pointer connections, imported graphs and worker execution. */
export const validateConnection = (doc: GraphDocument, c: Connection): string | null => {
  if (c.source === c.target) return 'A node cannot connect to itself'
  const source = doc.nodes.find(n => n.id === c.source), target = doc.nodes.find(n => n.id === c.target)
  if (!source || !target) return 'The connection refers to a missing node'
  const output = specFor(source, doc).outputs.find(p => p.id === c.sourceHandle), input = specFor(target, doc).inputs.find(p => p.id === c.targetHandle)
  if (!output || !input) return 'Connect an output socket to an input socket'
  if (output.type === 'custom' && output.schema !== input.schema) return 'Custom record types must match'
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

/** Validate ports before using user-defined interfaces for connection or native execution checks. */
const checkPorts = (ports: Port[], schemas: Set<string>) => {
  if (!Array.isArray(ports) || ports.length > 32) throw new Error('A custom interface supports up to 32 ports per direction')
  const ids = new Set<string>()
  for (const p of ports) {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9:_-]{0,99}$/.test(p.id) || ids.has(p.id) || typeof p.label !== 'string' || !p.label.trim() || p.label.length > 80 || !Object.hasOwn(PORT_LABELS, p.type) || p.type === 'custom' && (!p.schema || !schemas.has(p.schema))) throw new Error('Invalid custom-node port')
    if (p.default !== undefined && !(p.type === 'scalar' && typeof p.default === 'number' && Number.isFinite(p.default) && Math.abs(p.default) <= 1000000 || p.type === 'boolean' && typeof p.default === 'boolean' || p.type === 'string' && typeof p.default === 'string' && p.default.length <= 4096)) throw new Error('Invalid port default')
    ids.add(p.id)
  }
}

/** Validate a graph and every reusable definition, including nested definition recursion. */
export const parseDocument = (value: unknown): GraphDocument => {
  if (!value || typeof value !== 'object') throw new Error('Not an opencv-wasm editor project')
  const root = value as GraphDocument
  if (root.definitions !== undefined && (!Array.isArray(root.definitions) || root.definitions.length > 100)) throw new Error('Invalid custom-node library')
  if (root.dataTypes !== undefined && (!Array.isArray(root.dataTypes) || root.dataTypes.length > 64)) throw new Error('Invalid custom data-type library')
  const dataTypes = root.dataTypes ?? [], schemas = new Set<string>()
  for (const type of dataTypes) {
    if (!type || !/^t[a-z0-9]+$/.test(type.id) || schemas.has(type.id) || typeof type.name !== 'string' || !type.name.trim() || type.name.length > 80) throw new Error('Invalid or duplicate custom data type')
    schemas.add(type.id)
  }
  for (const type of dataTypes) {
    checkPorts(type.fields, schemas)
    if (!type.fields.length || type.fields.some(p => p.type === 'custom')) throw new Error('A record needs typed fields; nested record definitions are not supported yet')
  }
  const definitions = root.definitions ?? [], ids = new Set<string>()
  for (const d of definitions) {
    if (!d || typeof d.id !== 'string' || !/^g[a-z0-9]+$/.test(d.id) || ids.has(d.id) || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 80) throw new Error('Invalid or duplicate custom-node definition')
    if (d.description !== undefined && (typeof d.description !== 'string' || d.description.length > 2000)) throw new Error('Invalid custom-node description')
    ids.add(d.id); checkPorts(d.inputs, schemas); checkPorts(d.outputs, schemas)
  }
  const checkBody = (body: GraphDocument, interfaceId?: string): GraphDocument => {
    if (!body || body.version !== 1 || !Array.isArray(body.nodes) || !Array.isArray(body.edges) || body.nodes.length > 100 || body.edges.length > 300) throw new Error('Invalid project format or graph too large')
    // Existing saved axis transforms predate the configurable border sampler.
    body = { ...body, nodes: body.nodes.map(n => n && (n.type === 'translateX' || n.type === 'translateY') && n.params && n.params.border === undefined ? { ...n, params: { ...n.params, border: 'constant' } } : n) }
    const context = { ...body, definitions, dataTypes, interfaceId }, nodes = new Set<string>()
    for (const n of body.nodes) {
      if (!n || typeof n.id !== 'string' || !/^n[a-z0-9]+$/.test(n.id) || nodes.has(n.id) || !Object.hasOwn(SPECS, n.type)) throw new Error('Invalid or duplicate node')
      if (n.asset !== undefined && (!['source', 'clip'].includes(n.type) || typeof n.asset !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(n.asset))) throw new Error('Invalid source media identity')
      if (n.assetName !== undefined && (typeof n.assetName !== 'string' || n.assetName.length > 255)) throw new Error('Invalid source filename')
      nodes.add(n.id)
      if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params) || !n.position || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) throw new Error('Invalid node data')
      const spec = specFor(n, context), error = validateParams(n.type, n.params, spec)
      if (error) throw new Error(error)
    }
    if (interfaceId && (!ids.has(interfaceId) || body.nodes.filter(n => n.type === 'groupInput').length !== 1 || body.nodes.filter(n => n.type === 'groupOutput').length !== 1)) throw new Error('A custom node needs one Group Inputs node and one Group Outputs node')
    let checked: GraphDocument = { version: 1, nodes: body.nodes, edges: [], definitions, ...(dataTypes.length ? { dataTypes } : {}), ...(interfaceId ? { interfaceId } : {}) }
    const sockets = new Set<string>(), edgeIds = new Set<string>()
    for (const e of body.edges) {
      if (!e || typeof e.id !== 'string' || edgeIds.has(e.id)) throw new Error('Invalid or duplicate edge')
      const input = `${e.target}:${e.targetHandle}`
      if (sockets.has(input)) throw new Error('An input has more than one connection')
      sockets.add(input); edgeIds.add(e.id); checked = connect(checked, e)
    }
    topological(checked)
    return checked
  }
  const normalized = definitions.map(d => ({ ...d, graph: checkBody(d.graph, d.id) }))
  const visiting = new Set<string>(), done = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Custom nodes cannot contain recursive definitions')
    if (done.has(id)) return
    visiting.add(id)
    const definition = normalized.find(d => d.id === id)
    if (!definition) throw new Error('Missing custom-node definition')
    for (const n of definition.graph.nodes) if (n.type === 'group') visit(n.definition!)
    visiting.delete(id); done.add(id)
  }
  for (const d of normalized) visit(d.id)
  if (normalized.reduce((n, d) => n + d.graph.nodes.length, root.nodes?.length ?? 0) > 1000) throw new Error('Custom-node library exceeds 1000 nodes')
  const result = checkBody(root, root.interfaceId)
  // Store each definition body once; never embed a copy of the global library inside it.
  result.definitions = normalized.map(d => ({ ...d, graph: { version: 1, nodes: d.graph.nodes, edges: d.graph.edges } }))
  return result
}

/** An editable prefab is just a validated graph of ordinary nodes. */
export const starterGraph = (mode: 'difference' | 'filter' | 'motion' | 'mask' = 'difference'): GraphDocument => {
  const make = (id: string, type: NodeType, x: number, y: number): GraphNode => ({ id, type, params: defaultParams(type), position: { x, y } })
  let doc: GraphDocument = { version: 1, nodes: [], edges: [], definitions: [translateDefinition()] }
  const wire = (source: string, target: string, targetHandle = 'in:frame:image', sourceHandle = 'out:frame:image') => { doc = connect(doc, { source, target, sourceHandle, targetHandle }) }
  if (mode === 'motion') {
    doc.nodes = [make('n1', 'source', 40, 80), make('n2', 'motion', 340, 220), make('n6', 'time', 340, 720), make('n7', 'multiply', 660, 220), make('n8', 'multiply', 660, 630), { ...make('n3', 'group', 980, 80), definition: 'gtranslate', params: { x: 0, y: 0 } }, make('n5', 'output', 1290, 80)]
    wire('n1', 'n2', 'in:frame:a'); wire('n1', 'n2', 'in:frame:b')
    wire('n2', 'n7', 'in:scalar:a', 'out:scalar:dx'); wire('n2', 'n8', 'in:scalar:a', 'out:scalar:dy')
    wire('n6', 'n7', 'in:scalar:b', 'out:scalar:fraction'); wire('n6', 'n8', 'in:scalar:b', 'out:scalar:fraction')
    wire('n1', 'n3', 'image'); wire('n7', 'n3', 'x', 'out:scalar:value'); wire('n8', 'n3', 'y', 'out:scalar:value'); wire('n3', 'n5', 'in:frame:image', 'image')
  } else {
    doc.nodes = [make('n1', 'source', 40, 120), make('n2', 'grayscale', 340, 80), make('n3', 'blur', 640, 80), make('n4', 'delta', 950, 120), make('n5', 'output', mode === 'mask' ? 1580 : 1260, 160)]
    if (mode === 'filter') doc.nodes = doc.nodes.filter(n => n.id !== 'n4')
    wire('n1', 'n2'); wire('n2', 'n3')
    if (mode === 'filter') wire('n3', 'n5')
    else {
      wire('n3', 'n4', 'in:frame:a'); wire('n3', 'n4', 'in:frame:b')
      if (mode === 'mask') { doc.nodes.push(make('n6', 'threshold', 1270, 120)); wire('n4', 'n6', 'in:frame:image', 'out:frame:delta'); wire('n6', 'n5') }
      else wire('n4', 'n5', 'in:frame:image', 'out:frame:delta')
    }
  }
  return doc
}

/** Insert a saved prefab with independent nodes, safely merging its custom-node definitions. */
export const insertPrefab = (document: GraphDocument, value: unknown, position: { x: number; y: number }, id: () => string): GraphDocument => {
  const prefab = parseDocument(value), ids = new Map(prefab.nodes.map(n => [n.id, id()]))
  const dataTypes = [...(document.dataTypes ?? [])], typeIds = new Map<string, string>()
  for (const type of prefab.dataTypes ?? []) {
    const existing = dataTypes.find(t => t.id === type.id), mapped = existing && JSON.stringify(existing) !== JSON.stringify(type) ? id().replace(/^n/, 't') : type.id
    typeIds.set(type.id, mapped)
    if (!dataTypes.some(t => t.id === mapped)) dataTypes.push({ ...type, id: mapped, fields: type.fields.map(p => ({ ...p })) })
  }
  const remapPort = (p: Port): Port => ({ ...p, ...(p.schema ? { schema: typeIds.get(p.schema) ?? p.schema } : {}) })
  const library = [...(document.definitions ?? [])], definitionIds = new Map<string, string>()
  for (const definition of prefab.definitions ?? []) {
    const existing = library.find(d => d.id === definition.id)
    definitionIds.set(definition.id, existing && (JSON.stringify(existing) !== JSON.stringify(definition) || [...definition.inputs, ...definition.outputs].some(p => p.schema && typeIds.get(p.schema) !== p.schema) || definition.graph.nodes.some(n => n.dataType && typeIds.get(n.dataType) !== n.dataType)) ? id().replace(/^n/, 'g') : definition.id)
  }
  // A reused parent must also be cloned when any referenced child was renamed.
  for (let pass = 0; pass < (prefab.definitions?.length ?? 0); pass++) for (const d of prefab.definitions ?? []) {
    if (definitionIds.get(d.id) === d.id && library.some(existing => existing.id === d.id) && d.graph.nodes.some(n => n.definition && definitionIds.get(n.definition) !== n.definition)) definitionIds.set(d.id, id().replace(/^n/, 'g'))
  }
  const remap = (n: GraphNode): GraphNode => ({ ...n, params: { ...n.params }, ...(n.definition ? { definition: definitionIds.get(n.definition) ?? n.definition } : {}), ...(n.dataType ? { dataType: typeIds.get(n.dataType) ?? n.dataType } : {}) })
  for (const d of prefab.definitions ?? []) {
    const definitionId = definitionIds.get(d.id)!
    if (!library.some(entry => entry.id === definitionId)) library.push({ ...d, id: definitionId, inputs: d.inputs.map(remapPort), outputs: d.outputs.map(remapPort), graph: { ...d.graph, nodes: d.graph.nodes.map(remap), edges: d.graph.edges.map(e => ({ ...e })) } })
  }
  const minX = Math.min(...prefab.nodes.map(n => n.position.x)), minY = Math.min(...prefab.nodes.map(n => n.position.y))
  const nodes = prefab.nodes.map(n => ({ ...remap(n), id: ids.get(n.id)!, position: { x: n.position.x - minX + position.x, y: n.position.y - minY + position.y } }))
  const edges = prefab.edges.map(e => ({ ...e, id: `e:${ids.get(e.target)}:${e.targetHandle}`, source: ids.get(e.source)!, target: ids.get(e.target)! }))
  return parseDocument({ ...document, nodes: [...document.nodes, ...nodes], edges: [...document.edges, ...edges], definitions: library, ...(dataTypes.length ? { dataTypes } : {}) })
}

/** Encapsulate selected operations, expose their boundary sockets, and reconnect the parent graph. */
export const groupNodes = (root: GraphDocument, definitionId: string | undefined, selected: string[], name: string, groupId: string, instanceId: string): GraphDocument => {
  const view = graphView(root, definitionId), chosen = view.nodes.filter(n => selected.includes(n.id) && !['output', 'groupInput', 'groupOutput'].includes(n.type))
  if (!chosen.length) throw new Error('Select one or more processing nodes to make a custom node')
  const set = new Set(chosen.map(n => n.id)), incoming = view.edges.filter(e => !set.has(e.source) && set.has(e.target)), outgoing = view.edges.filter(e => set.has(e.source) && !set.has(e.target))
  const inputs: Port[] = [], outputs: Port[] = [], inputMap = new Map<string, string>(), outputMap = new Map<string, string>()
  for (const e of incoming) {
    const key = `${e.source}/${e.sourceHandle}`
    if (!inputMap.has(key)) { const node = view.nodes.find(n => n.id === e.target)!, port = specFor(node, view).inputs.find(p => p.id === e.targetHandle)!; const id = `i${inputs.length + 1}`; inputMap.set(key, id); inputs.push({ id, label: port.label, type: port.type, ...(port.schema ? { schema: port.schema } : {}), ...(primitiveDefault(port) !== undefined ? { default: primitiveDefault(port) } : {}) }) }
  }
  const exports = outgoing.map(e => ({ source: e.source, sourceHandle: e.sourceHandle }))
  if (!exports.length) for (const n of chosen.filter(n => !view.edges.some(e => e.source === n.id && set.has(e.target)))) for (const p of specFor(n, view).outputs) exports.push({ source: n.id, sourceHandle: p.id })
  for (const e of exports) {
    const key = `${e.source}/${e.sourceHandle}`
    if (!outputMap.has(key)) { const n = view.nodes.find(n => n.id === e.source)!, port = specFor(n, view).outputs.find(p => p.id === e.sourceHandle)!; const id = `o${outputs.length + 1}`; outputMap.set(key, id); outputs.push({ id, label: port.label, type: port.type, ...(port.schema ? { schema: port.schema } : {}) }) }
  }
  const minX = Math.min(...chosen.map(n => n.position.x)), minY = Math.min(...chosen.map(n => n.position.y))
  const internals = chosen.map(n => ({ ...n, position: { x: n.position.x - minX + 330, y: n.position.y - minY + 80 } }))
  const maxX = Math.max(...internals.map(n => n.position.x))
  const definition: NodeDefinition = { id: groupId, name, inputs, outputs, graph: { version: 1, nodes: [
    { id: 'ninput', type: 'groupInput', params: {}, position: { x: 20, y: 80 } }, ...internals,
    { id: 'noutput', type: 'groupOutput', params: {}, position: { x: maxX + 320, y: 80 } },
  ], edges: [
    ...view.edges.filter(e => set.has(e.source) && set.has(e.target)),
    ...incoming.map(e => ({ ...e, source: 'ninput', sourceHandle: inputMap.get(`${e.source}/${e.sourceHandle}`)! })),
    ...[...outputMap].map(([key, port]) => { const [source, sourceHandle] = key.split('/'); return { id: `e:output:${port}`, source: source!, sourceHandle: sourceHandle!, target: 'noutput', targetHandle: port } }),
  ] } }
  const instance: GraphNode = { id: instanceId, type: 'group', definition: groupId, params: Object.fromEntries(inputs.filter(p => primitiveDefault(p) !== undefined).map(p => [p.id, primitiveDefault(p)!])), position: { x: minX, y: minY } }
  let next: GraphDocument = { ...view, definitions: [...(root.definitions ?? []), definition], nodes: [...view.nodes.filter(n => !set.has(n.id)), instance], edges: view.edges.filter(e => !set.has(e.source) && !set.has(e.target)) }
  for (const e of incoming) next = connect(next, { source: e.source, sourceHandle: e.sourceHandle, target: instanceId, targetHandle: inputMap.get(`${e.source}/${e.sourceHandle}`)! })
  for (const e of outgoing) next = connect(next, { source: instanceId, sourceHandle: outputMap.get(`${e.source}/${e.sourceHandle}`)!, target: e.target, targetHandle: e.targetHandle })
  const combined = definitionId ? { ...root, definitions: next.definitions!.map(d => d.id === definitionId ? { ...d, graph: { version: 1, nodes: next.nodes, edges: next.edges } } : d) } : next
  return parseDocument(combined)
}

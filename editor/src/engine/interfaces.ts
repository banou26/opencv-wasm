import { parseDocument, validateConnection } from './graph'
import { specFor } from './specs'
import type { GraphDocument, NodeDefinition } from './types'

/** Interface edits preserve socket IDs; removed or incompatible connections are pruned everywhere. */
export const updateInterface = (root: GraphDocument, id: string, patch: Pick<NodeDefinition, 'name' | 'inputs' | 'outputs'>): GraphDocument => {
  const definitions = root.definitions?.map(d => d.id === id ? { ...d, ...patch } : d) ?? []
  const clean = (body: GraphDocument, interfaceId?: string): GraphDocument => {
    let view: GraphDocument = { ...body, definitions, dataTypes: root.dataTypes, ...(interfaceId ? { interfaceId } : {}) }
    view = { ...view, nodes: view.nodes.map(n => n.type === 'group' && n.definition === id ? { ...n, params: Object.fromEntries(specFor(n, view).parameters.map(p => [p.key, typeof n.params[p.key] === typeof p.default ? n.params[p.key]! : p.default])) } : n) }
    return { ...view, edges: view.edges.filter(e => !validateConnection(view, e)) }
  }
  const rootBody = clean(root)
  return parseDocument({ ...rootBody, definitions: definitions.map(d => { const view = clean(d.graph, d.id); return { ...d, graph: { version: 1, nodes: view.nodes, edges: view.edges } } }) })
}

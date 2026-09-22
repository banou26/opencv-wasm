import { parseDocument, validateConnection } from './graph'
import { specFor } from './specs'
import type { DataTypeDefinition, GraphDocument } from './types'

/** Keep saved defaults and all record connections consistent after a schema edit. */
export const updateDataType = (root: GraphDocument, schema: DataTypeDefinition): GraphDocument => {
  const dataTypes = [...(root.dataTypes ?? []).filter(t => t.id !== schema.id), schema]
  const clean = (body: GraphDocument, interfaceId?: string): GraphDocument => {
    const context = { ...body, definitions: root.definitions, dataTypes, interfaceId }
    context.nodes = context.nodes.map(n => n.type === 'makeRecord' && n.dataType === schema.id ? { ...n, params: Object.fromEntries(specFor(n, context).parameters.map(p => [p.key, typeof n.params[p.key] === typeof p.default ? n.params[p.key]! : p.default])) } : n)
    context.edges = context.edges.filter(e => !validateConnection(context, e))
    return context
  }
  return parseDocument({ ...clean(root, root.interfaceId), definitions: root.definitions?.map(d => { const body = clean(d.graph, d.id); return { ...d, graph: { version: 1, nodes: body.nodes, edges: body.edges } } }) })
}

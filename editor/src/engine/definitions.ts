import type { GraphDocument, GraphNode, NodeDefinition } from './types'

/** The built-in Translate utility is editable and has no special execution path. */
export const translateDefinition = (): NodeDefinition => ({
  id: 'gtranslate', name: 'Translate',
  inputs: [{ id: 'image', label: 'Image', type: 'frame' }, { id: 'x', label: 'X · px', type: 'scalar', default: 0 }, { id: 'y', label: 'Y · px', type: 'scalar', default: 0 }],
  outputs: [{ id: 'image', label: 'Image', type: 'frame' }],
  graph: { version: 1, nodes: [
    { id: 'ninput', type: 'groupInput', params: {}, position: { x: 40, y: 130 } },
    { id: 'nx', type: 'translateX', params: { pixels: 0, border: 'constant' }, position: { x: 350, y: 60 } },
    { id: 'ny', type: 'translateY', params: { pixels: 0, border: 'constant' }, position: { x: 660, y: 60 } },
    { id: 'noutput', type: 'groupOutput', params: {}, position: { x: 980, y: 130 } },
  ], edges: [
    { id: 'e:ximage', source: 'ninput', sourceHandle: 'image', target: 'nx', targetHandle: 'in:frame:image' },
    { id: 'e:x', source: 'ninput', sourceHandle: 'x', target: 'nx', targetHandle: 'in:scalar:pixels' },
    { id: 'e:yimage', source: 'nx', sourceHandle: 'out:frame:image', target: 'ny', targetHandle: 'in:frame:image' },
    { id: 'e:y', source: 'ninput', sourceHandle: 'y', target: 'ny', targetHandle: 'in:scalar:pixels' },
    { id: 'e:result', source: 'ny', sourceHandle: 'out:frame:image', target: 'noutput', targetHandle: 'image' },
  ] },
})

/** A view of a definition shares the root library without duplicating it in saved files. */
export const graphView = (root: GraphDocument, definition?: string): GraphDocument => {
  if (!definition) return root
  const entry = root.definitions?.find(d => d.id === definition)
  if (!entry) throw new Error('Missing custom-node tab')
  return { ...entry.graph, definitions: root.definitions, dataTypes: root.dataTypes, interfaceId: definition }
}

/** Change a graph body while keeping one authoritative definition library. */
export const replaceView = (root: GraphDocument, definition: string | undefined, view: GraphDocument): GraphDocument => {
  if (!definition) return view
  return { ...root, dataTypes: view.dataTypes ?? root.dataTypes, definitions: (view.definitions ?? root.definitions)?.map(d => d.id === definition ? { ...d, graph: { version: 1, nodes: view.nodes, edges: view.edges } } : d) }
}

/** Resolve an instance path from the root for in-context editing and inspection. */
export const pathDefinition = (root: GraphDocument, path: string[]): string | undefined => {
  let doc = root, definition: string | undefined
  for (const id of path) {
    const node: GraphNode | undefined = doc.nodes.find(n => n.id === id)
    if (node?.type !== 'group' || !node.definition) throw new Error('The custom-node instance no longer exists')
    definition = node.definition; doc = graphView(root, definition)
  }
  return definition
}

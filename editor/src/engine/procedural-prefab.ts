import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeDefinition, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/** One channel of the fixture pattern, built from arithmetic rather than a special texture kernel. */
const stripeChannel = (): NodeDefinition => {
  const definition: NodeDefinition = { id: 'gstripechannel', name: 'Striped color channel', description: 'Compute ((X × X slope + Y × Y slope + noise) modulo period + bias) / 255. X/Y are pixel coordinates, and noise is 0…63. Each operation is editable inside this group. The three color channels use different slopes and offsets.', inputs: [
    ...['x', 'y', 'noise'].map(id => ({ id, label: id === 'noise' ? 'Noise · 0…63' : `${id.toUpperCase()} · pixels`, type: 'frame' as const })),
    ...[['sx', 'X slope', 3], ['sy', 'Y slope', 5], ['bias', 'Color bias', 35], ['period', 'Stripe period', 185]].map(([id, label, value]) => ({ id: String(id), label: String(label), type: 'scalar' as const, default: Number(value) })),
  ], outputs: [{ id: 'image', label: 'Channel · 0…1', type: 'frame' }], graph: { version: 1, nodes: [], edges: [] } }
  let doc: GraphDocument = { version: 1, definitions: [definition], interfaceId: definition.id, nodes: [node('ninput', 'groupInput', 0, 80), node('nx', 'pixelMath', 340, 80, { operation: 'multiply' }), node('ny', 'pixelMath', 340, 650, { operation: 'multiply' }), node('nxy', 'pixelMath', 680, 80, { operation: 'add' }), node('nnoise', 'pixelMath', 1020, 80, { operation: 'add' }), node('nwrap', 'pixelMath', 1360, 80, { operation: 'modulo' }), node('nbias', 'pixelMath', 1700, 80, { operation: 'add' }), node('nunit', 'pixelMath', 2040, 80, { operation: 'divide', b: 255 }), node('noutput', 'groupOutput', 2380, 80)], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  for (const axis of ['x', 'y']) { wire('ninput', axis, `n${axis}`, 'in:frame:a'); wire('ninput', `s${axis}`, `n${axis}`, 'param:b') }
  wire('nx', 'out:frame:image', 'nxy', 'in:frame:a'); wire('ny', 'out:frame:image', 'nxy', 'in:frame:b'); wire('nxy', 'out:frame:image', 'nnoise', 'in:frame:a'); wire('ninput', 'noise', 'nnoise', 'in:frame:b')
  wire('nnoise', 'out:frame:image', 'nwrap', 'in:frame:a'); wire('ninput', 'period', 'nwrap', 'param:b'); wire('nwrap', 'out:frame:image', 'nbias', 'in:frame:a'); wire('ninput', 'bias', 'nbias', 'param:b'); wire('nbias', 'out:frame:image', 'nunit', 'in:frame:a'); wire('nunit', 'out:frame:image', 'noutput', 'image')
  return { ...definition, graph: { version: 1, nodes: doc.nodes, edges: doc.edges } }
}

/** Recreate the smoke fixture's RGB texture and animate it using only generated fields and Time. */
export const proceduralTextureGraph = (): GraphDocument => {
  let doc: GraphDocument = { version: 1, definitions: [stripeChannel()], nodes: [node('nwidth', 'constant', 0, 80, { value: 192 }), node('nheight', 'constant', 0, 400, { value: 128 }), node('ncoords', 'coordinates', 340, 80), node('nnoise', 'noise', 340, 850, { width: 192, height: 128, seed: 412947, levels: 64 }), node('nnoiseunits', 'pixelMath', 680, 850, { operation: 'multiply', b: 64 }),
    { ...node('nr', 'group', 1040, 80, { sx: 3, sy: 5, bias: 35, period: 185 }), definition: 'gstripechannel' },
    { ...node('ng', 'group', 1040, 800, { sx: 5, sy: 2, bias: 25, period: 185 }), definition: 'gstripechannel' },
    { ...node('nb', 'group', 1040, 1520, { sx: 2, sy: 7, bias: 45, period: 185 }), definition: 'gstripechannel' },
    node('nrgb', 'mergeChannels', 1420, 80), node('ntime', 'time', 1420, 800), node('ndx', 'math', 1770, 800, { operation: 'multiply', b: 2 }), node('ndy', 'math', 1770, 1300, { operation: 'multiply', b: 1 }), node('nx', 'translateX', 2120, 80, { border: 'wrap' }), node('ny', 'translateY', 2470, 80, { border: 'wrap' }), node('n5', 'output', 2820, 80)], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  for (const id of ['ncoords', 'nnoise']) { wire('nwidth', 'out:scalar:value', id, 'param:width'); wire('nheight', 'out:scalar:value', id, 'param:height') }
  wire('nnoise', 'out:frame:image', 'nnoiseunits', 'in:frame:a')
  for (const [id, color] of [['nr', 'red'], ['ng', 'green'], ['nb', 'blue']]) {
    wire('ncoords', 'out:frame:x', id!, 'x'); wire('ncoords', 'out:frame:y', id!, 'y'); wire('nnoiseunits', 'out:frame:image', id!, 'noise'); wire(id!, 'image', 'nrgb', `in:frame:${color}`)
  }
  wire('nrgb', 'out:frame:image', 'nx', 'in:frame:image'); wire('nx', 'out:frame:image', 'ny', 'in:frame:image'); wire('ny', 'out:frame:image', 'n5', 'in:frame:image')
  for (const axis of ['x', 'y']) { wire('ntime', 'out:scalar:frame', `nd${axis}`, 'param:a'); wire(`nd${axis}`, 'out:scalar:value', `n${axis}`, 'in:scalar:pixels') }
  return doc
}

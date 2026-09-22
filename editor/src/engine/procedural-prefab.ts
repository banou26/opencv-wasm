import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeDefinition, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/** Whole cycles on normalized coordinates make the stripe phase periodic on both axes. */
const stripeChannel = (): NodeDefinition => {
  const definition: NodeDefinition = { id: 'gstripechannel', name: 'Striped color channel', description: 'Round X/Y cycle counts to whole numbers, then compute sin(2π × (U × X cycles + V × Y cycles + noise phase)). Map -1…1 to 0…1 and apply the color span and bias. U/V are normalized coordinates. Whole cycles line up across both image boundaries, and sine is continuous across its wrap. Every operation is an editable math node.', inputs: [
    ...['x', 'y', 'noise'].map(id => ({ id, label: id === 'noise' ? 'Noise phase · cycles' : `${id === 'x' ? 'U' : 'V'} · normalized`, type: 'frame' as const })),
    ...[['sx', 'X cycles · rounded', 3], ['sy', 'Y cycles · rounded', 3], ['bias', 'Color bias', 35], ['period', 'Color span', 185]].map(([id, label, value]) => ({ id: String(id), label: String(label), type: 'scalar' as const, default: Number(value) })),
  ], outputs: [{ id: 'image', label: 'Channel · 0…1', type: 'frame' }], graph: { version: 1, nodes: [], edges: [] } }
  let doc: GraphDocument = { version: 1, definitions: [definition], interfaceId: definition.id, nodes: [node('ninput', 'groupInput', 0, 80), node('nroundx', 'math', 340, 80, { operation: 'round' }), node('nroundy', 'math', 340, 650, { operation: 'round' }), node('nx', 'pixelMath', 680, 80, { operation: 'multiply' }), node('ny', 'pixelMath', 680, 650, { operation: 'multiply' }), node('nxy', 'pixelMath', 1020, 80, { operation: 'add' }), node('nnoise', 'pixelMath', 1360, 80, { operation: 'add' }), node('nangle', 'pixelMath', 1700, 80, { operation: 'multiply', b: 2 * Math.PI }), node('nwave', 'pixelMath', 2040, 80, { operation: 'sine' }), node('nhalf', 'pixelMath', 2380, 80, { operation: 'multiply', b: 0.5 }), node('ncenter', 'pixelMath', 2720, 80, { operation: 'add', b: 0.5 }), node('nspan', 'pixelMath', 3060, 80, { operation: 'multiply' }), node('nbias', 'pixelMath', 3400, 80, { operation: 'add' }), node('nunit', 'pixelMath', 3740, 80, { operation: 'divide', b: 255 }), node('noutput', 'groupOutput', 4080, 80)], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  for (const axis of ['x', 'y']) { wire('ninput', axis, `n${axis}`, 'in:frame:a'); wire('ninput', `s${axis}`, `nround${axis}`, 'param:a'); wire(`nround${axis}`, 'out:scalar:value', `n${axis}`, 'param:b') }
  wire('nx', 'out:frame:image', 'nxy', 'in:frame:a'); wire('ny', 'out:frame:image', 'nxy', 'in:frame:b'); wire('nxy', 'out:frame:image', 'nnoise', 'in:frame:a'); wire('ninput', 'noise', 'nnoise', 'in:frame:b')
  for (const [from, to] of [['nnoise', 'nangle'], ['nangle', 'nwave'], ['nwave', 'nhalf'], ['nhalf', 'ncenter'], ['ncenter', 'nspan'], ['nspan', 'nbias'], ['nbias', 'nunit']]) wire(from!, 'out:frame:image', to!, 'in:frame:a')
  wire('ninput', 'period', 'nspan', 'param:b'); wire('ninput', 'bias', 'nbias', 'param:b'); wire('nunit', 'out:frame:image', 'noutput', 'image')
  return { ...definition, graph: { version: 1, nodes: doc.nodes, edges: doc.edges } }
}

/** A seamless RGB texture with one full X/Y lap per 240-frame loop, built from editable math. */
export const proceduralTextureGraph = (): GraphDocument => {
  let doc: GraphDocument = { version: 1, definitions: [stripeChannel()], nodes: [node('nwidth', 'constant', 0, 80, { value: 192 }), node('nheight', 'constant', 0, 400, { value: 128 }), node('ncoords', 'coordinates', 340, 80), node('nnoise', 'noise', 340, 850, { width: 192, height: 128, seed: 412947, levels: 64 }), node('nnoiseunits', 'pixelMath', 680, 850, { operation: 'multiply', b: 64 / 185 }),
    { ...node('nr', 'group', 1040, 80, { sx: 3, sy: 3, bias: 35, period: 185 }), definition: 'gstripechannel' },
    { ...node('ng', 'group', 1040, 800, { sx: 5, sy: 1, bias: 25, period: 185 }), definition: 'gstripechannel' },
    { ...node('nb', 'group', 1040, 1520, { sx: 2, sy: 5, bias: 45, period: 185 }), definition: 'gstripechannel' },
    node('nrgb', 'mergeChannels', 1420, 80), node('ntime', 'time', 1420, 800), node('nloop', 'constant', 1420, 1400, { value: 240 }), node('nlooptime', 'math', 1770, 1850, { operation: 'modulo' }), node('nspeedx', 'math', 1770, 800, { operation: 'divide' }), node('nspeedy', 'math', 1770, 1300, { operation: 'divide' }), node('ndx', 'math', 2120, 800, { operation: 'multiply' }), node('ndy', 'math', 2120, 1300, { operation: 'multiply' }), node('nx', 'translateX', 2470, 80, { border: 'wrap' }), node('ny', 'translateY', 2820, 80, { border: 'wrap' }), node('n5', 'output', 3170, 80)], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  for (const id of ['ncoords', 'nnoise']) { wire('nwidth', 'out:scalar:value', id, 'param:width'); wire('nheight', 'out:scalar:value', id, 'param:height') }
  wire('nnoise', 'out:frame:image', 'nnoiseunits', 'in:frame:a')
  for (const [id, color] of [['nr', 'red'], ['ng', 'green'], ['nb', 'blue']]) {
    wire('ncoords', 'out:frame:u', id!, 'x'); wire('ncoords', 'out:frame:v', id!, 'y'); wire('nnoiseunits', 'out:frame:image', id!, 'noise'); wire(id!, 'image', 'nrgb', `in:frame:${color}`)
  }
  wire('nrgb', 'out:frame:image', 'nx', 'in:frame:image'); wire('nx', 'out:frame:image', 'ny', 'in:frame:image'); wire('ny', 'out:frame:image', 'n5', 'in:frame:image')
  wire('ntime', 'out:scalar:frame', 'nlooptime', 'param:a'); wire('nloop', 'out:scalar:value', 'nlooptime', 'param:b')
  for (const [axis, dimension] of [['x', 'width'], ['y', 'height']]) {
    wire(`n${dimension}`, 'out:scalar:value', `nspeed${axis}`, 'param:a'); wire('nloop', 'out:scalar:value', `nspeed${axis}`, 'param:b'); wire(`nspeed${axis}`, 'out:scalar:value', `nd${axis}`, 'param:b')
    wire('nlooptime', 'out:scalar:value', `nd${axis}`, 'param:a'); wire(`nd${axis}`, 'out:scalar:value', `n${axis}`, 'in:scalar:pixels')
  }
  return doc
}

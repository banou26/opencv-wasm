import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeDefinition, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })
const builder = (doc: GraphDocument) => ({
  get doc() { return doc },
  wire(source: string, output: string, target: string, input: string) { doc = connect(doc, { source, sourceHandle: output, target, targetHandle: input }) },
})
const number = (id: string, label: string, value = 0) => ({ id, label, type: 'scalar' as const, default: value })
const framePort = (id: string, label: string) => ({ id, label, type: 'frame' as const })

/** Match the cookbook's working-size limit, using editable aspect-ratio arithmetic. */
const workingPair = (): NodeDefinition => {
  const definition: NodeDefinition = { id: 'gworkingpair', name: 'Working frame pair', description: 'Limit the longest side to Max side without enlarging the input. Preserve aspect ratio and round dimensions down to even sizes for MP4 output. Resize both frames to those same dimensions. All downstream displacements are in these working-image pixels; open the group to change the sizing arithmetic or bypass it for full resolution.', inputs: [framePort('a', 'Before'), framePort('b', 'After'), number('limit', 'Max side · px', 640)], outputs: [framePort('a', 'Before · resized'), framePort('b', 'After · resized')], graph: { version: 1, nodes: [], edges: [] } }
  const nodes = [node('ninput', 'groupInput', 0, 80), node('nsize', 'imageInfo', 330, 80), node('nmax', 'math', 660, 80, { operation: 'max' }), node('nratio', 'math', 990, 80, { operation: 'divide' }), node('nscale', 'math', 1320, 80, { operation: 'min', b: 1 }), node('na', 'resize', 2970, 80, { method: 'area' }), node('nb', 'resize', 2970, 700, { method: 'area' }), node('noutput', 'groupOutput', 3300, 80)]
  for (const [dimension, row] of [['width', 500], ['height', 1050]] as const) nodes.push(node(`n${dimension}`, 'math', 1650, row, { operation: 'multiply' }), node(`nhalf${dimension}`, 'math', 1980, row, { operation: 'divide', b: 2 }), node(`nfloor${dimension}`, 'math', 2310, row, { operation: 'floor' }), node(`neven${dimension}`, 'math', 2640, row, { operation: 'multiply', b: 2 }))
  const b = builder({ version: 1, nodes, edges: [], definitions: [definition], interfaceId: definition.id }), w = b.wire
  w('ninput', 'a', 'nsize', 'in:frame:image'); w('nsize', 'out:scalar:width', 'nmax', 'param:a'); w('nsize', 'out:scalar:height', 'nmax', 'param:b'); w('ninput', 'limit', 'nratio', 'param:a'); w('nmax', 'out:scalar:value', 'nratio', 'param:b'); w('nratio', 'out:scalar:value', 'nscale', 'param:a')
  for (const dimension of ['width', 'height']) {
    w('nsize', `out:scalar:${dimension}`, `n${dimension}`, 'param:a'); w('nscale', 'out:scalar:value', `n${dimension}`, 'param:b'); w(`n${dimension}`, 'out:scalar:value', `nhalf${dimension}`, 'param:a'); w(`nhalf${dimension}`, 'out:scalar:value', `nfloor${dimension}`, 'param:a'); w(`nfloor${dimension}`, 'out:scalar:value', `neven${dimension}`, 'param:a')
    for (const id of ['na', 'nb']) w(`neven${dimension}`, 'out:scalar:value', id, `param:${dimension}`)
  }
  for (const id of ['a', 'b']) { w('ninput', id, `n${id}`, 'in:frame:image'); w(`n${id}`, 'out:frame:image', 'noutput', id) }
  return { ...definition, graph: { version: 1, nodes: b.doc.nodes, edges: b.doc.edges } }
}

/** Coarse initialization stays inspectable: phase correlation, bounds, comparisons and switches. */
const coarsePan = (): NodeDefinition => {
  const definition: NodeDefinition = { id: 'gcoarsepan', name: 'Coarse camera pan', description: 'Estimate translation with phase correlation. Accept it only when response is at least 0.1 and both displacements are below 45% of the corresponding image dimension; otherwise initialize local flow with zero. Open this group to inspect every comparison and switch.', inputs: [framePort('a', 'Before'), framePort('b', 'After')], outputs: [number('dx', 'Pan X'), number('dy', 'Pan Y')], graph: { version: 1, nodes: [], edges: [] } }
  const nodes = [node('ninput', 'groupInput', 0, 100), node('nphase', 'phaseCorrelation', 320, 80), node('nsize', 'imageInfo', 320, 650), node('nresponse', 'compare', 650, 0, { operation: 'greater or equal', b: 0.1 }), node('nxy', 'logic', 1300, 300), node('nall', 'logic', 1630, 100), node('noutput', 'groupOutput', 2300, 100)]
  for (const [axis, row] of [['x', 420], ['y', 900]] as const) nodes.push(node(`nabs${axis}`, 'math', 650, row, { operation: 'absolute' }), node(`nlimit${axis}`, 'math', 650, row + 250, { operation: 'multiply', b: 0.45 }), node(`nvalid${axis}`, 'compare', 980, row, { operation: 'less' }), node(`nselect${axis}`, 'selectNumber', 1960, row, { b: 0 }))
  const b = builder({ version: 1, nodes, edges: [], definitions: [definition], interfaceId: definition.id }), w = b.wire
  w('ninput', 'a', 'nphase', 'in:frame:a'); w('ninput', 'b', 'nphase', 'in:frame:b'); w('ninput', 'a', 'nsize', 'in:frame:image'); w('nphase', 'out:scalar:response', 'nresponse', 'param:a')
  for (const [axis, dimension, condition] of [['x', 'width', 'a'], ['y', 'height', 'b']] as const) {
    w('nphase', `out:scalar:d${axis}`, `nabs${axis}`, 'param:a'); w('nsize', `out:scalar:${dimension}`, `nlimit${axis}`, 'param:a')
    w(`nabs${axis}`, 'out:scalar:value', `nvalid${axis}`, 'param:a'); w(`nlimit${axis}`, 'out:scalar:value', `nvalid${axis}`, 'param:b')
    w(`nvalid${axis}`, 'out:boolean:value', 'nxy', `param:${condition}`); w('nall', 'out:boolean:value', `nselect${axis}`, 'param:condition')
    w('nphase', `out:scalar:d${axis}`, `nselect${axis}`, 'param:a'); w(`nselect${axis}`, 'out:scalar:value', 'noutput', `d${axis}`)
  }
  w('nxy', 'out:boolean:value', 'nall', 'param:a'); w('nresponse', 'out:boolean:value', 'nall', 'param:b')
  return { ...definition, graph: { version: 1, nodes: b.doc.nodes, edges: b.doc.edges } }
}

/** One direction of the cookbook: remove the coarse pan, estimate residuals, then add it back. */
const compensatedFlow = (): NodeDefinition => {
  const definition: NodeDefinition = { id: 'gcompensatedflow', name: 'Pan-compensated dense flow', description: 'Move the second grayscale frame by negative pan X/Y with reflected borders. Farneback estimates local residual displacement against the first frame. Offset Flow Vectors restores the full pan. Reuse this same group with frames swapped and pan negated to compute reverse motion.', inputs: [framePort('a', 'From frame'), framePort('b', 'To frame'), number('dx', 'Coarse X'), number('dy', 'Coarse Y'), number('levels', 'Pyramid levels', 4), number('window', 'Flow window', 25)], outputs: [{ id: 'field', label: 'Full displacement', type: 'flow' }, framePort('aligned', 'Pan-compensated frame'), { id: 'residual', label: 'Residual flow', type: 'flow' }], graph: { version: 1, nodes: [], edges: [] } }
  const b = builder({ version: 1, definitions: [definition], interfaceId: definition.id, nodes: [node('ninput', 'groupInput', 0, 80), node('nnx', 'math', 330, 480, { operation: 'multiply', b: -1 }), node('nny', 'math', 330, 850, { operation: 'multiply', b: -1 }), node('nx', 'translateX', 680, 80, { border: 'reflect' }), node('ny', 'translateY', 1030, 80, { border: 'reflect' }), node('nflow', 'farneback', 1380, 80), node('nrestore', 'offsetFlow', 1730, 80), node('noutput', 'groupOutput', 2080, 80)], edges: [] }), w = b.wire
  w('ninput', 'dx', 'nnx', 'param:a'); w('ninput', 'dy', 'nny', 'param:a'); w('nnx', 'out:scalar:value', 'nx', 'in:scalar:pixels'); w('nny', 'out:scalar:value', 'ny', 'in:scalar:pixels')
  w('ninput', 'b', 'nx', 'in:frame:image'); w('nx', 'out:frame:image', 'ny', 'in:frame:image'); w('ninput', 'a', 'nflow', 'in:frame:a'); w('ny', 'out:frame:image', 'nflow', 'in:frame:b')
  w('ninput', 'levels', 'nflow', 'param:levels'); w('ninput', 'window', 'nflow', 'param:window')
  w('nflow', 'out:flow:field', 'nrestore', 'in:flow:field'); w('ninput', 'dx', 'nrestore', 'param:dx'); w('ninput', 'dy', 'nrestore', 'param:dy')
  w('nrestore', 'out:flow:field', 'noutput', 'field'); w('ny', 'out:frame:image', 'noutput', 'aligned'); w('nflow', 'out:flow:field', 'noutput', 'residual')
  return { ...definition, graph: { version: 1, nodes: b.doc.nodes, edges: b.doc.edges } }
}

/** The motion-vectors cookbook as editable primitives and reusable node groups, ready to bake. */
export const motionVectorsGraph = (): GraphDocument => {
  const nodes = [node('n1', 'clip', 0, 80), node('ntime', 'time', 0, 600), node('ninfo', 'videoInfo', 0, 950), node('nlast', 'math', 330, 950, { operation: 'subtract', b: 1 }), node('nnext', 'math', 330, 600, { operation: 'add', b: 1 }), node('nclamp', 'math', 660, 600, { operation: 'min' }), node('na', 'readFrame', 660, 80), node('nb', 'readFrame', 990, 600), node('nga', 'grayscale', 990, 80, { weights: 'rec601' }), node('ngb', 'grayscale', 1320, 600, { weights: 'rec601' }),
    { ...node('npan', 'group', 1650, 950), definition: 'gcoarsepan' }, node('nnx', 'math', 1980, 950, { operation: 'multiply', b: -1 }), node('nny', 'math', 1980, 1300, { operation: 'multiply', b: -1 }),
    { ...node('nforward', 'group', 2310, 80, { dx: 0, dy: 0, levels: 4, window: 25 }), definition: 'gcompensatedflow' }, { ...node('nbackward', 'group', 2310, 850, { dx: 0, dy: 0, levels: 4, window: 25 }), definition: 'gcompensatedflow' },
    node('ntexture', 'cornerStrength', 1650, 1600), node('ntextured', 'threshold', 1980, 1600, { cutoff: 0.005 }), node('ncheck', 'flowConsistency', 2640, 850), node('naccepted', 'multiplyImages', 2970, 850), node('ncell', 'constant', 2970, 1400, { value: 48 }), node('ngrid', 'flowGrid', 3300, 80), node('ndraw', 'drawFlow', 3630, 80, { gain: 3 }), node('n5', 'output', 3960, 80)]
  nodes.push({ ...node('nworking', 'group', 1320, 80, { limit: 640 }), definition: 'gworkingpair' })
  for (const item of nodes) if (!['n1', 'ntime', 'ninfo', 'nlast', 'nnext', 'nclamp', 'na', 'nb', 'nworking'].includes(item.id)) item.position.x += 660
  const b = builder({ version: 1, nodes, edges: [], definitions: [workingPair(), coarsePan(), compensatedFlow()] }), w = b.wire
  w('n1', 'out:video:clip', 'ninfo', 'in:video:clip'); w('ninfo', 'out:scalar:frames', 'nlast', 'param:a'); w('ntime', 'out:scalar:index', 'nnext', 'param:a'); w('nnext', 'out:scalar:value', 'nclamp', 'param:a'); w('nlast', 'out:scalar:value', 'nclamp', 'param:b')
  for (const id of ['na', 'nb']) w('n1', 'out:video:clip', id, 'in:video:clip')
  w('ntime', 'out:scalar:index', 'na', 'param:frame'); w('nclamp', 'out:scalar:value', 'nb', 'param:frame'); w('na', 'out:frame:image', 'nworking', 'a'); w('nb', 'out:frame:image', 'nworking', 'b'); w('nworking', 'a', 'nga', 'in:frame:image'); w('nworking', 'b', 'ngb', 'in:frame:image')
  w('nga', 'out:frame:image', 'npan', 'a'); w('ngb', 'out:frame:image', 'npan', 'b')
  for (const axis of ['x', 'y']) { w('npan', `d${axis}`, `nn${axis}`, 'param:a'); w('npan', `d${axis}`, 'nforward', `d${axis}`); w(`nn${axis}`, 'out:scalar:value', 'nbackward', `d${axis}`) }
  w('nga', 'out:frame:image', 'nforward', 'a'); w('ngb', 'out:frame:image', 'nforward', 'b'); w('ngb', 'out:frame:image', 'nbackward', 'a'); w('nga', 'out:frame:image', 'nbackward', 'b')
  w('nforward', 'field', 'ncheck', 'in:flow:forward'); w('nbackward', 'field', 'ncheck', 'in:flow:backward'); w('nga', 'out:frame:image', 'ntexture', 'in:frame:image'); w('ntexture', 'out:frame:image', 'ntextured', 'in:frame:image')
  w('ncheck', 'out:frame:image', 'naccepted', 'in:frame:a'); w('ntextured', 'out:frame:image', 'naccepted', 'in:frame:b'); w('naccepted', 'out:frame:image', 'ngrid', 'in:frame:mask'); w('nforward', 'field', 'ngrid', 'in:flow:field')
  for (const id of ['ngrid', 'ndraw']) w('ncell', 'out:scalar:value', id, 'param:cell')
  w('nworking', 'a', 'ndraw', 'in:frame:image'); w('ngrid', 'out:flow:field', 'ndraw', 'in:flow:field'); w('ngrid', 'out:frame:image', 'ndraw', 'in:frame:mask'); w('ndraw', 'out:frame:image', 'n5', 'in:frame:image')
  return b.doc
}

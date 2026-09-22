import { connect } from './graph'
import { defaultParams } from './specs'
import { translateDefinition } from './definitions'
import type { GraphDocument, GraphNode, NodeDefinition, NodeType, Params } from './types'

export type Prefab = 'difference' | 'filter' | 'motion' | 'mask' | 'crop' | 'pyramid'
const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/** Editable three-level pyramids make every downsample, expand and subtraction visible. */
export const pyramidDefinition = (laplacian: boolean): NodeDefinition => {
  let doc: GraphDocument = { version: 1, nodes: [node('ninput', 'groupInput', 20, 50), node('noutput', 'groupOutput', 1800, 50)], edges: [] }
  const id = laplacian ? 'glaplacian' : 'ggaussian'
  const definition: NodeDefinition = { id, name: `${laplacian ? 'Laplacian' : 'Gaussian'} Pyramid · 3 levels`, description: laplacian ? 'Downsample three times. Expand each next level back to the previous size and subtract it to retain the missing detail as a signed band. Package the three bands and the coarse frame; Reconstruct Pyramid reverses this with upsample + add.' : 'Repeatedly smooth and halve the frame with Pyramid Down, then package the original and three smaller images. Each level covers the same scene with fewer pixels.', inputs: [{ id: 'image', label: 'Frame', type: 'frame' }], outputs: [{ id: 'levels', label: 'Pyramid', type: 'frames' }], graph: doc }
  doc = { ...doc, definitions: [definition], interfaceId: id }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  let source = 'ninput', sourceHandle = 'image'
  doc.nodes.push(node('nlevels', 'frameList', 1500, 80, { kind: laplacian ? 'laplacian' : 'gaussian' }))
  for (let i = 0; i < 3; i++) {
    const down = `ndown${i}`
    doc.nodes.push(node(down, 'pyrDown', 300 + i * 370, 60))
    wire(source, sourceHandle, down, 'in:frame:image')
    if (laplacian) {
      const up = `nup${i}`, info = `ninfo${i}`, band = `nband${i}`
      doc.nodes.push(node(info, 'imageInfo', 300 + i * 370, 370), node(up, 'pyrUp', 300 + i * 370, 650), node(band, 'subtractImages', 300 + i * 370, 1000, { absolute: false }))
      wire(source, sourceHandle, info, 'in:frame:image'); wire(down, 'out:frame:image', up, 'in:frame:image')
      wire(info, 'out:scalar:width', up, 'param:width'); wire(info, 'out:scalar:height', up, 'param:height')
      wire(source, sourceHandle, band, 'in:frame:a'); wire(up, 'out:frame:image', band, 'in:frame:b')
      wire(band, 'out:frame:image', 'nlevels', `in:frame:level${i}`)
    } else wire(source, sourceHandle, 'nlevels', `in:frame:level${i}`)
    source = down; sourceHandle = 'out:frame:image'
  }
  wire(source, sourceHandle, 'nlevels', 'in:frame:level3'); wire('nlevels', 'out:frames:levels', 'noutput', 'levels')
  return { ...definition, graph: { version: 1, nodes: doc.nodes, edges: doc.edges } }
}

/** Video values become frames only at an explicit extraction node. Rendering advances Time. */
export const explicitGraph = (mode: Prefab = 'difference'): GraphDocument => {
  let doc: GraphDocument = { version: 1, definitions: [translateDefinition(), pyramidDefinition(false), pyramidDefinition(true), borderFillDefinition()], nodes: [node('n1', 'clip', 30, 80), node('n6', 'time', 30, 520), node('nframe', 'readFrame', 360, 80), node('n5', 'output', 1350, 80)], edges: [] }
  const wire = (source: string, target: string, targetHandle = 'in:frame:image', sourceHandle = 'out:frame:image') => { doc = connect(doc, { source, target, sourceHandle, targetHandle }) }
  wire('n1', 'nframe', 'in:video:clip', 'out:video:clip'); wire('n6', 'nframe', 'param:frame', 'out:scalar:index')
  if (mode === 'crop') {
    doc.nodes.push(node('nrect', 'rectangle', 360, 530, { x: 16, y: 16, width: 64, height: 64 }), node('nrectparts', 'splitRectangle', 710, 530), node('ncrop', 'crop', 700, 80), node('nblur', 'blur', 1040, 80), node('npaste', 'paste', 1380, 80, { x: 16, y: 16 }))
    doc.nodes.find(n => n.id === 'n5')!.position.x = 1700
    wire('nframe', 'ncrop'); wire('nrect', 'ncrop', 'in:rect:region', 'out:rect:value'); wire('nrect', 'nrectparts', 'in:rect:value', 'out:rect:value'); wire('nrectparts', 'npaste', 'param:x', 'out:scalar:x'); wire('nrectparts', 'npaste', 'param:y', 'out:scalar:y'); wire('ncrop', 'nblur'); wire('nframe', 'npaste', 'in:frame:base'); wire('nblur', 'npaste', 'in:frame:patch'); wire('npaste', 'n5')
  } else if (mode === 'pyramid') {
    doc.nodes.push({ ...node('npyramid', 'group', 700, 80), definition: 'glaplacian' }, node('nlevel', 'pyramidLevel', 1030, 550), node('nrestore', 'reconstructPyramid', 1030, 80))
    wire('nframe', 'npyramid', 'image'); wire('npyramid', 'nlevel', 'in:frames:levels', 'levels'); wire('npyramid', 'nrestore', 'in:frames:levels', 'levels'); wire('nrestore', 'n5')
  } else {
    if (mode !== 'filter') {
      doc.nodes.push(node('nnext', 'math', 360, 530, { operation: 'add', b: 1 }), node('nframeb', 'readFrame', 710, 530))
      wire('n6', 'nnext', 'param:a', 'out:scalar:index'); wire('n1', 'nframeb', 'in:video:clip', 'out:video:clip'); wire('nnext', 'nframeb', 'param:frame', 'out:scalar:value')
    }
    if (mode === 'motion') {
      doc.nodes.push(node('n2', 'phaseCorrelation', 1050, 450), node('n7', 'multiply', 1400, 250), node('n8', 'multiply', 1400, 700), { ...node('n3', 'group', 1750, 80), definition: 'gtranslate', params: { x: 0, y: 0 } })
      doc.nodes.find(n => n.id === 'n5')!.position.x = 2100
      wire('nframe', 'n2', 'in:frame:a'); wire('nframeb', 'n2', 'in:frame:b')
      wire('n2', 'n7', 'in:scalar:a', 'out:scalar:dx'); wire('n2', 'n8', 'in:scalar:a', 'out:scalar:dy')
      wire('n6', 'n7', 'in:scalar:b', 'out:scalar:fraction'); wire('n6', 'n8', 'in:scalar:b', 'out:scalar:fraction')
      wire('nframe', 'n3', 'image'); wire('n7', 'n3', 'x', 'out:scalar:value'); wire('n8', 'n3', 'y', 'out:scalar:value'); doc.nodes.push({ ...node('nfill', 'group', 2100, 80), definition: 'gborderfill', params: { dx: 0, dy: 0, fraction: 0 } })
      doc.nodes.find(n => n.id === 'n5')!.position.x = 2450
      wire('n3', 'nfill', 'a', 'image'); wire('nframeb', 'nfill', 'b'); wire('n2', 'nfill', 'dx', 'out:scalar:dx'); wire('n2', 'nfill', 'dy', 'out:scalar:dy'); wire('n6', 'nfill', 'fraction', 'out:scalar:fraction'); wire('nfill', 'n5', 'in:frame:image', 'image')
    } else {
      doc.nodes.push(node('n2', 'grayscale', 710, 80), node('n3', 'blur', 1060, 80))
      wire('nframe', 'n2'); wire('n2', 'n3')
      if (mode === 'filter') wire('n3', 'n5')
      else {
        doc.nodes.push(node('n2b', 'grayscale', 1060, 590), node('n3b', 'blur', 1410, 590), node('n4', 'subtractImages', 1760, 80))
        wire('nframeb', 'n2b'); wire('n2b', 'n3b'); wire('n3', 'n4', 'in:frame:a'); wire('n3b', 'n4', 'in:frame:b')
        if (mode === 'mask') { doc.nodes.push(node('nmask', 'threshold', 2110, 80)); wire('n4', 'nmask'); wire('nmask', 'n5'); doc.nodes.find(n => n.id === 'n5')!.position.x = 2460 }
        else { wire('n4', 'n5'); doc.nodes.find(n => n.id === 'n5')!.position.x = 2110 }
      }
    }
  }
  return doc
}

/** Compare both transformed coverage masks; retain A unless B supplies more coverage. */
export const borderFillDefinition = (): NodeDefinition => {
  const id = 'gborderfill'
  const definition: NodeDefinition = {
    id, name: 'Fill revealed borders',
    description: 'The previous frame has moved by fraction × delta. Move the next frame by (fraction − 1) × delta to align it to the same instant. Transform a white coverage mask alongside each frame. Subtract previous coverage from next coverage and keep positive differences as the fill mask. Keep previous-frame pixels wherever their coverage is at least as good; replace only pixels better covered by the next frame. There is no temporal blending. Corners neither frame covers remain empty, and an inaccurate global motion estimate can cause a seam.',
    inputs: [{ id: 'a', label: 'Shifted previous frame', type: 'frame' }, { id: 'b', label: 'Next frame', type: 'frame' }, { id: 'dx', label: 'Full delta X', type: 'scalar', default: 0 }, { id: 'dy', label: 'Full delta Y', type: 'scalar', default: 0 }, { id: 'fraction', label: 'Fraction 0…1', type: 'scalar', default: 0 }],
    outputs: [{ id: 'image', label: 'Filled frame', type: 'frame' }, { id: 'coverage', label: 'Previous-frame coverage', type: 'frame' }, { id: 'fill', label: 'Aligned next frame', type: 'frame' }, { id: 'fillMask', label: 'Next-frame fill mask', type: 'frame' }],
    graph: { version: 1, nodes: [], edges: [] },
  }
  let doc: GraphDocument = { version: 1, definitions: [definition], interfaceId: id, nodes: [
    node('ninput', 'groupInput', 20, 100), node('ncoverage', 'coverage', 340, 20),
    node('ndxa', 'multiply', 340, 420), node('ndya', 'multiply', 340, 770),
    node('nmx', 'translateX', 680, 20), node('nmy', 'translateY', 1020, 20),
    node('ncoverageb', 'coverage', 680, 1500), node('nmbx', 'translateX', 1020, 1500), node('nmby', 'translateY', 1360, 1500), node('nmore', 'subtractImages', 1700, 700, { absolute: false }), node('nvalid', 'threshold', 2040, 700, { cutoff: 0.0001 }),
    node('nrelative', 'math', 340, 1120, { operation: 'subtract', b: 1 }), node('ndxb', 'multiply', 680, 740), node('ndyb', 'multiply', 680, 1090),
    node('nbx', 'translateX', 1020, 650), node('nby', 'translateY', 1360, 650),
    node('ncomposite', 'composite', 2380, 100), node('noutput', 'groupOutput', 2720, 100),
  ], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  wire('ninput', 'a', 'ncoverage', 'in:frame:image')
  for (const [axis, idA, idB] of [['dx', 'ndxa', 'ndxb'], ['dy', 'ndya', 'ndyb']] as const) {
    wire('ninput', axis, idA, 'in:scalar:a'); wire('ninput', 'fraction', idA, 'in:scalar:b')
    wire('ninput', axis, idB, 'in:scalar:a'); wire('nrelative', 'out:scalar:value', idB, 'in:scalar:b')
  }
  wire('ninput', 'fraction', 'nrelative', 'param:a')
  wire('ncoverage', 'out:frame:image', 'nmx', 'in:frame:image'); wire('ndxa', 'out:scalar:value', 'nmx', 'in:scalar:pixels')
  wire('nmx', 'out:frame:image', 'nmy', 'in:frame:image'); wire('ndya', 'out:scalar:value', 'nmy', 'in:scalar:pixels')
  wire('ninput', 'b', 'nbx', 'in:frame:image'); wire('ndxb', 'out:scalar:value', 'nbx', 'in:scalar:pixels')
  wire('nbx', 'out:frame:image', 'nby', 'in:frame:image'); wire('ndyb', 'out:scalar:value', 'nby', 'in:scalar:pixels')
  wire('ninput', 'b', 'ncoverageb', 'in:frame:image'); wire('ncoverageb', 'out:frame:image', 'nmbx', 'in:frame:image'); wire('ndxb', 'out:scalar:value', 'nmbx', 'in:scalar:pixels')
  wire('nmbx', 'out:frame:image', 'nmby', 'in:frame:image'); wire('ndyb', 'out:scalar:value', 'nmby', 'in:scalar:pixels')
  wire('nmby', 'out:frame:image', 'nmore', 'in:frame:a'); wire('nmy', 'out:frame:image', 'nmore', 'in:frame:b'); wire('nmore', 'out:frame:image', 'nvalid', 'in:frame:image')
  wire('nby', 'out:frame:image', 'ncomposite', 'in:frame:foreground'); wire('ninput', 'a', 'ncomposite', 'in:frame:background'); wire('nvalid', 'out:frame:image', 'ncomposite', 'in:frame:mask')
  wire('ncomposite', 'out:frame:image', 'noutput', 'image'); wire('nmy', 'out:frame:image', 'noutput', 'coverage'); wire('nvalid', 'out:frame:image', 'noutput', 'fillMask'); wire('nby', 'out:frame:image', 'noutput', 'fill')
  return { ...definition, graph: { version: 1, nodes: doc.nodes, edges: doc.edges } }
}

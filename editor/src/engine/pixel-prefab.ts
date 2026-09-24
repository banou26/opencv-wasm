import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/** Full-resolution layer extraction: camera, redraw ink, silhouettes, plate, carve against the plate, plate again, layer frames. */
export const pixelLayersGraph = (): GraphDocument => {
  let doc: GraphDocument = { version: 1, nodes: [
    node('n1', 'clip', 20, 40), node('ninfo', 'videoInfo', 20, 400), node('nlast', 'math', 350, 400, { operation: 'subtract', b: 1 }),
    node('nscene', 'sceneRange', 700, 40), node('ncamera', 'pixelCamera', 1080, 40), node('nevidence', 'pixelEvidence', 1460, 40),
    node('nsilhouettes', 'pixelSilhouettes', 1840, 40), node('nplate', 'pixelPlate', 2220, 40), node('nrefine', 'pixelRefine', 2600, 40),
    node('nplate2', 'pixelPlate', 2980, 40), node('nframes', 'pixelFrames', 3360, 40),
    node('ntime', 'time', 2980, 780), node('ninspect', 'pixelInspect', 3360, 700),
    node('ntop', 'frameLayout', 3740, 560), node('nbottom', 'frameLayout', 3740, 1080),
    node('ngrid', 'frameLayout', 4110, 780, { direction: 'vertical' }), node('nlayout', 'frameLayout', 4480, 780, { direction: 'vertical' }), node('n5', 'output', 4850, 780),
  ], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  wire('n1', 'out:video:clip', 'ninfo', 'in:video:clip')
  wire('ninfo', 'out:scalar:frames', 'nlast', 'param:a')
  wire('nlast', 'out:scalar:value', 'nscene', 'param:last')
  wire('n1', 'out:video:clip', 'nscene', 'in:video:clip')
  for (const [source, target] of [['nscene', 'ncamera'], ['ncamera', 'nevidence'], ['nevidence', 'nsilhouettes'], ['nsilhouettes', 'nplate'], ['nplate', 'nrefine'], ['nrefine', 'nplate2'], ['nplate2', 'nframes'], ['nframes', 'ninspect']] as const) wire(source, 'out:regions:data', target, 'in:regions:data')
  wire('ntime', 'out:scalar:index', 'ninspect', 'param:frame')
  wire('ninspect', 'out:frame:changes', 'ntop', 'in:frame:a')
  wire('ninspect', 'out:frame:ink', 'ntop', 'in:frame:b')
  wire('ninspect', 'out:frame:layer', 'nbottom', 'in:frame:a')
  wire('ninspect', 'out:frame:plate', 'nbottom', 'in:frame:b')
  wire('ntop', 'out:frame:image', 'ngrid', 'in:frame:a')
  wire('nbottom', 'out:frame:image', 'ngrid', 'in:frame:b')
  wire('ngrid', 'out:frame:image', 'nlayout', 'in:frame:a')
  wire('ninspect', 'out:frame:drawings', 'nlayout', 'in:frame:b')
  wire('nlayout', 'out:frame:image', 'n5', 'in:frame:image')
  return doc
}

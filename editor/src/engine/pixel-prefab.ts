import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/**
 * Full-resolution layer extraction: camera, sliding layers, redraw ink, silhouettes, a follow shot's sliding
 * painting promoted to the backdrop, plate, carve against the scene, the sliding layers' second pass, plate
 * again, growth into what the scene cannot explain, what holds still against the whole plate carved, plate,
 * growth and plate again, layer frames. Release Held Scenery stays out: after the still carve it only cuts the
 * layers into pieces. With no sliding layer its stages pass through. The inspect rows show each plane alone beside
 * the source.
 */
export const pixelLayersGraph = (): GraphDocument => {
  let doc: GraphDocument = { version: 1, nodes: [
    node('n1', 'clip', 20, 40), node('ninfo', 'videoInfo', 20, 400), node('nlast', 'math', 350, 400, { operation: 'subtract', b: 1 }),
    node('nscene', 'sceneRange', 700, 40), node('ncamera', 'pixelCamera', 1080, 40), node('nrigid', 'pixelRigid', 1080, 420), node('nevidence', 'pixelEvidence', 1460, 40),
    node('nmedian', 'pixelScenery', 1460, 420), node('nsilhouettes', 'pixelSilhouettes', 1840, 40), node('nbackdrop', 'pixelBackdrop', 1840, 420), node('nplate', 'pixelPlate', 2220, 40), node('nrefine', 'pixelRefine', 2600, 40),
    node('nrigid2', 'pixelRigidRefine', 2600, 420), node('nplate2', 'pixelPlate', 2980, 40), node('ngrow', 'pixelGrow', 2980, 420), node('nstill', 'pixelStill', 2980, 1160), node('nplate3', 'pixelPlate', 3360, 420),
    node('ngrow2', 'pixelGrow', 2980, 1540), node('nplate4', 'pixelPlate', 2980, 1920), node('nframes', 'pixelFrames', 3360, 40),
    node('ntime', 'time', 2980, 780), node('ninspect', 'pixelInspect', 3360, 700),
    node('ntop', 'frameLayout', 3740, 560), node('nbottom', 'frameLayout', 3740, 1080), node('nrebuild', 'frameLayout', 3740, 1600), node('nrows', 'frameLayout', 4110, 1340, { direction: 'vertical' }),
    node('nplanesrow', 'frameLayout', 3740, 2120), node('nlower', 'frameLayout', 4110, 1860, { direction: 'vertical' }),
    node('ngrid', 'frameLayout', 4110, 780, { direction: 'vertical' }), node('nlayout', 'frameLayout', 4480, 780, { direction: 'vertical' }), node('n5', 'output', 4850, 780),
  ], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  wire('n1', 'out:video:clip', 'ninfo', 'in:video:clip')
  wire('ninfo', 'out:scalar:frames', 'nlast', 'param:a')
  wire('nlast', 'out:scalar:value', 'nscene', 'param:last')
  wire('n1', 'out:video:clip', 'nscene', 'in:video:clip')
  for (const [source, target] of [['nscene', 'ncamera'], ['ncamera', 'nrigid'], ['nrigid', 'nevidence'], ['nevidence', 'nmedian'], ['nmedian', 'nsilhouettes'], ['nsilhouettes', 'nbackdrop'], ['nbackdrop', 'nplate'], ['nplate', 'nrefine'], ['nrefine', 'nrigid2'], ['nrigid2', 'nplate2'], ['nplate2', 'ngrow'], ['ngrow', 'nstill'], ['nstill', 'nplate3'], ['nplate3', 'ngrow2'], ['ngrow2', 'nplate4'], ['nplate4', 'nframes'], ['nframes', 'ninspect']] as const) wire(source, 'out:regions:data', target, 'in:regions:data')
  wire('ntime', 'out:scalar:index', 'ninspect', 'param:frame')
  wire('ninspect', 'out:frame:changes', 'ntop', 'in:frame:a')
  wire('ninspect', 'out:frame:ink', 'ntop', 'in:frame:b')
  wire('ninspect', 'out:frame:layer', 'nbottom', 'in:frame:a')
  wire('ninspect', 'out:frame:plate', 'nbottom', 'in:frame:b')
  wire('ninspect', 'out:frame:rebuilt', 'nrebuild', 'in:frame:a')
  wire('ninspect', 'out:frame:residual', 'nrebuild', 'in:frame:b')
  wire('ntop', 'out:frame:image', 'ngrid', 'in:frame:a')
  wire('nbottom', 'out:frame:image', 'nrows', 'in:frame:a')
  wire('nrebuild', 'out:frame:image', 'nrows', 'in:frame:b')
  wire('ninspect', 'out:frame:planes', 'nplanesrow', 'in:frame:a')
  wire('ninspect', 'out:frame:source', 'nplanesrow', 'in:frame:b')
  wire('nrows', 'out:frame:image', 'nlower', 'in:frame:a')
  wire('nplanesrow', 'out:frame:image', 'nlower', 'in:frame:b')
  wire('nlower', 'out:frame:image', 'ngrid', 'in:frame:b')
  wire('ngrid', 'out:frame:image', 'nlayout', 'in:frame:a')
  wire('ninspect', 'out:frame:drawings', 'nlayout', 'in:frame:b')
  wire('nlayout', 'out:frame:image', 'n5', 'in:frame:image')
  return doc
}

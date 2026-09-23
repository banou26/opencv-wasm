import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/** Full-clip range by default. Time is wired only to read-only evidence inspectors. */
export const regionalLayersGraph = (): GraphDocument => {
  let doc: GraphDocument = { version: 1, nodes: [
    node('n1', 'clip', 20, 40), node('ninfo', 'videoInfo', 20, 380), node('nlast', 'math', 340, 380, { operation: 'subtract', b: 1 }),
    node('nscene', 'sceneRange', 680, 40), node('ndense', 'regionalMotion', 1050, 40), node('npool', 'regionalPool', 1420, 40),
    node('ntracks', 'regionalTracks', 1790, 40), node('ntiming', 'regionalTiming', 2160, 40), node('ntime', 'time', 20, 880),
    node('nsourceview', 'regionalInspect', 680, 740, { view: 'source' }), node('nflowview', 'regionalInspect', 1050, 740, { view: 'flow' }),
    node('nvalidview', 'regionalInspect', 1050, 1260, { view: 'validity' }), node('ngridview', 'regionalInspect', 1420, 740, { view: 'cells' }),
    node('ntracksview', 'regionalInspect', 1790, 740, { view: 'tracks' }), node('neventsview', 'regionalInspect', 2160, 740, { view: 'events' }),
    node('ntimeview', 'regionalInspect', 2160, 1340, { view: 'timeline' }),
    node('nreview', 'regionalInspect', 2530, 40, { view: 'review' }), node('n5', 'output', 2900, 40),
  ], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  wire('n1', 'out:video:clip', 'ninfo', 'in:video:clip')
  wire('ninfo', 'out:scalar:frames', 'nlast', 'param:a')
  wire('nlast', 'out:scalar:value', 'nscene', 'param:last')
  wire('n1', 'out:video:clip', 'nscene', 'in:video:clip')
  for (const [source, target] of [['nscene', 'ndense'], ['ndense', 'npool'], ['npool', 'ntracks'], ['ntracks', 'ntiming'], ['ntiming', 'nreview'], ['nscene', 'nsourceview'], ['ndense', 'nflowview'], ['ndense', 'nvalidview'], ['npool', 'ngridview'], ['ntracks', 'ntracksview'], ['ntiming', 'neventsview']] as const) wire(source, 'out:regions:data', target, 'in:regions:data')
  wire('ntiming', 'out:regions:data', 'ntimeview', 'in:regions:data')
  for (const id of ['nsourceview', 'nflowview', 'nvalidview', 'ngridview', 'ntracksview', 'neventsview', 'ntimeview', 'nreview']) wire('ntime', 'out:scalar:index', id, 'param:frame')
  wire('nreview', 'out:frame:image', 'n5', 'in:frame:image')
  return doc
}

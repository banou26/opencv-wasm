import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/** Full-clip range by default. Time is wired only to read-only evidence inspectors. */
export const regionalLayersGraph = (): GraphDocument => {
  let doc: GraphDocument = { version: 1, nodes: [
    node('n1', 'clip', 20, 40), node('ninfo', 'videoInfo', 20, 380), node('nlast', 'math', 340, 380, { operation: 'subtract', b: 1 }),
    node('nscene', 'sceneRange', 680, 40), node('ndense', 'regionalMotion', 1050, 40), node('npool', 'regionalPool', 1420, 40),
    node('ntracks', 'regionalTracks', 1790, 40), node('nhistory', 'regionalHistory', 2160, 40), node('ntiming', 'regionalTiming', 2530, 40), node('ntime', 'time', 20, 880),
    node('nsourceview', 'regionalInspect', 680, 740, { view: 'source' }), node('nflowview', 'regionalInspect', 1050, 740, { view: 'flow' }),
    node('nvalidview', 'regionalInspect', 1050, 1260, { view: 'validity' }), node('ngridview', 'regionalInspect', 1420, 740, { view: 'cells' }),
    node('ntracksview', 'regionalInspect', 1790, 740, { view: 'tracks' }), node('nfamiliesview', 'regionalInspect', 2160, 740, { view: 'families' }),
    node('nvelocityview', 'regionalInspect', 2160, 1260, { view: 'velocities' }), node('neventsview', 'regionalInspect', 2530, 740, { view: 'events' }),
    node('ntimeview', 'regionalInspect', 2530, 1340, { view: 'timeline' }),
    node('nconflictview', 'regionalInspect', 2900, 740, { view: 'conflicts' }),
    node('ncomplete', 'regionalComplete', 3270, 740), node('ncompletionview', 'regionalCompletionInspect', 3270, 1340),
    node('ncompletiontop', 'frameLayout', 3640, 1100), node('ncompletionbottom', 'frameLayout', 3640, 1600),
    node('ncompletionlayout', 'frameLayout', 4010, 1340, { direction: 'vertical' }),
    node('nreview', 'regionalInspect', 2900, 40, { view: 'review' }), node('n5', 'output', 4380, 1340),
  ], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  wire('n1', 'out:video:clip', 'ninfo', 'in:video:clip')
  wire('ninfo', 'out:scalar:frames', 'nlast', 'param:a')
  wire('nlast', 'out:scalar:value', 'nscene', 'param:last')
  wire('n1', 'out:video:clip', 'nscene', 'in:video:clip')
  for (const [source, target] of [['nscene', 'ndense'], ['ndense', 'npool'], ['npool', 'ntracks'], ['ntracks', 'nhistory'], ['nhistory', 'ntiming'], ['ntiming', 'nreview'], ['nscene', 'nsourceview'], ['ndense', 'nflowview'], ['ndense', 'nvalidview'], ['npool', 'ngridview'], ['ntracks', 'ntracksview'], ['nhistory', 'nfamiliesview'], ['nhistory', 'nvelocityview'], ['ntiming', 'neventsview']] as const) wire(source, 'out:regions:data', target, 'in:regions:data')
  wire('ntiming', 'out:regions:data', 'ntimeview', 'in:regions:data')
  wire('ntiming', 'out:regions:data', 'nconflictview', 'in:regions:data')
  wire('ntiming', 'out:regions:data', 'ncomplete', 'in:regions:data')
  wire('ncomplete', 'out:regions:data', 'ncompletionview', 'in:regions:data')
  for (const id of ['nsourceview', 'nflowview', 'nvalidview', 'ngridview', 'ntracksview', 'nfamiliesview', 'nvelocityview', 'nconflictview', 'ncompletionview', 'neventsview', 'ntimeview', 'nreview']) wire('ntime', 'out:scalar:index', id, 'param:frame')
  wire('ncompletionview', 'out:frame:source', 'ncompletiontop', 'in:frame:a')
  wire('ncompletionview', 'out:frame:measured', 'ncompletiontop', 'in:frame:b')
  wire('ncompletionview', 'out:frame:completed', 'ncompletionbottom', 'in:frame:a')
  wire('ncompletionview', 'out:frame:provenance', 'ncompletionbottom', 'in:frame:b')
  wire('ncompletiontop', 'out:frame:image', 'ncompletionlayout', 'in:frame:a')
  wire('ncompletionbottom', 'out:frame:image', 'ncompletionlayout', 'in:frame:b')
  wire('ncompletionlayout', 'out:frame:image', 'n5', 'in:frame:image')
  return doc
}

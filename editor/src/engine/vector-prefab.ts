import { connect } from './graph'
import { defaultParams } from './specs'
import type { GraphDocument, GraphNode, NodeType, Params } from './types'

const node = (id: string, type: NodeType, x: number, y: number, params: Params = {}): GraphNode => ({ id, type, params: { ...defaultParams(type), ...params }, position: { x, y } })

/** Independent measured grouping, identities, completion and inferred fragment merging. */
export const vectorLayersGraph = (): GraphDocument => {
  let doc: GraphDocument = { version: 1, nodes: [
    node('n1', 'clip', 20, 40), node('ninfo', 'videoInfo', 20, 400), node('nlast', 'math', 350, 400, { operation: 'subtract', b: 1 }),
    node('nscene', 'sceneRange', 700, 40), node('ncandidates', 'vectorCandidates', 1080, 40), node('ngroups', 'vectorGroups', 1460, 40),
    node('ntrack', 'vectorTrack', 1840, 40), node('ncomplete', 'vectorComplete', 2220, 40),
    node('nfragments', 'vectorFragments', 2600, 40),
    node('ncompletionview', 'vectorCompletionInspect', 2220, 780), node('nidentityview', 'vectorIdentityInspect', 2600, 780),
    node('ntime', 'time', 700, 880), node('ncandidateview', 'vectorInspect', 1080, 780), node('nview', 'vectorInspect', 1460, 780),
    node('ntop', 'frameLayout', 2990, 640), node('nbottom', 'frameLayout', 2990, 1160),
    node('nlayout', 'frameLayout', 3360, 780, { direction: 'vertical' }), node('n5', 'output', 3730, 780),
  ], edges: [] }
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => { doc = connect(doc, { source, sourceHandle, target, targetHandle }) }
  wire('n1', 'out:video:clip', 'ninfo', 'in:video:clip')
  wire('ninfo', 'out:scalar:frames', 'nlast', 'param:a')
  wire('nlast', 'out:scalar:value', 'nscene', 'param:last')
  wire('n1', 'out:video:clip', 'nscene', 'in:video:clip')
  for (const [source, target] of [['nscene', 'ncandidates'], ['ncandidates', 'ngroups'], ['ncandidates', 'ncandidateview'], ['ngroups', 'nview'], ['ngroups', 'ntrack'], ['ntrack', 'ncomplete'], ['ncomplete', 'ncompletionview'], ['ncomplete', 'nfragments'], ['nfragments', 'nidentityview']] as const) wire(source, 'out:regions:data', target, 'in:regions:data')
  for (const id of ['ncandidateview', 'nview', 'ncompletionview', 'nidentityview']) wire('ntime', 'out:scalar:index', id, 'param:frame')
  wire('nview', 'out:frame:source', 'ntop', 'in:frame:a')
  wire('nview', 'out:frame:candidates', 'ntop', 'in:frame:b')
  wire('nidentityview', 'out:frame:completed', 'nbottom', 'in:frame:a')
  wire('nidentityview', 'out:frame:provenance', 'nbottom', 'in:frame:b')
  wire('ntop', 'out:frame:image', 'nlayout', 'in:frame:a')
  wire('nbottom', 'out:frame:image', 'nlayout', 'in:frame:b')
  wire('nlayout', 'out:frame:image', 'n5', 'in:frame:image')
  return doc
}

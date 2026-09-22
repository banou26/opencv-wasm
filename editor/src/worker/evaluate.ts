import { evaluateGraph } from '../engine/evaluate'
import { parseDocument } from '../engine/graph'
import type { ResultCache } from '../engine/cache'
import type { NodeStatus } from '../engine/execute'
import type { Inspection, SourceDemand } from '../protocol'
import type { VideoSource } from '../video/source'
import { runKernel } from './kernels'
import { parameterValue } from './payload'
import type { Payload } from './payload'

/** Identical graph semantics in the interactive worker and every render worker. */
export const evaluateInspection = async (value: Inspection, context: {
  cache: ResultCache<Payload>; sources: Map<string, VideoSource>; source?: VideoSource
  cancelled: () => boolean; yield: () => Promise<void>; status?: (value: NodeStatus) => void; holdLastFrame?: boolean
}) => {
  const { cache, sources, cancelled } = context
  const currentSource = sources.get(value.referenceAsset ?? '') ?? context.source, doc = parseDocument(value.doc)
  const sourceById = (id: string) => { const video = sources.get(id); for (const other of sources.values()) if (other !== video) other.close(); return video }
  const demands = new Map<string, SourceDemand>()
  const result = await evaluateGraph(doc, value.selected, value.port, value.frame, value.path ?? [], {
    cache, assets: Object.fromEntries([...sources].map(([id, video]) => [id, video.info])), sourceId: currentSource?.info.id, parameter: parameterValue, holdLastFrame: context.holdLastFrame,
    clipFrameCount: value => value.kind === 'video' ? value.info.frameCount : undefined,
    cancelled, yield: context.yield, now: () => performance.now(), status: status => context.status?.(status),
    trace: (step, inputs) => {
      const video = inputs['in:video:clip']
      const asset = step.node.type === 'source' ? step.asset : step.node.type === 'readFrame' && video?.kind === 'video' ? video.asset : undefined
      if (asset) {
        const frame = step.node.type === 'source' ? step.frame : Number(step.node.params.frame)
        demands.set(`${asset}:${frame}`, { asset, frame })
      }
    },
    kernel: (step, inputs) => runKernel(step, inputs, step.asset ? step.node.type === 'source' ? sourceById(step.asset) : sources.get(step.asset) : currentSource, cancelled, doc, sourceById),
  })
  return { ...result, sources: [...demands.values()] }
}

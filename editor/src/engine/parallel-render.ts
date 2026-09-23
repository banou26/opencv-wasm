import { outputTime } from './time'
import { graphView } from './definitions'
import { specFor } from './specs'
import type { GraphDocument, GraphNode } from './types'

/** Zero chooses a conservative automatic worker count; explicit choices allow comparison. */
export type RenderWorkers = 0 | 1 | 2 | 4 | 8 | 16

/** Avoid extra native heaps on small devices and startup overhead on short renders. */
export const renderWorkerCount = (requested: RenderWorkers, total: number, cores: number, memoryGiB?: number, sceneAnalysis = false) => {
  if (![0, 1, 2, 4, 8, 16].includes(requested)) throw new Error('Choose Auto, 1, 2, 4, 8 or 16 render workers')
  const available = Math.max(1, Math.floor(cores || 1))
  const automatic = !sceneAnalysis && total >= 24 && available >= 4 && (memoryGiB === undefined || memoryGiB >= 4) ? 2 : 1
  return Math.max(1, Math.min(total, available, requested || automatic))
}

/** Follow only the selected output: extra render workers would repeat its whole-scene analysis. */
export const usesSceneAnalysis = (root: GraphDocument, selected: string, port: string | null = null, path: string[] = []): boolean => {
  type Scope = { doc: GraphDocument; path: string[]; definitions: string[]; parent?: Scope; instance?: GraphNode }
  const visited = new Set<string>()
  const enter = (scope: Scope, node: GraphNode): Scope => {
    if (node.type !== 'group' || !node.definition || scope.definitions.includes(node.definition)) throw new Error('Invalid or recursive custom-node instance')
    return { doc: graphView(root, node.definition), path: [...scope.path, node.id], definitions: [...scope.definitions, node.definition], parent: scope, instance: node }
  }
  const visit = (scope: Scope, id: string, requested: string | null): boolean => {
    const key = JSON.stringify([scope.path, id, requested])
    if (visited.has(key)) return false
    visited.add(key)
    const node = scope.doc.nodes.find(n => n.id === id)
    if (!node) throw new Error('The selected node no longer exists')
    if (node.type === 'sceneRange' || node.type.startsWith('regional')) return true
    const spec = specFor(node, scope.doc)
    const input = (socket: string | undefined) => {
      const edge = scope.doc.edges.find(e => e.target === id && e.targetHandle === socket)
      return !!edge && visit(scope, edge.source, edge.sourceHandle)
    }
    if (node.type === 'output' || node.type === 'groupOutput') return input(requested ?? spec.inputs[0]?.id)
    const output = requested ?? spec.outputs[0]?.id
    if (node.type === 'group') {
      const child = enter(scope, node), terminal = child.doc.nodes.find(n => n.type === 'groupOutput')
      return !!terminal && visit(child, terminal.id, output ?? null)
    }
    if (node.type === 'groupInput') {
      const edge = scope.parent?.doc.edges.find(e => e.target === scope.instance?.id && e.targetHandle === output)
      return !!edge && visit(scope.parent!, edge.source, edge.sourceHandle)
    }
    return spec.inputs.some(p => input(p.id))
  }
  let scope: Scope = { doc: root, path: [], definitions: [] }
  for (const id of path) {
    const instance = scope.doc.nodes.find(n => n.id === id)
    if (!instance) throw new Error('The custom-node instance no longer exists')
    scope = enter(scope, instance)
  }
  return visit(scope, selected, port)
}

/**
 * Keep output timestamps in the same source-frame interval on one worker, so
 * integer-frame branches can reuse decoding and optical flow across subframes.
 * Every timestamp is still evaluated. Limit each batch to three pixel buffers.
 */
export const renderFrameBatches = (total: number, start: number, sourceFps: number, outputFps: number): number[][] => {
  const batches: number[][] = []
  let previous = -1, batch: number[] | undefined
  for (let index = 0; index < total; index++) {
    const frame = Math.floor(outputTime(index, start, sourceFps, outputFps))
    if (!batch || batch.length === 3 || frame !== previous) { batch = []; batches.push(batch) }
    batch.push(index); previous = frame
  }
  return batches
}

/**
 * Compute concurrently, consume in index order. Each slot holds at most one
 * result or request, plus the value currently being consumed. The caller must
 * stop producers on cancellation/error; rejected future jobs are always handled.
 */
export const orderedParallel = async <T>(total: number, concurrency: number, produce: (index: number, slot: number) => Promise<T>, consume: (value: T, index: number) => Promise<void>, cancelled: () => boolean) => {
  if (total <= 0 || cancelled()) return
  type Result = { ok: true; value: T } | { ok: false; error: unknown }
  const count = Math.min(total, Math.max(1, concurrency))
  const launch = (index: number, slot: number): Promise<Result> => Promise.resolve().then(() => produce(index, slot)).then(value => ({ ok: true, value }), error => ({ ok: false, error }))
  const pending = Array.from({ length: count }, (_, slot) => launch(slot, slot))
  for (let index = 0; index < total && !cancelled(); index++) {
    const slot = index % count, result = await pending[slot]!
    if (cancelled()) return
    if (!result.ok) throw result.error
    if (index + count < total) pending[slot] = launch(index + count, slot)
    await consume(result.value, index)
  }
}

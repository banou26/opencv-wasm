import { ResultCache } from './cache'
import type { Plan, Step } from './plan'
import type { Bundle, Lease } from './types'

/** Per-node execution feedback; a cache hit never executes the kernel. */
export type NodeStatus = { node: string; path?: string[]; frame: number; state: 'running' | 'cached' | 'done'; ms?: number }
/** Execution services are injected so the graph engine has no browser dependency. */
export type ExecutionContext<T> = { cache: ResultCache<T>; kernel: (step: Step, inputs: Record<string, T>) => Promise<Bundle<T>>; cancelled: () => boolean; yield: () => Promise<void>; now: () => number; status: (status: NodeStatus) => void }

/** Run one plan with leased inputs and deterministic cleanup on error or cancellation. */
export const execute = async <T>(plan: Plan, context: ExecutionContext<T>): Promise<Lease<T>> => {
  const held = new Map<string, Lease<Bundle<T>>>(), remaining = new Map<string, number>(), needed = new Set<string>()
  const check = () => { if (context.cancelled()) throw new Error('Cancelled') }
  try {
    const demand = (key: string) => {
      if (held.has(key) || needed.has(key)) return
      const step = plan.steps.find(s => s.key === key)
      if (!step) throw new Error('Missing plan dependency')
      const cached = context.cache.acquire(key)
      if (cached) {
        held.set(key, cached)
        context.status({ node: step.node.id, path: step.path, frame: step.frame, state: 'cached' })
        return
      }
      needed.add(key)
      for (const input of Object.values(step.inputs)) { remaining.set(input.key, (remaining.get(input.key) ?? 0) + 1); demand(input.key) }
    }
    check(); demand(plan.target.key)
    for (const step of plan.steps.filter(s => needed.has(s.key))) {
      await context.yield(); check()
      let lease = context.cache.acquire(step.key)
      if (lease) context.status({ node: step.node.id, path: step.path, frame: step.frame, state: 'cached' })
      else {
        const inputs: Record<string, T> = {}
        for (const [port, input] of Object.entries(step.inputs)) {
          const value = held.get(input.key)?.value.outputs[input.port]
          if (value === undefined) throw new Error('A required input was not produced')
          inputs[port] = value
        }
        context.status({ node: step.node.id, path: step.path, frame: step.frame, state: 'running' })
        const start = context.now(), bundle = await context.kernel(step, inputs)
        try { check(); lease = context.cache.put(step.key, bundle) }
        catch (error) { bundle.dispose(); throw error }
        context.status({ node: step.node.id, path: step.path, frame: step.frame, state: 'done', ms: context.now() - start })
      }
      held.set(step.key, lease)
      for (const input of Object.values(step.inputs)) {
        const count = (remaining.get(input.key) ?? 0) - 1
        remaining.set(input.key, count)
        if (count === 0 && input.key !== plan.target.key) { held.get(input.key)?.release(); held.delete(input.key) }
      }
    }
    check()
    const target = held.get(plan.target.key), value = target?.value.outputs[plan.target.port]
    if (!target || value === undefined) throw new Error('The selected output was not produced')
    held.delete(plan.target.key)
    return { value, release: target.release }
  } finally { for (const lease of held.values()) lease.release() }
}

import { expect, test } from 'vite-plus/test'
import { ResultCache } from '../src/engine/cache'
import { execute } from '../src/engine/execute'
import { starterGraph } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import type { ExecutionContext } from '../src/engine/execute'
import { SPECS } from '../src/engine/specs'

const fixture = () => {
  const cache = new ResultCache<number>(100), calls: string[] = [], disposed: number[] = []
  let allocated = 0, cancelled = false
  const context: ExecutionContext<number> = {
    cache, cancelled: () => cancelled, yield: async () => {}, now: () => 0, status: () => {},
    kernel: async step => {
      calls.push(step.node.type)
      const id = ++allocated
      return { bytes: 10, outputs: Object.fromEntries(SPECS[step.node.type].outputs.map(p => [p.id, id])), dispose: () => disposed.push(id) }
    },
  }
  return { cache, context, calls, disposed, cancel: () => { cancelled = true } }
}

test('leases protect inputs, LRU evicts unpinned entries and releases only once', () => {
  const cache = new ResultCache<number>(20), disposed: string[] = []
  const put = (id: string) => cache.put(id, { outputs: { out: 1 }, bytes: 10, dispose: () => disposed.push(id) })
  const a = put('a'), b = put('b'); b.release()
  const c = put('c')
  expect(disposed).toEqual(['b'])
  expect(() => put('d')).toThrow('budget')
  a.release(); a.release(); c.release(); cache.clear()
  expect(disposed.sort()).toEqual(['a', 'b', 'c'])
})

test('a cached terminal skips all ancestors, even when ancestors were evicted', async () => {
  const f = fixture(), plan = planGraph(starterGraph(), 'n5', null, 3, 'clip', 10)
  const result = await execute(plan, f.context); result.release()
  const calls = f.calls.length
  f.cache.budget = 10; f.cache.trim()
  const again = await execute(plan, f.context); again.release()
  expect(f.calls).toHaveLength(calls)
  expect(f.cache.size).toBe(1)
  f.cache.clear()
  expect(new Set(f.disposed).size).toBe(calls)
})

test('changing blur reuses gray inputs and only runs blur and delta', async () => {
  const f = fixture(), doc = starterGraph()
  const first = await execute(planGraph(doc, 'n5', null, 3, 'clip', 10), f.context); first.release()
  f.calls.length = 0
  const blur = doc.nodes.find(n => n.type === 'blur')
  if (!blur) throw new Error('Missing blur')
  blur.params.sigma = 5
  const second = await execute(planGraph(doc, 'n5', null, 3, 'clip', 10), f.context); second.release()
  expect(f.calls).toEqual(['blur', 'blur', 'delta'])
  f.cache.clear()
})

test('cancellation after a kernel destroys its unpublished bundle and releases inputs', async () => {
  const f = fixture(), kernel = f.context.kernel
  f.context.kernel = async (step, inputs) => { const result = await kernel(step, inputs); if (step.node.type === 'blur') f.cancel(); return result }
  await expect(execute(planGraph(starterGraph(), 'n5', null, 0, 'clip', 10), f.context)).rejects.toThrow('Cancelled')
  f.cache.clear()
  expect(f.disposed).toHaveLength(f.calls.length)
  expect(new Set(f.disposed).size).toBe(f.calls.length)
})

test('a thrown kernel releases all leases so the cache can be cleared', async () => {
  const f = fixture(), kernel = f.context.kernel
  f.context.kernel = async (step, inputs) => { if (step.node.type === 'delta') throw new Error('Native failure'); return kernel(step, inputs) }
  await expect(execute(planGraph(starterGraph(), 'n5', null, 0, 'clip', 10), f.context)).rejects.toThrow('Native failure')
  expect(() => f.cache.clear()).not.toThrow()
  expect(f.disposed).toHaveLength(f.calls.length)
})

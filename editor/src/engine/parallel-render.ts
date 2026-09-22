/** Zero chooses a conservative automatic worker count; explicit choices allow comparison. */
export type RenderWorkers = 0 | 1 | 2 | 4

/** Avoid extra native heaps on small devices and startup overhead on short renders. */
export const renderWorkerCount = (requested: RenderWorkers, total: number, cores: number, memoryGiB?: number) => {
  if (![0, 1, 2, 4].includes(requested)) throw new Error('Choose Auto, 1, 2 or 4 render workers')
  const available = Math.max(1, Math.floor(cores || 1))
  const automatic = total >= 24 && available >= 4 && (memoryGiB === undefined || memoryGiB >= 4) ? 2 : 1
  return Math.max(1, Math.min(total, available, requested || automatic))
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

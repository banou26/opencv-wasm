import type { Bundle, Lease } from './types'

type Entry<T> = { bundle: Bundle<T>; pins: number }

/**
 * The cache owns each bundle. Evaluators pin inputs until their consumer finishes.
 * Eviction destroys only unpinned entries; callers own temporary results until put.
 * A native handle never appears in two owning bundles, including forwarded outputs.
 */
export class ResultCache<T> {
  private entries = new Map<string, Entry<T>>()
  bytes = 0
  constructor(public budget: number) {}

  get size() { return this.entries.size }

  /** Borrow a result and update its LRU position. Release is idempotent. */
  acquire(key: string): Lease<Bundle<T>> | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key); this.entries.set(key, entry); entry.pins++
    let released = false
    return { value: entry.bundle, release: () => { if (!released) { released = true; entry.pins--; this.trim() } } }
  }

  /** Adopt a unique result while pinning it. Refused values remain caller-owned. */
  put(key: string, bundle: Bundle<T>): Lease<Bundle<T>> {
    if (this.entries.has(key)) throw new Error('Cache key already owns a result')
    if (bundle.bytes > this.budget) throw new Error('This result exceeds the cache budget')
    this.makeRoom(bundle.bytes)
    if (this.bytes + bundle.bytes > this.budget) throw new Error('The active graph exceeds the cache budget. Use a smaller clip or increase the budget.')
    this.entries.set(key, { bundle, pins: 0 }); this.bytes += bundle.bytes
    const lease = this.acquire(key)
    if (!lease) throw new Error('New cache entry is missing')
    return lease
  }

  private makeRoom(extra: number) {
    for (const [key, entry] of this.entries) {
      if (this.bytes + extra <= this.budget) break
      if (!entry.pins) { this.entries.delete(key); this.bytes -= entry.bundle.bytes; entry.bundle.dispose() }
    }
  }

  /** Apply a changed budget without destroying borrowed values. */
  trim() { this.makeRoom(0) }

  /** Empty an idle cache; outstanding leases are a caller lifetime error. */
  clear() {
    if ([...this.entries.values()].some(e => e.pins)) throw new Error('Cannot clear borrowed cache entries')
    for (const e of this.entries.values()) e.bundle.dispose()
    this.entries.clear(); this.bytes = 0
  }
}

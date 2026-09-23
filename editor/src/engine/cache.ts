import type { Bundle, Lease } from './types'

type Entry<T> = { bundle: Bundle<T>; pins: number; exclusive: number }

/**
 * The cache owns each bundle. Evaluators pin inputs until their consumer finishes.
 * Eviction destroys only unpinned entries; callers own temporary results until put.
 * A native handle never appears in two owning bundles, including forwarded outputs.
 */
export class ResultCache<T> {
  private entries = new Map<string, Entry<T>>()
  private shared = new Map<object, { bytes: number; references: number }>()
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
    let sharedBytes = 0
    for (const [identity, bytes] of bundle.shared ?? []) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid shared cache allocation')
      const existing = this.shared.get(identity)
      if (existing && existing.bytes !== bytes) throw new Error('A shared cache allocation changed size')
      sharedBytes += bytes
    }
    if (!Number.isSafeInteger(bundle.bytes) || bundle.bytes < sharedBytes) throw new Error('Invalid cache result size')
    if (bundle.bytes > this.budget) throw new Error('This result exceeds the cache budget')
    const entry = { bundle, pins: 0, exclusive: bundle.bytes - sharedBytes }
    // Reserve incoming references before eviction: its predecessor may own the same arrays.
    this.bytes += entry.exclusive
    for (const [identity, bytes] of bundle.shared ?? []) {
      const existing = this.shared.get(identity)
      if (existing) existing.references++
      else { this.shared.set(identity, { bytes, references: 1 }); this.bytes += bytes }
    }
    try {
      this.makeRoom()
      if (this.bytes > this.budget) throw new Error('The active graph exceeds the cache budget. Use a smaller clip or increase the budget.')
    } catch (error) {
      this.releaseStorage(entry)
      throw error
    }
    this.entries.set(key, entry)
    const lease = this.acquire(key)
    if (!lease) throw new Error('New cache entry is missing')
    return lease
  }

  private releaseStorage(entry: Entry<T>) {
    this.bytes -= entry.exclusive
    for (const identity of entry.bundle.shared?.keys() ?? []) {
      const resource = this.shared.get(identity)!
      if (--resource.references === 0) { this.shared.delete(identity); this.bytes -= resource.bytes }
    }
  }

  private makeRoom() {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.budget) break
      if (!entry.pins) { this.entries.delete(key); this.releaseStorage(entry); entry.bundle.dispose() }
    }
  }

  /** Apply a changed budget without destroying borrowed values. */
  trim() { this.makeRoom() }

  /** Empty an idle cache; outstanding leases are a caller lifetime error. */
  clear() {
    if ([...this.entries.values()].some(e => e.pins)) throw new Error('Cannot clear borrowed cache entries')
    for (const e of this.entries.values()) e.bundle.dispose()
    this.entries.clear(); this.shared.clear(); this.bytes = 0
  }
}

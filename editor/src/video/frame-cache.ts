/** Native decoded storage must be released explicitly when replaced or evicted. */
export type DecodedFrame = { codedWidth: number; codedHeight: number; allocationSize: () => number; close: () => void }

/**
 * Retain recently decoded presentation frames for seeking in either direction.
 * The byte and count limits exclude the decoder's own surfaces and caller clones.
 * Keep the requested frame during read-ahead, even if that one frame exceeds the budget.
 */
export class DecodedFrameCache<T extends DecodedFrame> {
  private entries = new Map<number, { frame: T; bytes: number }>()
  private used = 0
  constructor(private budget = 128 * 1024 ** 2, private limit = 256) {}
  get bytes() { return this.used }
  get size() { return this.entries.size }
  has(rank: number) { return this.entries.has(rank) }
  /** Borrow a retained frame and mark it recently used; clone before transferring it. */
  get(rank: number): T | undefined {
    const entry = this.entries.get(rank)
    if (!entry) return
    this.entries.delete(rank); this.entries.set(rank, entry)
    return entry.frame
  }
  /** Take ownership of a decoded frame, releasing the least recently used entries. */
  set(rank: number, frame: T, requested: number) {
    this.remove(rank)
    let bytes: number
    try { bytes = frame.allocationSize() }
    catch { bytes = frame.codedWidth * frame.codedHeight * 4 }
    this.entries.set(rank, { frame, bytes }); this.used += bytes
    while (this.used > this.budget || this.entries.size > this.limit) {
      const victim = [...this.entries.keys()].find(key => key !== requested)
      if (victim === undefined) break
      this.remove(victim)
    }
  }
  private remove(rank: number) {
    const entry = this.entries.get(rank)
    if (!entry) return
    entry.frame.close(); this.used -= entry.bytes; this.entries.delete(rank)
  }
  /** Release every retained native frame on source disposal or replacement. */
  clear() { for (const rank of this.entries.keys()) this.remove(rank) }
}

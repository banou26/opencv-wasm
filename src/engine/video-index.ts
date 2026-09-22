/** Decode-order sample metadata, independent of container and browser APIs. */
export type IndexedSample = { number: number; cts: number; is_sync: boolean; duration: number }
/** Presentation rank is the frame identity, including reordered B pictures. */
export const presentationOrder = <T extends IndexedSample>(samples: T[]): T[] => [...samples].sort((a, b) => a.cts - b.cts || a.number - b.number)
/** A sync picture must precede the target in both decode and presentation order. */
export const startSample = <T extends IndexedSample>(samples: T[], target: T): number => {
  let result = -1
  for (let i = 0; i <= target.number; i++) {
    const s = samples[i]
    if (s?.is_sync && s.cts <= target.cts) result = i
  }
  if (result < 0) throw new Error('No decodable sync sample precedes this frame')
  return result
}
/** Derive a display rate from composition timestamps, snapping remux jitter to common rates. */
export const frameRate = (timestamps: number[], timescale: number): number => {
  const differences = timestamps.slice(1).map((t, i) => t - (timestamps[i] ?? t)).filter(d => d > 0).sort((a, b) => a - b)
  const median = differences[Math.floor(differences.length / 2)]
  if (!median) return 24
  const measured = timescale / median
  const standards = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]
  const nearest = standards.reduce((a, b) => Math.abs(a - measured) < Math.abs(b - measured) ? a : b)
  return Math.abs(nearest - measured) / measured < 0.012 ? nearest : measured
}

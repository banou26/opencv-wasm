/** A rational source rate keeps 23.976-to-60 sampling on its intended frame boundaries. */
export const rationalRate = (fps: number): { numerator: number; denominator: number } => {
  for (const [numerator, denominator] of [[24000, 1001], [30000, 1001], [60000, 1001], [24, 1], [25, 1], [30, 1], [50, 1], [60, 1]]) {
    if (numerator !== undefined && denominator !== undefined && Math.abs(fps - numerator / denominator) < 1e-6) return { numerator, denominator }
  }
  return { numerator: Math.round(fps * 1_000_000), denominator: 1_000_000 }
}
/** Map an output frame index to its source integer frame and subframe fraction. */
export const outputTime = (index: number, start: number, sourceFps: number, outputFps: number): number => {
  const rate = rationalRate(sourceFps), numerator = index * rate.numerator, denominator = outputFps * rate.denominator
  return start + Math.floor(numerator / denominator) + numerator % denominator / denominator
}
/** Number of output frames spanning an inclusive source-frame range. */
export const outputCount = (start: number, end: number, sourceFps: number, outputFps: number): number => {
  const rate = rationalRate(sourceFps)
  return Math.ceil((end - start + 1) * outputFps * rate.denominator / rate.numerator)
}

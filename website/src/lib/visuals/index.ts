import type { Algorithm } from '../../data/algorithms'
import { pixelVisual } from './pixels'
import { geometryVisual } from './geometry'
import { systemVisual } from './systems'
import type { Visual } from './primitives'

/** Build an authored teaching example. Missing coverage is a build error, never a generic placeholder. */
export function algorithmVisual(algorithm: Algorithm): Visual {
  const result = pixelVisual(algorithm) ?? geometryVisual(algorithm) ?? systemVisual(algorithm)
  if (!result) throw new Error(`No visual example for ${algorithm.id}`)
  return result
}

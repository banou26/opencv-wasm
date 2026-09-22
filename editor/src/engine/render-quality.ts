/** H.264 compression presets; all preserve the graph output's original dimensions. */
export type RenderQuality = 'compact' | 'high' | 'maximum'

/** More bits retain fine lines and textured motion; the browser treats this as a target. */
export const renderBitrate = (width: number, height: number, fps: number, quality: RenderQuality) => {
  const settings = { compact: [2_000_000, 0.12], high: [8_000_000, 0.4], maximum: [16_000_000, 0.8] } as const
  const [minimum, perPixel] = settings[quality]
  // OpenH264 fails on small changing color fields when its target is excessive
  // (192 × 128 frame differences at 8 Mbit/s). Bound tiny-image targets to six
  // bits per pixel per frame; ordinary video budgets remain unchanged.
  const pixels = width * height, target = Math.max(minimum, pixels * fps * perPixel)
  return Math.round(Math.min(target, Math.max(64_000, pixels * fps * 6)))
}

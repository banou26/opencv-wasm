/** H.264 compression presets; all preserve the graph output's original dimensions. */
export type RenderQuality = 'compact' | 'high' | 'maximum'

/** More bits retain fine lines and textured motion; the browser treats this as a target. */
export const renderBitrate = (width: number, height: number, fps: number, quality: RenderQuality) => {
  const settings = { compact: [2_000_000, 0.12], high: [8_000_000, 0.4], maximum: [16_000_000, 0.8] } as const
  const [minimum, perPixel] = settings[quality]
  return Math.round(Math.max(minimum, width * height * fps * perPixel))
}

import type { PixelFrame } from './pixel-frame.ts';
export type MatteOptions = {
    /** Silhouette pixels this close to the edge are unmixed; deeper ones keep alpha 1. */
    inner?: number;
    /** Pixels this far outside the silhouette may carry a fringe of the drawing. */
    outer?: number;
    /** The foreground color comes from the nearest silhouette pixel at least this deep. */
    depth?: number;
    /** Below this distance between foreground and plate colors (codes) alpha is not identifiable. */
    minimumContrast?: number;
};
/**
 * Straight-alpha layer pixels. Near the edge, `frame = alpha * color + (1 - alpha) * plate` is solved
 * for alpha along the foreground-to-plate color line, with the foreground color taken from the nearest
 * pixel `depth` inside the silhouette, then the color is unmixed. Where the plate is unknown or the two
 * colors are too close to tell apart, silhouette pixels keep alpha 1 and their source color. Compositing
 * the result over the plate reproduces the frame wherever the plate is known.
 */
export type LayerMatte = {
    width: number;
    height: number;
    alpha: Float32Array;
    color: Float32Array;
    unmixed: number;
};
export declare function matteLayer(pixels: PixelFrame, mask: Uint8Array, plate: {
    data: Float32Array;
    known: Uint8Array;
}, options?: MatteOptions): LayerMatte;

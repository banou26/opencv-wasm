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
    /**
     * Where the foreground color comes from: the nearest pixel `depth` inside ('nearest'), or, among the
     * silhouette's pixels at least `depth` inside and within `reach`, the one whose color line through the
     * plate passes closest to the pixel ('fitting'). On a drawing's outline the nearest deep pixel is its
     * fill, so 'nearest' unmixes the line's edge against the wrong color. 'fitting' takes `depth` 2 by
     * default: a 2 px line's pure ink lies 1.5 to 2 px in, and at 1 px the edge pixels pick themselves.
     */
    foreground?: 'nearest' | 'fitting';
    reach?: number;
};
/**
 * Straight-alpha layer pixels. Near the edge, `frame = alpha * color + (1 - alpha) * plate` is solved
 * for alpha along the foreground-to-plate color line, with the foreground color taken from a pixel
 * `depth` inside the silhouette (the nearest, or the best fitting nearby: `foreground`), then the color
 * is unmixed. Where the plate is unknown or the two
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

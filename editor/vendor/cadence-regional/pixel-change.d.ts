import { type PixelFrame, type Translation } from './pixel-frame.ts';
export declare const CHANGED = 1;
/** This frame is darker than its counterpart: ink is present here. */
export declare const INK_HERE = 2;
/** The counterpart is darker: ink is present in the other frame. */
export declare const INK_THERE = 4;
export declare const OBSERVED = 8;
/** Unchanged only under one of the other motions: the pixel belongs to another rigid layer. */
export declare const OTHER_LAYER = 16;
/** Changed because another rigid layer covers the pixel in the other frame, not redrawn. */
export declare const OCCLUDED = 32;
/** Changed, yet its structured 5x5 neighborhood reappears within 2 px: a line that boiled in place, not new content. */
export declare const NEAR = 64;
export type PairChangeOptions = {
    /** Half-pixel search that absorbs the source's own resampling of every edge. */
    reach?: number;
    noiseFactor?: number;
    minimumThreshold?: number;
    /** Extra tolerance per luma code of local gradient. */
    gradientSlope?: number;
    inkDelta?: number;
    /** Ink must also sit this far below its 7x7 mean in the frame that carries it: lines, not scenery. */
    lineDelta?: number;
    /** Changed pixels need this many changed pixels in their 3x3 neighborhood, themselves included. */
    minimumNeighbors?: number;
    /** Other rigid layers of the pair, such as a sliding background; a pixel any of them explains is unchanged. */
    otherMotions?: Translation[];
};
/**
 * Flags for every pixel of A. OBSERVED marks pixels whose counterpart and search stay inside B; the
 * rest are unknown, never unchanged. CHANGED means no value within `reach` pixels of the displaced
 * position brackets A, per channel, beyond the noise threshold.
 */
export type PairChange = {
    width: number;
    height: number;
    flags: Uint8Array;
    noise: number;
    changed: number;
    observed: number;
    /** Rounded luma of A, and of B at the camera-displaced position, for every pixel. */
    here: Uint8Array;
    there: Uint8Array;
};
/**
 * Test every pixel of A against B displaced by `d`. Await initOpenCV first. The interval test accepts any
 * value between the minimum and maximum of B sampled within `reach` pixels, so a different resampling
 * phase of the same drawing is explained while a redrawn line, moved by a pixel or more, is not.
 */
export declare function measurePairChange(a: PixelFrame, b: PixelFrame, d: Translation, options?: PairChangeOptions): PairChange;

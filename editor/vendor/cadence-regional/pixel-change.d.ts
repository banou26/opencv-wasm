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
    /**
     * Pixels of A on the antialiased rim of another rigid layer in either frame, where both layers mix. A
     * change there is occlusion. Without it the rim is guessed as two pixels around every pixel only
     * another motion explains, which also swallows the outline of a drawing standing in front of that layer.
     */
    rim?: Uint8Array;
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
 * Which motions explain each pixel of A: bit k is set where B displaced by `motions[k]` brackets A under
 * the interval test of `measurePairChange`. The noise threshold comes from flat pixels under whichever
 * motion matches each best, unless `noise` is given: over a long baseline slowly changing scenery would
 * read as noise, so frames that far apart should take it from neighboring frames.
 * `inside` has bit k where that motion's search stays inside B; outside it the motion explains nothing.
 * At most eight motions.
 */
export declare function explainingMotions(a: PixelFrame, b: PixelFrame, motions: Translation[], options?: Pick<PairChangeOptions, 'reach' | 'noiseFactor' | 'minimumThreshold' | 'gradientSlope'> & {
    noise?: number;
}): {
    bits: Uint8Array;
    inside: Uint8Array;
    noise: number;
};
/**
 * Test every pixel of A against B displaced by `d`. Await initOpenCV first. The interval test accepts any
 * value between the minimum and maximum of B sampled within `reach` pixels, so a different resampling
 * phase of the same drawing is explained while a redrawn line, moved by a pixel or more, is not.
 */
export declare function measurePairChange(a: PixelFrame, b: PixelFrame, d: Translation, options?: PairChangeOptions): PairChange;

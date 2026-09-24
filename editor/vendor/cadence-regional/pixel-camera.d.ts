import type { Translation } from './pixel-frame.ts';
/** Robust fit of one translation; residual is the robust luma scale after alignment, in 8-bit codes. */
export type TranslationFit = Translation & {
    residual: number;
    samples: number;
    iterations: number;
};
/** Phase correlation on a reduced copy. It reports the strongest single motion, which need not be the camera. */
export declare function coarseTranslation(a: Float32Array, b: Float32Array, width: number, height: number, maxSide?: number): Translation & {
    response: number;
};
/**
 * Refine the translation from luma A to luma B, coarse to fine. Await initOpenCV first. The start
 * decides which motion is fitted when several layers move; pass the camera's own estimate.
 */
export declare function refineTranslation(a: Float32Array, b: Float32Array, width: number, height: number, start: Translation, options?: {
    maxIterations?: number;
    maxSamples?: number;
    coarseSide?: number;
}): TranslationFit;

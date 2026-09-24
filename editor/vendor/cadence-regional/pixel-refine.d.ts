import type { CameraPath } from './pixel-drawings.ts';
import type { PixelFrame } from './pixel-frame.ts';
import { type PixelFrameSource, type SceneSilhouettes, type StageProgress } from './pixel-layers.ts';
import { type LayerPlate } from './pixel-plate.ts';
export type CarveOptions = {
    /** Only pixels this close to the silhouette edge can be carved. */
    band?: number;
    /** Largest per-channel difference to the plate that still counts as background. */
    tolerance?: number;
    /** Extra tolerance per code of plate luma gradient, for the two resamplings of the same edge. */
    gradientSlope?: number;
    /** Plate pixels need this many observations to be trusted. */
    minimumCount?: number;
};
/**
 * Remove silhouette pixels the plate explains, from the outside in. A pixel within `band` of the edge
 * whose value matches a well-observed plate is background only when it connects to the exterior through
 * such pixels, so an interior fill that happens to match the scenery is never carved and the outline,
 * which does not match it, stops the carve.
 */
export declare function carveSilhouette(mask: Uint8Array, pixels: PixelFrame, plate: {
    data: Float32Array;
    known: Uint8Array;
}, options?: CarveOptions): {
    mask: Uint8Array;
    carved: number;
};
/** Carve every frame's silhouettes against a plate built from them; the plate should be rebuilt afterwards. */
export declare function refineSilhouettes(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, plate: LayerPlate, options?: CarveOptions & {
    minimumArea?: number;
    progress?: StageProgress;
}): Promise<SceneSilhouettes & {
    carved: number[];
}>;

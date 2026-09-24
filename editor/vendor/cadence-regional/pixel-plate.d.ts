import { type CameraPath, type WorldAtlas } from './pixel-drawings.ts';
import type { PixelFrame } from './pixel-frame.ts';
/** Running sums over world-atlas pixels. */
export type PlateStatistics = {
    atlas: WorldAtlas;
    sum: Float32Array;
    square: Float32Array;
    count: Uint16Array;
};
/**
 * Background in world coordinates: the trimmed mean of every observation outside the drawings. Count 0
 * means never observed. Artwork that never changes is part of it by construction.
 */
export type LayerPlate = {
    atlas: WorldAtlas;
    data: Float32Array;
    count: Uint16Array;
};
export declare function plateStatistics(atlas: WorldAtlas): PlateStatistics;
/** Add one frame outside `exclude` (grown by `margin` pixels). With `reference`, only samples near it count. */
export declare function addPlateSamples(statistics: PlateStatistics, camera: CameraPath, frame: number, pixels: PixelFrame, exclude?: Uint8Array, margin?: number, reference?: {
    mean: Float32Array;
    tolerance: Float32Array;
}): void;
/** Mean, plus a per-pixel tolerance for the trimmed pass: three spreads, never under `floor` codes. */
export declare function plateReference(statistics: PlateStatistics, floor?: number): {
    mean: Float32Array;
    tolerance: Float32Array;
};
export declare function finishPlate(statistics: PlateStatistics): LayerPlate;
/**
 * The plate seen by one frame, resampled at its sub-pixel camera position. `known` is 1 only where every
 * interpolation tap was observed.
 */
export declare function renderPlate(plate: LayerPlate, camera: CameraPath, frame: number): {
    data: Float32Array;
    known: Uint8Array;
};
/** Largest per-channel difference to the rendered plate; NaN where the plate is unknown. */
export declare function plateResidual(plate: LayerPlate, camera: CameraPath, frame: number, pixels: PixelFrame): Float32Array;

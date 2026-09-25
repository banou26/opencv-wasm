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
 * Per frame, a smooth additive correction in frame coordinates, per channel, on a grid of `cell` pixel
 * cells: the lighting of the shot changing while its paint holds still (a fade, a darkening sky).
 */
export type PlateDrift = {
    cell: number;
    columns: number;
    rows: number;
    frames: Float32Array[];
};
/**
 * Background in world coordinates: the trimmed mean of every observation outside the drawings. Count 0
 * means never observed. Artwork that never changes is part of it by construction. With `drift`, each
 * frame sees the plate plus that frame's correction.
 */
export type LayerPlate = {
    atlas: WorldAtlas;
    data: Float32Array;
    count: Uint16Array;
    drift?: PlateDrift;
};
export declare function plateStatistics(atlas: WorldAtlas): PlateStatistics;
/**
 * What a trimmed pass keeps: per atlas pixel either a mean color (`plateReference`), every channel within
 * `tolerance` of it, or a luma (`medianReference`), the sample's luma within `tolerance` of it. A negative
 * or NaN tolerance keeps nothing.
 */
export type PlateReference = {
    mean: Float32Array;
    tolerance: Float32Array;
} | {
    luma: Float32Array;
    tolerance: Float32Array;
};
/** Add one frame outside `exclude` (grown by `margin` pixels). With `reference`, only samples near it count. */
export declare function addPlateSamples(statistics: PlateStatistics, camera: CameraPath, frame: number, pixels: PixelFrame, exclude?: Uint8Array, margin?: number, reference?: PlateReference): void;
/** Mean, plus a per-pixel tolerance for the trimmed pass: three spreads, never under `floor` codes. */
export declare function plateReference(statistics: PlateStatistics, floor?: number): {
    mean: Float32Array;
    tolerance: Float32Array;
};
/**
 * Every usable sample's luma per atlas pixel, at most `capacity` of them (one per frame), for
 * `medianReference`.
 */
export type PlateLumaSamples = {
    atlas: WorldAtlas;
    capacity: number;
    count: Uint16Array;
    values: Uint8Array;
};
export declare function plateLumaSamples(atlas: WorldAtlas, capacity: number): PlateLumaSamples;
/** Add one frame's luma outside `exclude` (grown by `margin` pixels), as `addPlateSamples` would sample it. */
export declare function addLumaSamples(samples: PlateLumaSamples, camera: CameraPath, frame: number, pixels: PixelFrame, exclude?: Uint8Array, margin?: number): void;
/**
 * The median luma per atlas pixel, and a tolerance of three robust spreads (1.4826 median absolute
 * deviations), never under `floor` codes. It holds while up to half the samples show something else: on a
 * follow shot a drawing the silhouettes missed sweeps over the backdrop, and the mean `plateReference` starts
 * from moves toward it while its three spreads widen until they keep it.
 */
export declare function medianReference(samples: PlateLumaSamples, floor?: number): {
    luma: Float32Array;
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
/** Adds one frame's drift to BGR `data` on the frame's grid: bilinear between cell centers, clamped at the border. */
export declare function addDrift(data: Float32Array, width: number, height: number, drift: PlateDrift, frame: number): void;
/**
 * One frame's drift: per cell and channel the median of frame minus plate over known pixels outside
 * `exclude`, ignoring residuals beyond `limit` codes (drawings the exclusion missed). Cells with fewer
 * than `minimum` samples take the mean of their measured neighbors, spreading until every cell has one.
 */
export declare function measureDrift(rendered: {
    data: Float32Array;
    known: Uint8Array;
}, pixels: PixelFrame, exclude: Uint8Array | undefined, cell?: number, limit?: number, minimum?: number): {
    columns: number;
    rows: number;
    grid: Float32Array;
};
/** Largest per-channel difference to the rendered plate; NaN where the plate is unknown. */
export declare function plateResidual(plate: LayerPlate, camera: CameraPath, frame: number, pixels: PixelFrame): Float32Array;

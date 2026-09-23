import type { RegionalObservation, RegionalTracks } from './regions.ts';
export type MotionHistoryOptions = {
    /** Maximum simultaneous disagreement in analysis pixels per frame pair. */
    tolerance?: number;
    minimumOverlap?: number;
    /** Local preference among motion-compatible proposals; default .25, zero restores motion-only ordering. */
    proximityWeight?: number;
};
export type MotionHistoryComparison = {
    a: number;
    b: number;
    overlap: number;
    error: number | null;
    maximum: number | null;
    status: 'compatible' | 'different' | 'insufficient-overlap';
    /** Robust symmetric support separation in cell widths; null when unused. */
    distanceCells: number | null;
    score: number | null;
};
export type MotionHistoryGroups = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    options: Required<MotionHistoryOptions>;
    /** Family IDs are the smallest original region ID, not a new ownership claim. */
    families: {
        id: number;
        regionIds: number[];
    }[];
    frames: {
        frame: number;
        observations: (RegionalObservation & {
            regionIds: number[];
        })[];
    }[];
    comparisons: MotionHistoryComparison[];
};
/**
 * Join spatially disconnected regions using simultaneous whole-scene velocities.
 * Every pair of constituent histories must agree with enough shared evidence;
 * a compatible bridge cannot erase a contradiction or an unobserved interval.
 * Spatial proximity orders eligible proposals; it never establishes compatibility.
 * Matching motion does not establish shared artwork or fill unsupported cells.
 */
export declare function groupMotionHistories(tracks: RegionalTracks, options?: MotionHistoryOptions): MotionHistoryGroups;

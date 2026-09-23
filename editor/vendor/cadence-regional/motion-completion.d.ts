import type { MotionHistoryGroups } from './motion-groups.ts';
import { type RegionalSupportSequence } from './regions.ts';
export type MotionCompletionOptions = {
    /** Original-seed reach and local hull radius, in fine-grid cells. Zero disables holes. */
    maxHoleDistance?: number;
    /** Maximum path distance from original seeds and distance to the frame edge. Zero disables borders. */
    maxBorderDistance?: number;
    /** Competing families and contradictory motion must be farther by this many cells. */
    competitorClearance?: number;
};
export type MotionCompletionFrame = {
    frame: number;
    observations: {
        id: number;
        measuredCells: number[];
        motionCells: number[];
        holeCells: number[];
        borderCells: number[];
    }[];
    counts: {
        measured: number;
        motion: number;
        holes: number;
        border: number;
        blocked: number;
        unknown: number;
    };
};
export type MotionCompletion = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    columns: number;
    rows: number;
    options: Required<MotionCompletionOptions>;
    frames: MotionCompletionFrame[];
};
/**
 * Independent per-pair proposals with whole-scene contradiction checks. The generator
 * lets browser workers yield between pairs without throwing away temporal evidence.
 * Ownership is inferred; source flow, families and drawing timing remain untouched.
 */
export declare function completeMotionSupportFrames(sequence: RegionalSupportSequence, families: MotionHistoryGroups, options?: MotionCompletionOptions): Generator<MotionCompletionFrame>;
/** Source-preserving motion associations and bounded geometry; not certified silhouettes. */
export declare function completeMotionSupport(sequence: RegionalSupportSequence, families: MotionHistoryGroups, options?: MotionCompletionOptions): MotionCompletion;

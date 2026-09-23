import type { MotionHistoryGroups } from './motion-groups.ts';
import { type RegionalSupportSequence } from './regions.ts';
export type MotionCompletionOptions = {
    /** Original-seed reach and local hull radius, in fine-grid cells. Zero disables holes. */
    maxHoleDistance?: number;
    /** Border band/reach from original seeds, then frozen temporal anchors. Zero disables borders. */
    maxBorderDistance?: number;
    /** Competing families and contradictory motion must be farther by this many cells. */
    competitorClearance?: number;
    /** Fill enclosed empty cells and final coherent single-cell gaps, without iterative growth. */
    fillIsolated?: boolean;
    /** Resolve compatible rejected motion and empty runs from frozen scene-wide support. */
    bridgeTemporal?: boolean;
};
export type MotionCompletionFrame = {
    frame: number;
    observations: {
        id: number;
        measuredCells: number[];
        motionCells: number[];
        holeCells: number[];
        borderCells: number[];
        isolatedCells: number[];
        temporalCells: number[];
        /** Subset of motion/isolated cells added after all donor maps froze; never donor evidence. */
        enclosedCells?: number[];
        /** Subset of border cells closed from final frozen support; never temporal donors. */
        terminalBorderCells?: number[];
    }[];
    counts: {
        measured: number;
        motion: number;
        holes: number;
        border: number;
        isolated: number;
        temporal: number;
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
 * Spatial proposals followed by frozen-donor temporal repair. Null yields are
 * preprocessing checkpoints; non-null yields are final frames, never partial results.
 * Ownership is inferred; source flow, families and drawing timing remain untouched.
 */
export declare function completeMotionSupportSteps(sequence: RegionalSupportSequence, families: MotionHistoryGroups, options?: MotionCompletionOptions): Generator<MotionCompletionFrame | null>;
/** Final frames only. Browser workers should consume Steps for preprocessing cancellation. */
export declare function completeMotionSupportFrames(sequence: RegionalSupportSequence, families: MotionHistoryGroups, options?: MotionCompletionOptions): Generator<MotionCompletionFrame>;
/** Source-preserving motion associations and bounded geometry; not certified silhouettes. */
export declare function completeMotionSupport(sequence: RegionalSupportSequence, families: MotionHistoryGroups, options?: MotionCompletionOptions): MotionCompletion;

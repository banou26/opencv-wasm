import type { MotionHistoryGroups } from './motion-groups.ts';
import { type RegionalSupportSequence } from './regions.ts';
export type MotionCompletionOptions = {
    /** Maximum distance to each original bracketing seed, in fine-grid cells. Zero disables holes. */
    maxHoleDistance?: number;
    /** Maximum distance to both an original seed and the frame edge. Zero disables borders. */
    maxBorderDistance?: number;
    /** Other-family and unassigned evidence must be farther than the seed by this many cells. */
    competitorClearance?: number;
};
export type MotionCompletionFrame = {
    frame: number;
    observations: {
        id: number;
        measuredCells: number[];
        holeCells: number[];
        borderCells: number[];
    }[];
    counts: {
        measured: number;
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
 * Bounded geometric support proposals, NOT new flow measurements or layer silhouettes.
 * Original family labels and all unassigned measured cells remain immutable. A hole
 * needs agreeing opposite seeds; an edge extension needs a seed opposite the real
 * frame boundary. Competing evidence vetoes both. Inferred cells never seed growth.
 * A wholly unobserved object cannot be excluded by geometry alone.
 */
export declare function completeMotionSupport(sequence: RegionalSupportSequence, families: MotionHistoryGroups, options?: MotionCompletionOptions): MotionCompletion;

import type { MotionGrid } from './regional-types.ts';
export type VectorModeOptions = {
    tolerance?: number;
    minimumCells?: number;
};
/**
 * Consolidate supported velocity modes without spatial grouping or hole filling.
 * Tolerance is a radius around the mode, not a pairwise velocity-diameter bound.
 * Raw input and weak measurements remain intact; output vectors are proposals.
 */
export declare function poolVectorModes(grid: MotionGrid, options?: VectorModeOptions): MotionGrid;

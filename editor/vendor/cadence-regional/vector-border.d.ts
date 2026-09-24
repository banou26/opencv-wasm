import type { MotionGrid } from './regional-types.ts';
import type { AnalysisFrame } from './types.ts';
export type VectorBorderScore = {
    compared: number;
    candidateVisible: number;
    candidate: {
        mae: number;
        mse: number;
    };
    reference: {
        mae: number;
        mse: number;
    };
};
export type VectorBorderCorrection = {
    cell: number;
    motionId: number;
    original: {
        dx: number;
        dy: number;
    };
    replacement: {
        dx: number;
        dy: number;
    };
    footprint: VectorBorderScore;
    context: VectorBorderScore;
    /** Observed-only low-pass evidence, used only after raw relative/context gates pass. */
    filterRadius?: 2;
    rawFootprint?: VectorBorderScore;
    rawContext?: VectorBorderScore;
};
/**
 * Check border-only components against a well-supported interior motion.
 * Only genuinely observed pixels may overturn a candidate. Raw flow, the input
 * grid and coverage/confidence stay intact; explicit corrections describe the
 * derived grid. This is motion refinement, not a layer-ownership measurement.
 */
export declare function refineVectorBorders(a: AnalysisFrame, b: AnalysisFrame, grid: MotionGrid): {
    grid: MotionGrid;
    corrections: VectorBorderCorrection[];
};

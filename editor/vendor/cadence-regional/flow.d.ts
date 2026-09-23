import type { AnalysisFrame } from './types.ts';
import type { DenseMotion, MotionGrid } from './regional-types.ts';
export type FlowOptions = {
    window?: number;
    levels?: number;
    roundTrip?: number;
    textureFraction?: number;
};
/**
 * One A-to-B measurement field shared by every later grid scale. Await
 * initOpenCV first. Raw vectors remain available even when valid is zero;
 * an unsupported vector is never evidence of a stationary layer.
 */
export declare function estimateDenseMotion(a: AnalysisFrame, b: AnalysisFrame, options?: FlowOptions): DenseMotion;
/** Pool, never re-estimate, the same accepted field. Mixed cells are explicitly incoherent. */
export declare function poolMotion(flow: DenseMotion, cellSize: number): MotionGrid;

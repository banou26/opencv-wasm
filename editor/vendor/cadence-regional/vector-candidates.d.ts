import type { FlowOptions } from './flow.ts';
import type { DenseMotion, MotionGrid } from './regional-types.ts';
import type { AnalysisFrame } from './types.ts';
/**
 * Regional motion vectors prefab proposals, not verified pixel ownership.
 * Float Rec601, sequential reflected X/Y alignment, and relative texture gates
 * follow the editor primitives. Unlike strict dense motion, grain and reflected
 * edge patches may pass. Await initOpenCV first; input pixels are never changed.
 * Parity starts at these 8-bit analysis pixels: upstream float editor resizing
 * can differ from a decoder or a resize already rounded to 8-bit BGR.
 */
export declare function estimateVectorCandidates(a: AnalysisFrame, b: AnalysisFrame, options?: FlowOptions): DenseMotion;
/** Median proposals retain mixed cells; coherent/spread remain diagnostics. */
export declare function poolVectorCandidates(flow: DenseMotion, cellSize: number): MotionGrid;

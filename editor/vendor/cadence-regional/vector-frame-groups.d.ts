import type { RegionalSupportSequence } from './regions.ts';
export type FrameVectorGroups = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    options: {
        tolerance: number;
        splitSubtleMotion: boolean;
        splitDistantRegions: boolean;
        proximityGap: number;
    };
    frames: {
        frame: number;
        /** Frame-local motion IDs, not persistent layer identities. Only missing vectors get -1. */
        labels: Int32Array;
        /** Measurement quality only: 0 missing, 1 mixed, 2 coherent. Never a membership gate. */
        confidence: Uint8Array;
        observations: {
            id: number;
            motionId: number;
            cells: number[];
            dx: number;
            dy: number;
            strongCells: number;
        }[];
    }[];
};
/**
 * Group each frame's measured (dx,dy) vectors without temporal identity gating.
 * Every candidate appears exactly once. Speed/direction may change freely
 * between frames, including easing and reversal. No missing cells are filled.
 */
export declare function groupFrameVectors(sequence: RegionalSupportSequence, options?: {
    tolerance?: number;
    splitSubtleMotion?: boolean;
    splitDistantRegions?: boolean;
    proximityGap?: number;
}): FrameVectorGroups;

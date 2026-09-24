import type { RegionalSupportSequence } from './regions.ts';
export type VectorGroupingOptions = {
    tolerance?: number;
    minimumOverlap?: number;
    modeRadius?: number;
    minimumModeCells?: number;
};
export type VectorCandidateSample = {
    frame: number;
    cell: number;
    dx: number;
    dy: number;
    coherent: boolean;
    /** Consensus is a velocity-mode proposal; raw measurements above are unchanged. */
    consensus: boolean;
    modelDx: number;
    modelDy: number;
};
export type VectorCandidateTrack = {
    id: number;
    group: number | null;
    samples: VectorCandidateSample[];
};
export type VectorLayerFrame = {
    frame: number;
    labels: Int32Array;
    /** 0 missing, 1 tentative assignment, 2 coherent multi-pair assignment, 3 ambiguous, 4 unassigned. */
    confidence: Uint8Array;
    observations: {
        id: number;
        cells: number[];
        dx: number;
        dy: number;
        strongCells: number;
    }[];
};
export type VectorLayerGroups = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    options: {
        tolerance: number;
        minimumOverlap: number;
        modeRadius: number;
        minimumModeCells: number;
    };
    groups: {
        id: number;
        trackCount: number;
        observedPairs: number;
    }[];
    frames: VectorLayerFrame[];
    tracks: VectorCandidateTrack[];
};
/**
 * Direct whole-scene velocity proposals. There is no spatial-region grouping or
 * support completion. Coherent multi-pair trajectories build bounded velocity
 * profiles; short/mixed histories can attach, but cannot change those profiles.
 * Identical motion still cannot distinguish different co-moving drawings.
 */
export declare function groupVectorCandidates(sequence: RegionalSupportSequence, options?: VectorGroupingOptions): VectorLayerGroups;

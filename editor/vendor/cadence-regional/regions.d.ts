import { type FlowOptions } from './flow.ts';
import { summarizeTiming } from './timing.ts';
import type { AnalysisFrame } from './types.ts';
import type { DenseMotion, DrawingEvent, MotionGrid } from './regional-types.ts';
export declare const REGIONAL_SCALES: readonly [96, 48, 24, 12, 8];
export type RegionalPair = {
    frame: number;
    flow: DenseMotion;
    grids: MotionGrid[];
};
export type RegionalMotionSequence = {
    width: number;
    height: number;
    frameCount: number;
    pairs: RegionalPair[];
};
/** Tracking and timing need pooled evidence and image geometry, not retained dense buffers. */
export type RegionalSupportPair = {
    frame: number;
    flow: Pick<DenseMotion, 'width' | 'height'>;
    grids: MotionGrid[];
};
export type RegionalSupportSequence = Omit<RegionalMotionSequence, 'pairs'> & {
    pairs: RegionalSupportPair[];
};
export type TrackSample = {
    frame: number;
    cell: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
};
export type RegionalTrack = {
    id: number;
    group: number | null;
    samples: TrackSample[];
};
export type RegionalObservation = {
    id: number;
    cells: number[];
    dx: number;
    dy: number;
    spread: number;
};
export type RegionalTracks = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    tracks: RegionalTrack[];
    groups: {
        id: number;
        trackIds: number[];
    }[];
    frames: {
        frame: number;
        observations: RegionalObservation[];
    }[];
};
export type RegionalAnalysis = {
    frames: {
        frame: number;
        observations: (RegionalObservation & {
            event: DrawingEvent;
        })[];
    }[];
    groups: {
        id: number;
        timing: ReturnType<typeof summarizeTiming>;
    }[];
};
export type RegionalOptions = FlowOptions & {
    /** Empty scales exposes just dense motion for separately inspectable pooling. */
    cellSizes?: readonly number[];
    onProgress?: (completed: number, total: number) => void;
};
/** Single pair entry point for browser workers that yield between measurements. */
export declare function analyzeMotionPair(a: AnalysisFrame, b: AnalysisFrame, frame: number, options?: RegionalOptions): RegionalPair;
/** Whole-shot forward fields. Analysis pixels only; never alters source artwork. */
export declare function analyzeMotionPairs(frames: AnalysisFrame[], options?: RegionalOptions): RegionalMotionSequence;
/** Alternative poolings share their flow measurements; scales are not independent votes. */
export declare function poolMotionSequence(sequence: RegionalMotionSequence, scales?: readonly number[]): RegionalMotionSequence;
/** Smallest spatial pooling is the support lattice, never a pixel-accurate silhouette. */
export declare function regionalFineGrid(pair: Pick<RegionalPair, 'grids'>): MotionGrid;
/**
 * Advect supported sites, then join spatial neighbors only when their overlapping
 * whole-shot motion histories agree. A shared held frame cannot merge identities.
 * Co-moving artwork is deliberately unresolved: motion alone cannot identify it.
 */
export declare function trackRegionalMotion(sequence: RegionalSupportSequence, options?: {
    tolerance?: number;
    minimumOverlap?: number;
    minimumCells?: number;
}): RegionalTracks;
export type RegionalTimingContext = {
    previous?: {
        pair: RegionalSupportPair;
        observations: RegionalObservation[];
    };
    groupIds?: number[];
};
/** Current flow validity cannot decide which appearance pixels are allowed to change. */
export declare function analyzeRegionalTimingFrame(a: AnalysisFrame, b: AnalysisFrame, pair: RegionalSupportPair, observations: RegionalObservation[], context?: RegionalTimingContext): RegionalAnalysis['frames'][number];
/** Finalize explicit pair events without inventing timing across missing evidence. */
export declare function finishRegionalTiming(frames: RegionalAnalysis['frames'], groupIds: number[]): RegionalAnalysis;
/** Compare group interiors under one robust translation, not the dense deformation. */
export declare function analyzeRegionalTiming(frames: AnalysisFrame[], sequence: RegionalSupportSequence, tracks: RegionalTracks, onProgress?: (completed: number, total: number) => void): RegionalAnalysis;

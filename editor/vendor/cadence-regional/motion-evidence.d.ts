import type { MotionHistoryGroups } from './motion-groups.ts';
import type { DrawingEvent } from './regional-types.ts';
import type { RegionalAnalysis, RegionalTracks } from './regions.ts';
export type MotionComparisonEvidence = {
    a: number;
    b: number;
    familyA: number;
    familyB: number;
    error: number;
    maximum: number;
    tolerance: number;
    samples: {
        frame: number;
        dxA: number;
        dyA: number;
        dxB: number;
        dyB: number;
        error: number;
        veto: boolean;
        eventA: DrawingEvent['status'] | null;
        eventB: DrawingEvent['status'] | null;
    }[];
};
/**
 * Read-only raw motion vetoes beside the source-appearance event reports.
 * A redraw can explain why flow disagrees; it does not prove shared placement.
 * Missing pairs remain absent, and event evidence never edits the motion verdict.
 */
export declare function motionComparisonEvidence(tracks: RegionalTracks, history: MotionHistoryGroups, timing?: RegionalAnalysis, page?: number): {
    pairCount: number;
    comparisons: MotionComparisonEvidence[];
};

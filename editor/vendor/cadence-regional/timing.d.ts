import type { AnalysisFrame } from './types.ts';
import type { DrawingEvent, TimingSupport } from './regional-types.ts';
export type TimingOptions = {
    noiseFloor?: number;
};
/** Requires initialized OpenCV. Masks describe geometric observation, never flow-error inliers. */
export declare function measureDrawingEvent(a: AnalysisFrame, b: AnalysisFrame, support: TimingSupport, motion: {
    dx: number;
    dy: number;
}, options?: TimingOptions): DrawingEvent;
/** Only holds bounded by two observed changes are complete; unknowns and gaps censor runs. */
export declare function summarizeTiming(events: {
    frame: number;
    event: DrawingEvent;
}[]): {
    changeFrames: number[];
    heldFrames: number[];
    unknownFrames: number[];
    completedHolds: {
        startFrame: number;
        endFrame: number;
        length: number;
    }[];
    holdLengthHistogram: Record<string, number>;
};

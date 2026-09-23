/** Forward displacement from image A to B, in analysis-image pixels. Invalid samples stay explicit. */
export type DenseMotion = {
    width: number;
    height: number;
    vectors: Float32Array;
    valid: Uint8Array;
    roundTrip: Float32Array;
    pan: {
        dx: number;
        dy: number;
        response: number;
        used: boolean;
    };
};
/** Robust motion summary of a spatial cell; coverage is not a probability of correctness. */
export type MotionCell = {
    x: number;
    y: number;
    width: number;
    height: number;
    dx: number | null;
    dy: number | null;
    accepted: number;
    coverage: number;
    spread: number | null;
    coherent: boolean;
};
/** Alternate spatial pooling of the same dense measurements, not independent flow estimates. */
export type MotionGrid = {
    cellSize: number;
    columns: number;
    rows: number;
    cells: MotionCell[];
};
/** Tracked support sites in frame A. Occluded or unobserved sites must not become change evidence. */
export type TimingSupport = {
    width: number;
    height: number;
    mask: Uint8Array;
    /** Optional known-observed support in B; never a mask of flow-error inliers. */
    targetMask?: Uint8Array;
};
/** Appearance evidence after a single fitted translation, never after a deforming dense warp. */
export type DrawingEvent = {
    status: 'held' | 'changed' | 'unknown';
    compared: number;
    changed: number;
    changedFraction: number | null;
    error: number | null;
    noise: number | null;
    reason: string;
};

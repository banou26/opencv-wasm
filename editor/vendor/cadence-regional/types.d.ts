/** Half-open rectangle [x, y, width, height] in pixels. */
export type Box = [number, number, number, number];
/** Unmodified source pixels, decoded BGR, interleaved unsigned 16-bit. */
export type SourceFrame = {
    width: number;
    height: number;
    data: Uint16Array;
};
/** Analysis-only BGR pixels; never used as exported artwork. */
export type AnalysisFrame = {
    width: number;
    height: number;
    data: Uint8Array;
};
/** Translation from this frame into the first frame's coordinates. */
export type FrameMotion = {
    x: number;
    y: number;
    inliers: number;
    tracked: number;
    error: number;
    accepted: boolean;
};
/** Evidence group in the analysis atlas; not a semantic-object assertion. */
export type LayerRegion = {
    id: number;
    box: Box;
    mask: Uint8Array;
    pixels: number;
};
/** Whole-shot consensus with explicit unsupported sites and per-frame residuals. */
export type SceneAnalysis = {
    width: number;
    height: number;
    origin: [number, number];
    background: Uint8Array;
    support: Uint8Array;
    donor: Int32Array;
    sampleCount: Uint16Array;
    residuals: Uint8Array[];
    regions: LayerRegion[];
    noise: number;
    threshold: number;
};

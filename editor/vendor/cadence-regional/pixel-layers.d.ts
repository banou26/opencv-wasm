import { type PairChangeOptions } from './pixel-change.ts';
import { type TranslationFit } from './pixel-camera.ts';
import { type CameraPath, type DrawingEvidence, type SilhouetteOptions } from './pixel-drawings.ts';
import { type PixelFrame, type Translation } from './pixel-frame.ts';
import { type LayerPlate } from './pixel-plate.ts';
import type { Box } from './types.ts';
/** Frames of one shot, decoded on demand at full resolution. */
export type PixelFrameSource = {
    count: number;
    width: number;
    height: number;
    frame: (index: number) => Promise<PixelFrame>;
};
/** Awaited between frames; throwing cancels the stage. */
export type StageProgress = (done: number, total: number) => void | Promise<void>;
export type MeasuredCamera = CameraPath & {
    fits: TranslationFit[];
    coarse: (Translation & {
        response: number;
    })[];
};
/** `start` overrides the phase-correlation estimate for a pair, e.g. with the dominant motion group. */
export declare function measureCameraPath(source: PixelFrameSource, options?: {
    start?: (pair: number) => Translation | undefined;
    progress?: StageProgress;
}): Promise<MeasuredCamera>;
export type PairSummary = {
    forward: number;
    backward: number;
    noise: number;
    evidence: number;
};
export type MeasuredEvidence = DrawingEvidence & {
    summaries: PairSummary[];
    options: PairChangeOptions;
};
export declare function measureDrawingEvidence(source: PixelFrameSource, camera: CameraPath, options?: PairChangeOptions & {
    dilation?: number;
    inkDilation?: number;
    progress?: StageProgress;
}): Promise<MeasuredEvidence>;
/** One bit per pixel, row-major, most significant bit first. */
export declare const packMask: (mask: Uint8Array) => Uint8Array;
export declare const unpackMask: (packed: Uint8Array, length: number) => Uint8Array;
export type SceneSilhouettes = {
    width: number;
    height: number;
    options: SilhouetteOptions;
    frames: {
        packed: Uint8Array;
        area: number;
        components: {
            area: number;
            box: Box;
        }[];
    }[];
};
export declare function sceneSilhouettes(evidence: DrawingEvidence, options?: SilhouetteOptions & {
    progress?: StageProgress;
}): Promise<SceneSilhouettes>;
/** Two passes: a plain mean outside the drawings, then a mean of the samples near it. */
export declare function buildLayerPlate(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, options?: {
    margin?: number;
    floor?: number;
    progress?: StageProgress;
}): Promise<LayerPlate>;

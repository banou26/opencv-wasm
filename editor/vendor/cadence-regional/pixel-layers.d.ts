import { type PairChangeOptions } from './pixel-change.ts';
import { type CandidateMotion, type TranslationFit } from './pixel-camera.ts';
import { type CameraPath, type DrawingEvidence, type SilhouetteOptions } from './pixel-drawings.ts';
import { type PixelFrame, type Translation } from './pixel-frame.ts';
import { type RigidLayer } from './pixel-rigid.ts';
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
/** `motions[p]` lists every rigid motion found for pair p, the camera first. */
export type MeasuredCamera = CameraPath & {
    fits: TranslationFit[];
    coarse: (Translation & {
        response: number;
    })[];
    motions: CandidateMotion[][];
};
export type MotionTrack = {
    support: number;
    members: (CandidateMotion | undefined)[];
};
/**
 * Candidate motions linked across pairs: each continues the track whose latest candidate, at most
 * `maxGap` pairs back, is nearest within `continuity` pixels. A static layer drops out on redraw pairs,
 * where the redrawn drawings break its blocks, and must still be one track.
 */
export declare function motionTracks(found: CandidateMotion[][], continuity?: number, maxGap?: number): MotionTrack[];
/** The track with the most block support; `motionTracks` then `referenceTrack` decide the camera when several persist. */
export declare function cameraTrack(found: CandidateMotion[][], continuity?: number): (CandidateMotion | undefined)[];
/** Steps of a track for every pair; a missing pair takes the candidate nearest the track's last step, else no motion. */
export declare function trackSteps(track: MotionTrack, found: CandidateMotion[][]): Translation[];
/**
 * Among persistent tracks, the reference is the one in whose coordinates the redraws stay put: pixels no
 * candidate explains, accumulated over the shot in each track's own world coordinates, cover the least
 * area. A static character redrawn in place smears by the slide speed per frame in a sliding layer's
 * coordinates. Runs at `scale` of the frame size; ties within 5% go to block support.
 */
export declare function referenceTrack(source: PixelFrameSource, found: CandidateMotion[][], tracks: MotionTrack[], scale?: number): Promise<MotionTrack>;
/**
 * Candidate motions are linked across pairs into tracks, and the camera is the reference track: the one
 * in whose coordinates the redraws hold still (see `referenceTrack`). A single dominant motion is simply
 * that motion. Pairs where the reference has no candidate take the one nearest its last step. `start`
 * overrides the camera for a pair.
 */
export declare function measureCameraPath(source: PixelFrameSource, options?: {
    start?: (pair: number) => Translation | undefined;
    continuity?: number;
    progress?: StageProgress;
}): Promise<MeasuredCamera>;
export type PairSummary = {
    forward: number;
    backward: number;
    noise: number;
    evidence: number;
};
/**
 * `others[p]` packs, per pixel of frame p, whether only a non-camera motion explains it against frame
 * p + 1; `othersBackward[p]` the same for frame p + 1 against frame p. Those pixels belong to another
 * rigid layer and stay out of the camera plate.
 */
export type MeasuredEvidence = DrawingEvidence & {
    summaries: PairSummary[];
    options: PairChangeOptions;
    others: Uint8Array[];
    othersBackward: Uint8Array[];
};
export declare function measureDrawingEvidence(source: PixelFrameSource, camera: CameraPath & {
    motions?: CandidateMotion[][];
}, options?: PairChangeOptions & {
    dilation?: number;
    inkDilation?: number;
    progress?: StageProgress;
    rigid?: RigidLayer[];
    rimWidth?: number;
}): Promise<MeasuredEvidence>;
/**
 * Mark every change event whose value before or after it is the pixel's scenery: its median luma over the
 * whole shot, within `tolerance` codes, from at least `minimumSamples` observations. A drawing passing
 * over a pixel is a minority of its history unless the drawing stood there, and standing drawings boil in
 * place, which the silhouette stage checks first.
 */
export declare function annotateScenery<E extends DrawingEvidence>(source: PixelFrameSource, evidence: E, options?: {
    tolerance?: number;
    minimumSamples?: number;
    progress?: StageProgress;
}): Promise<E>;
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
/**
 * Two passes: a plain mean outside the drawings and other rigid layers, then a mean of the samples near
 * it. Then, unless `drift` is 0, each frame's drift on cells of that many pixels (see `PlateDrift`). `covers` gives, per frame, the pixels each rigid layer paints or leaves undecided (`renderCover` with
 * `undecided`), which show no camera scenery the plate can trust.
 */
export declare function buildLayerPlate(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, options?: {
    margin?: number;
    floor?: number;
    progress?: StageProgress;
    evidence?: Pick<MeasuredEvidence, 'others' | 'othersBackward'>;
    covers?: (frame: number) => Uint8Array[];
    drift?: number;
}): Promise<LayerPlate>;

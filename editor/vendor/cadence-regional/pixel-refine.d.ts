import { type CameraPath, type DrawingEvidence } from './pixel-drawings.ts';
import { type LayerFrames } from './pixel-frames.ts';
import { type PixelFrame } from './pixel-frame.ts';
import { type MeasuredCamera, type MeasuredEvidence, type PixelFrameSource, type SceneSilhouettes, type StageProgress } from './pixel-layers.ts';
import { type LayerPlate } from './pixel-plate.ts';
import { type FramePool } from './pixel-share.ts';
import { type RigidLayer } from './pixel-rigid.ts';
export type CarveOptions = {
    /** Only pixels this close to the silhouette edge can be carved. */
    band?: number;
    /** Largest per-channel difference to the plate that still counts as background. */
    tolerance?: number;
    /** Extra tolerance per code of plate luma gradient, for the two resamplings of the same edge. */
    gradientSlope?: number;
    /** Plate pixels need this many observations to be trusted. */
    minimumCount?: number;
    /** Pixels this far below their 7x7 closing are line art and stop the carve. */
    lineDelta?: number;
};
/**
 * Remove silhouette pixels the plate explains, from the outside in. A pixel within `band` of the edge
 * whose value matches a well-observed plate is background only when it connects to the exterior through
 * such pixels, so an interior fill that happens to match the scenery is never carved and the outline,
 * which does not match it, stops the carve. Pixels in `deep` can be carved at any depth.
 */
export declare function carveSilhouette(mask: Uint8Array, pixels: PixelFrame, plate: {
    data: Float32Array;
    known: Uint8Array;
}, options?: CarveOptions, fallback?: {
    data: Float32Array;
    known: Uint8Array;
}, deep?: Uint8Array): {
    mask: Uint8Array;
    carved: number;
};
export type GrowOptions = {
    /** Growth stays within this many pixels of the silhouette it starts from. */
    band?: number;
    /** ...and inside the silhouette's closing by this radius: its bays and gaps, never out past its outline. */
    bay?: number;
    /** A pixel differing from the scene by more than this (per channel, plus a gradient allowance) is not scenery. */
    tolerance?: number;
    gradientSlope?: number;
};
/**
 * Add to a silhouette the pixels next to it that the scene cannot explain: a part of a drawing that never
 * changed carries no ink, and the plate behind it, seen as that part in some frames and as scenery in
 * others, matches neither. Growth floods from the silhouette's edge through such pixels, within `band`
 * of it and inside its concavities (its closing by `bay`).
 */
/**
 * A binary mask closed by a disc of `radius` pixels (and a half, which is closest to OpenCV's ellipse):
 * dilated where the exact distance to the mask is within it, then eroded where the distance to what the
 * dilation left out exceeds it; outside the frame counts as neither mask nor gap. Linear in the frame,
 * where a 97 x 97 structuring element visited seven thousand cells a pixel (15 s over 30 frames of
 * market-pan, 2026-09-26). OpenCV's ellipse rounds each row on its own, so it is no disc and the two
 * differ by a pixel along some edges.
 */
export declare function closeByDisc(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array;
export declare function growSilhouette(mask: Uint8Array, pixels: PixelFrame, scene: {
    data: Float32Array;
    known: Uint8Array;
}, options?: GrowOptions): {
    mask: Uint8Array;
    grown: number;
};
/** Grow every frame's silhouettes into what the scene cannot explain next to them (see `growSilhouette`), then fill enclosed holes; with `frames`, only those from its first up to its second, and with `pool` on its threads. */
export declare function growSilhouettes(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, plate: LayerPlate, options?: GrowOptions & {
    layers?: RigidLayer[];
    progress?: StageProgress;
    frames?: [number, number];
    pool?: FramePool;
}): Promise<SceneSilhouettes & {
    grown: number[];
}>;
/**
 * Median of every observation, silhouettes ignored, of the world pixels that fall in some frame's edge
 * band. Where a drawing's outline jitters over background, the background is what most frames show, so
 * the median recovers it where the plate, which excludes every silhouette, has nothing. A pixel a drawing
 * covers most of the time gets the drawing; the carve's line-art stop protects that case.
 */
export declare function bandMedianPlate(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, band?: number, progress?: StageProgress): Promise<LayerPlate>;
export type ReleaseOptions = {
    /** A pixel is textured when its luma gradient exceeds this many codes per pixel. */
    gradient?: number;
    /** A held region is scenery when at least this fraction of its pixels is textured: a cel fill is flat. */
    texture?: number;
    /** Held regions under this many pixels stay with the drawing. */
    minimumArea?: number;
    /**
     * A held region is released only when this fraction of its border is the layer's own lines moving at the
     * redraw: scenery seen between walkers is ringed by outlines that move, while a still part of a drawing,
     * detailed as it may be, is bounded by its own outline, which holds.
     */
    enclosed?: number;
    /** Pixels of a released region beside the lines ringing it stay with the drawing, for its antialiased edge. */
    margin?: number;
    /**
     * Still scenery shows the same value whenever the drawings uncover it, so a region stays with the drawing
     * when more than this fraction of its pixels that frames show outside every silhouette (at least three)
     * differ from their mean there by over `max(6, 3 spreads)` of luma. Off (1) by default: on market-pan a
     * character that stands still later over the wagon is outside every silhouette, so the frames "uncovering"
     * the wagon show that character and the wagon seen between the walkers was kept. `window` does the job.
     */
    revealed?: number;
    /**
     * A held region also has to hold through the layer's redraws this many holds either side of its own (1):
     * scenery shown between drawings stays put while they are redrawn around it, a still patch of a drawing
     * changes once the drawing moves. Lines that moved at those redraws count toward its ring. One hold
     * reaches the redraws into the drawings two away, so scenery near an edge that walks fast stays with the
     * layer (a ring walking 3 px a drawing keeps 29% of the middle it encloses, 6.8% with no window).
     */
    window?: number;
};
/**
 * Release the scenery a layer's silhouette holds between its drawings. A layer is what updates on its own
 * redraws, so inside each hold's silhouette a region whose pixels changed at neither redraw bounding the
 * hold (the pair into its first frame and the pair out of its last) is not this layer's update. When it
 * also carries scenery's texture, rather than a cel's flat fill, and is ringed by the layer's lines that
 * moved at the redraw, it is what shows between the drawings (the wagon between market-pan's walkers) and
 * is taken out of every frame of the hold, so the plate learns it; pieces the release cuts off under the
 * silhouettes' minimum area go too. A hold with no redraw on either side has nothing to compare and is kept. Run it on the final
 * silhouettes: growth fills enclosed holes again.
 */
export declare function releaseHeldScenery(source: PixelFrameSource, evidence: DrawingEvidence, silhouettes: SceneSilhouettes, frames: LayerFrames, options?: ReleaseOptions & {
    progress?: StageProgress;
}): Promise<SceneSilhouettes & {
    released: number[];
}>;
/**
 * Carve every frame's silhouettes against a plate built from them, with `layers` (rigid layers whose plates
 * are built) over it; the plates should be rebuilt afterwards. `bandMedian` hands in the fallback plate
 * (`bandMedianPlate`) instead of building it, and `frames` carves only those from its first up to its second;
 * with `pool` the frames are carved on its threads, a range each, the band median built here once.
 */
export declare function refineSilhouettes(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, plate: LayerPlate, options?: CarveOptions & {
    minimumArea?: number;
    medianFallback?: boolean;
    progress?: StageProgress;
    layers?: RigidLayer[];
    bandMedian?: LayerPlate;
    frames?: [number, number];
    pool?: FramePool;
}): Promise<SceneSilhouettes & {
    carved: number[];
}>;
/**
 * Plates for planes in back-to-front order. The camera plate comes from the frames outside every plane,
 * and is empty once a backdrop is in the list, as then no pixel shows the camera's plane as a plate. Each
 * plane's plate comes from the frames where no drawing and no nearer plane hides it, and its rim is
 * unmixed against the planes behind it composited, or the camera plate for the farthest front plane.
 * A lone backdrop's plate carries a lighting drift on `backdropDrift` cells (64; 0 disables), and unless
 * `backdropMedian` is false it is trimmed around each pixel's median (`buildRigidPlate` `median`): a follow
 * shot's drawings sweep over all of it, and those the silhouettes miss stay out. `band` is how
 * far from the cover's edge rims are solved (a defocused edge needs more than the default),
 * and each `peel` round rebuilds the plates with the nearer planes peeled off (`peelNearer`), then every
 * rim. With `pool`, the camera plate is sampled on its threads (`buildLayerPlate`). Returns copies of the layers.
 */
export declare function buildScenePlates(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, layers: RigidLayer[], options?: {
    evidence?: Pick<MeasuredEvidence, 'others' | 'othersBackward'>;
    drift?: number;
    backdropDrift?: number;
    backdropMedian?: boolean;
    margin?: number;
    floor?: number;
    mattes?: boolean;
    band?: number;
    peel?: number;
    progress?: StageProgress;
    pool?: FramePool;
}): Promise<{
    plate: LayerPlate;
    layers: RigidLayer[];
}>;
/**
 * The second pass over the scene's planes, in back-to-front order, once the drawings are known: each
 * plane but the backdrop is measured again without the drawings, front to back; cover what lies behind a
 * plane explains is dropped, and where planes lie behind the camera's own, smooth paint is claimed
 * (`claimRigidCover`); the plates and rims are rebuilt back to front and the silhouettes carved again
 * against the new scene. The returned plate is the camera plate the carve used; rebuild it from the
 * returned silhouettes. With no rigid layers the input comes back unchanged.
 */
export declare function refineRigidScene(source: PixelFrameSource, camera: MeasuredCamera, silhouettes: SceneSilhouettes, layers: RigidLayer[], options?: {
    evidence?: Pick<MeasuredEvidence, 'others' | 'othersBackward'>;
    carve?: CarveOptions & {
        minimumArea?: number;
    };
    progress?: StageProgress;
    pool?: FramePool;
}): Promise<{
    layers: RigidLayer[];
    silhouettes: SceneSilhouettes & {
        carved?: number[];
    };
    plate?: LayerPlate;
    dropped: number[];
    claimed: number[];
}>;

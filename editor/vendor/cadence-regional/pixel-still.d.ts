import { type CameraPath, type DrawingEvidence, type WorldAtlas } from './pixel-drawings.ts';
import { type PixelFrameSource, type SceneSilhouettes, type StageProgress } from './pixel-layers.ts';
import { type FramePool } from './pixel-share.ts';
/**
 * Every world pixel's change events in pair order: for world pixel `a` they are entries `start[a]` up to
 * `start[a + 1]`, each with its pair. It answers, for any frame, when a point of the plate last changed
 * before it and next changes after it.
 */
export type EventIndex = {
    atlas: WorldAtlas;
    pairs: number;
    start: Uint32Array;
    pair: Uint16Array;
};
/** Index a shot's change events by world pixel. */
export declare function indexEvents(evidence: DrawingEvidence): EventIndex;
/**
 * What each world point shows first and holds, read bilinearly at each frame's exact camera position: the mean
 * of its earliest stretch of `hold` frames within `tolerance` of the stretch's luma and `chromaTolerance` of its
 * color. Scenery is seen before what walks over it; a stretch that starts after the point came into view and
 * lasts until it leaves is something that arrived and stayed, and is no plate. A frame shows the plate where
 * the luma range over the point's 3x3 neighborhood holds it within `shownTolerance` and the point's color is
 * within `chromaTolerance`. `share` counts those frames among all that see the neighborhood; `consistency`
 * among those and the ones showing something else with no silhouette over the point, so a frame only counts
 * against the plate when no layer passes in front (silhouettes also bridge scenery between drawings, which is
 * why islands trust `share`). The first and last frame showing it tell whether it came before and after a run.
 */
export type HeldPlate = {
    atlas: WorldAtlas;
    /** -1 where the point has no plate. */
    luma: Float32Array;
    /** Blue and red less luma. */
    blue: Float32Array;
    red: Float32Array;
    /** The first and last frame that see the point, -1 for none. */
    first: Int16Array;
    last: Int16Array;
    share: Float32Array;
    consistency: Float32Array;
    firstShown: Int16Array;
    lastShown: Int16Array;
};
export type HeldPlateOptions = {
    /** Frames a stretch holds to be the plate (12). */
    hold?: number;
    /** Luma a stretch's frames stay within of its mean (8). */
    tolerance?: number;
    /** Frames after a point comes into view within which its plate may still start and last to the end (2). */
    arrivalSlack?: number;
    /** Luma a 3x3 range may miss the plate by and still show it (12). */
    shownTolerance?: number;
    /** Difference of each of blue and red less luma within a stretch, and at a point that still shows the plate (10). */
    chromaTolerance?: number;
};
/** The held plate of the atlas rows from `rows`' first up to its second (`HeldPlate`), with an atlas of those rows. */
export declare function heldPlateRows(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, rows: [number, number], options?: HeldPlateOptions, silhouettes?: SceneSilhouettes): Promise<HeldPlate>;
/** The held plate of the whole atlas (`HeldPlate`), checked against `silhouettes`; with `pool`, bands of its rows on the pool's threads. */
export declare function heldPlate(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, options?: HeldPlateOptions & {
    pool?: FramePool;
    silhouettes?: SceneSilhouettes;
}): Promise<HeldPlate>;
export type StillOptions = HeldPlateOptions & {
    /**
     * How far from its own world point a pixel's 3x3 patch may be found in the plate (0). One pixel lets a line
     * re-traced in place through, which the plate then shows where the frame has it a pixel over.
     */
    radius?: number;
    /** Mean luma difference over the patch (8). */
    meanTolerance?: number;
    /** Luma difference at the center (12), whose color must be within `chromaTolerance`. */
    centerTolerance?: number;
    /** Frames a closed still run lasts to be scenery revealed between two things passing (18); 0 leaves them. */
    span?: number;
    /** The plate's `consistency` at a point for a pixel to match it there (.95). */
    consistent?: number;
    /** The median `share` over an enclosed piece of matching pixels for it to go too (.9); 0 leaves them. */
    islands?: number;
    /** Frames a layer the carve leaves under the minimum area in every frame must last to stay (12). */
    lasting?: number;
};
/**
 * Carve out of the silhouettes what holds still against the whole plate (`HeldPlate`): a point that shows the
 * scenery the shot shows there is background at any depth, and one that changes only while another layer
 * passes over it is still that scenery. Per frame, a silhouette pixel is trusted when its 3x3 patch is found in
 * the plate within `radius` pixels at a point whose `consistency` reaches `consistent` (a drawing held early and
 * moved later is not scenery). Two floods start beside the outside of the silhouettes, each on its own since
 * joined they would open each other's walls: one through trusted pixels, one through pixels that do not show
 * the plate and whose run without a change lasts `span` frames and ends while the point is in view (scenery the
 * plate does not know, uncovered and covered again), unless the point shows the plate before and after the run
 * (a drawing that stood over the scenery). Trusted pieces neither flood reached go when their median `share`
 * reaches `islands`. Of what is left, a piece under the silhouettes' minimum area goes when most of it shows
 * the plate, and a layer of such pieces (`layerFrames`) goes unless it lasts `lasting` frames. Only for scenery
 * held in the camera's coordinates: with a backdrop the camera holds the drawings instead. With `pool`, the
 * plate and the frames are worked on its threads.
 */
export declare function carveStill(source: PixelFrameSource, camera: CameraPath, evidence: DrawingEvidence, silhouettes: SceneSilhouettes, options?: StillOptions & {
    pool?: FramePool;
    progress?: StageProgress;
}): Promise<SceneSilhouettes & {
    stilled: number[];
}>;
/** `carveStill`'s frames from `range`'s first up to its second, against a held plate and event index made for the shot. */
export declare function stillFrames(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, plate: HeldPlate, index: EventIndex, options: StillOptions, range: [number, number], progress?: StageProgress): Promise<SceneSilhouettes & {
    stilled: number[];
}>;

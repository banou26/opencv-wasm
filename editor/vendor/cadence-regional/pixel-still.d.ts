import { type CameraPath, type DrawingEvidence, type WorldAtlas } from './pixel-drawings.ts';
import { type PixelFrameSource, type SceneSilhouettes, type StageProgress } from './pixel-layers.ts';
import { type FramePool } from './pixel-share.ts';
import { type PlateRuns, type VoteOptions } from './pixel-vote.ts';
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
 * What each world point holds, read bilinearly at each frame's exact camera position: the mean of one of its
 * stretches of at least `hold` frames within `tolerance` of the stretch's luma and `chromaTolerance` of its color. A
 * stretch that starts after the point came into view and lasts until it leaves is arrival-shaped. Which stretch is
 * the plate is the motion vote's (`voteStretches`, `voteRegions`): one point's history cannot tell "a drawing stood
 * here, then left scenery showing to the end" from "scenery, then a drawing arrived and stayed", and which side of
 * each change moved can. On market-pan the scene plate at frame 70 then knows 65.0% of the wagon left of the red
 * coat, seen only in frames 15 to 37 (30.6% with the first stretch), and the carve takes 86.4% of the wheel the man
 * in white's robe stood on from 20 to 43, which shows from 44 to the end. With `vote: false` it is the longest
 * stretch that is no arrival (the first with `pick` 'first'): scenery shows longest where drawings only pass or
 * stand a while. A frame shows the plate where the luma range over the point's 3x3 neighborhood holds it within
 * `shownTolerance` and the point's color is within `chromaTolerance`. `share` counts those frames among all that see
 * the neighborhood; `consistency` among those and the ones showing something else with no silhouette over the point,
 * nor a stretch the vote calls a layer's, so a frame only counts against the plate when no layer passes in front
 * (silhouettes also bridge scenery between drawings, which is why islands trust `share`, and a flat drawing that
 * stops loses its inside from them). The first and last frame showing it tell whether it came before and after a
 * run.
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
    /** With the vote, each voting point's held stretches and which of them are a layer's. */
    runs?: PlateRuns;
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
    /** Which held stretch is the plate without the vote: the longest that is not an arrival ('longest', the default), or the first. */
    pick?: 'first' | 'longest';
    /** The motion vote's tunables (`VoteOptions`), on by default; false keeps the longest (or first) stretch. */
    vote?: VoteOptions | false;
};
/** The held plate of the atlas rows from `rows`' first up to its second without the vote (`HeldPlate`), with an atlas of those rows. */
export declare function heldPlateRows(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, rows: [number, number], options?: HeldPlateOptions, silhouettes?: SceneSilhouettes): Promise<HeldPlate>;
/**
 * `HeldPlate`'s share, consistency and first and last frame showing the plate over the atlas rows from `rows`'
 * first up to its second, for a plate of the whole atlas: the second pass of the voted plate, which the pool
 * works in bands of rows.
 */
export declare function plateShown(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, rows: [number, number], plate: Pick<HeldPlate, 'luma' | 'blue' | 'red' | 'runs'>, options?: HeldPlateOptions, silhouettes?: SceneSilhouettes): Promise<{
    share: Float32Array<ArrayBuffer>;
    consistency: Float32Array<ArrayBuffer>;
    firstShown: Int16Array<ArrayBuffer>;
    lastShown: Int16Array<ArrayBuffer>;
}>;
/**
 * The held plate of the whole atlas (`HeldPlate`), checked against `silhouettes`. With `pool`, bands of its rows
 * are worked on the pool's threads; the vote's regions, which span the atlas, are joined on this one between its
 * two banded passes (about .1 s on market-pan's 364,675 voting stretches).
 */
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
    /** Frames the carved silhouettes must have covered a stretch for what the input lost of it to stay (12); 0 leaves it out (`continueLayers`). */
    covering?: number;
    /** Radius of the closing whose enclosed pixels next to a piece `continueLayers` kept join it (4); 0 leaves them. */
    closing?: number;
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
 * or the vote calls the point's stretch at that frame a layer's (a drawing that stood over the scenery: without
 * the vote's say the carve takes 1.79M more of market-pan's silhouette pixels over the shot). Trusted pieces
 * neither flood reached go when their median `share` reaches `islands`. Of what is left, a piece under the
 * silhouettes' minimum area goes when most of it shows the plate, and a layer of such pieces (`layerFrames`)
 * goes unless it lasts `lasting` frames. Last, what the input silhouettes lost of a layer that stopped goes back
 * into it (`continueLayers`). Only for scenery held in the camera's coordinates: with a backdrop the camera holds
 * the drawings instead. With `pool`, the plate and the frames are worked on its threads.
 */
export declare function carveStill(source: PixelFrameSource, camera: CameraPath, evidence: DrawingEvidence, silhouettes: SceneSilhouettes, options?: StillOptions & {
    pool?: FramePool;
    progress?: StageProgress;
}): Promise<SceneSilhouettes & {
    stilled: number[];
    continued: number[];
    taken: Uint8Array[];
}>;
/**
 * What a layer that stopped left without changing, put back into its carved silhouettes. Change evidence carries
 * no ink inside a flat drawing that stops, so the silhouettes can lose its inside while every pixel there still
 * shows what the layer showed the frame before, and the plate then learns the drawing (market-pan's red coat from
 * frame 98). Per world point, read as the held plate is, a stretch runs while each frame is within `tolerance` of
 * its mean luma and `chromaTolerance` of its color. A pixel outside `input` is kept when its point was inside
 * `carved` or kept the frame before, the frame continues that stretch, `carved` covered the stretch `covering`
 * frames, and the frame does not show the held plate there. Per frame, kept pieces under the silhouettes'
 * minimum area go, and what a closing by `closing` pixels encloses within that of a kept piece joins it (the rim
 * the stopped drawing's last redraw left). Scenery a silhouette merely covered shows its held plate or was
 * covered only a few frames. Run it after the carve, against the plate checked on the input silhouettes: fed
 * back into them, it would make the held plate of a walking coat consistent.
 */
export declare function continueLayers(source: PixelFrameSource, camera: CameraPath, plate: HeldPlate, input: SceneSilhouettes, carved: SceneSilhouettes, options?: StillOptions): Promise<SceneSilhouettes & {
    continued: number[];
}>;
/** `carveStill`'s frames from `range`'s first up to its second, against a held plate and event index made for the shot. */
export declare function stillFrames(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, plate: HeldPlate, index: EventIndex, options: StillOptions, range: [number, number], progress?: StageProgress): Promise<SceneSilhouettes & {
    stilled: number[];
}>;

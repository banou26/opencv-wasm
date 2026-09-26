import { type CameraPath, type WorldAtlas } from './pixel-drawings.ts';
import type { PixelFrameSource, SceneSilhouettes } from './pixel-layers.ts';
import type { HeldPlateOptions } from './pixel-still.ts';
/**
 * The tunables of the motion vote that picks the held plate (`HeldPlateOptions.vote`), each at the value measured
 * on market-pan when unset. The vote splits one point's history, which cannot tell "a drawing stood here, then
 * left scenery showing to the end" from "scenery, then a drawing arrived and stayed", by which side of each change
 * moved.
 */
export type VoteOptions = {
    /** Half side of the square whose changed pixels judge a transition (10). */
    radius?: number;
    /** Pixels searched across, either way, for the shift that explains the change (10). */
    search?: number;
    /** Pixels searched up and down, either way, for that shift (2). */
    searchY?: number;
    /** Luma by which a pixel changes across the pair to count as changed (12). */
    changed?: number;
    /** Share of the changed pixels the best shift must explain for the pair to be judged (.4). */
    support?: number;
    /** Luma within which a pixel is found where the shift puts it, or where it was (8). */
    match?: number;
    /** Frames within which the stretches of 4-adjacent points start and end to join a region (3). */
    link?: number;
    /**
     * Share of a region's decided votes, read side by side, that makes it a layer (.17), when `layerSides` agrees.
     * Moved 30% either way, alone or with `layerSides`, the market-pan result holds; at .25 the robe's region, whose
     * share is .242, turns scenery.
     */
    layer?: number;
    /** Share of a region's votes read over both sides together that must say layer too (.125); a region with none passes. */
    layerSides?: number;
    /** Decided votes a region needs to decide its stretches (5); with 1, the carve takes 1.6% of market-pan's stopped men at frame 100, against 1.2%. */
    minVotes?: number;
    /** Frames of other values across which a stretch's value is followed back to where it first showed and on to where it last did (6); 0 judges its own edges. */
    chain?: number;
    /** The most of a scenery region's decided votes that may say layer for an arrival-shaped stretch of it to be the plate (.02). */
    arrivalShare?: number;
    /** Pixels the union of the shot's silhouettes is grown by to choose the points that vote (4). */
    near?: number;
};
/**
 * Per voting world point, its held stretches in time order (entries `start[a]` up to `start[a + 1]`), the frames
 * each holds, and whether the vote calls it a layer's: what the still carve's span flood and the plate's
 * consistency read of the vote. Points that do not vote have none.
 */
export type PlateRuns = {
    start: Uint32Array;
    from: Int16Array;
    to: Int16Array;
    layer: Uint8Array;
};
/**
 * `voteStretches`' result for a band of atlas rows: what each point's history holds and how the transitions at
 * the edges of each voting point's stretches read. Bands of consecutive rows, in order, are what `voteRegions`
 * joins; no band's result depends on how the atlas was split.
 */
export type VoteStretches = {
    /** The first and last frame that see the point, -1 for none. */
    first: Int16Array;
    last: Int16Array;
    /** Where the point does not vote, its plate: its first held stretch unless that is an arrival. -1 elsewhere. */
    luma: Float32Array;
    blue: Float32Array;
    red: Float32Array;
    /** Per point, its held stretches when it votes, else 0. */
    held: Uint8Array;
    /**
     * The voting points' held stretches, point by point and in time order: the frames each holds, its mean, and the
     * votes of its start and end, read side by side (`split`) and over both sides together (`sides`): 0 at the edge
     * of the point's view, 1 scenery, 2 layer, 3 undecided.
     */
    stretches: {
        from: Int16Array;
        to: Int16Array;
        luma: Float32Array;
        blue: Float32Array;
        red: Float32Array;
        startSplit: Uint8Array;
        endSplit: Uint8Array;
        startSides: Uint8Array;
        endSides: Uint8Array;
    };
};
/**
 * The first pass of the vote over the atlas rows from `rows`' first up to its second (`VoteStretches`). Per point,
 * every stretch of `hold` frames within `tolerance` of its mean luma and `chromaTolerance` of its color, read as
 * `heldPlateRows` reads them, up to one per `hold` frames of the shot. The points that vote are those a silhouette
 * covers in some frame, grown by `near` (every point without `silhouettes`); the others take their first held
 * stretch unless it arrived. At each voting stretch's start (the pair before it) and end (the pair after it), unless
 * at the edge of the point's view, the shift that best explains the pixels changing near the point is the moving
 * layer's motion, and textured pixels on each side of the point tell which side moved: a start whose own side moved
 * arrived and an end whose own side moved left, both a layer's; a side held still says scenery. The split reading
 * judges the edges of the stretch's value chain, followed across `chain` frames of other values (an arm swinging
 * over a stopped body splits its value into stretches whose edges are the arm's); the sides reading judges the
 * stretch's own edges.
 */
export declare function voteStretches(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, rows: [number, number], options?: HeldPlateOptions, silhouettes?: SceneSilhouettes): Promise<VoteStretches>;
/**
 * The second pass of the vote, over the whole atlas: the regions, what each stretch is, and the plate. Stretches
 * of 4-adjacent voting points starting and ending within `link` frames, with means within `tolerance` luma and
 * `chromaTolerance` color, join a region, and so do they on timing alone in a coarser one that decides a
 * stretch its own region leaves undecided. A region with `minVotes` split votes or more is decided: a layer
 * when `layer` of them say so and `layerSides` of its sides votes do, else scenery. A stretch no region decides
 * is a layer when its own split votes say layer at least as often as scenery, and some. The plate is the first
 * stretch that is no layer's and whose region is scenery revealed (`minVotes` split starts, under `layer` of them
 * arrivals), failing that the longest that is no layer's. A stretch that arrived and stayed to the end is allowed
 * only when its value also showed earlier at the point, its own start was revealed, or its region is scenery with
 * at most `arrivalShare` of its votes, either reading, saying layer. `bands` are `voteStretches`' results for
 * consecutive bands of rows covering the atlas, in order.
 */
export declare function voteRegions(atlas: WorldAtlas, bands: VoteStretches[], options?: HeldPlateOptions): {
    luma: Float32Array;
    blue: Float32Array;
    red: Float32Array;
    first: Int16Array;
    last: Int16Array;
    runs: PlateRuns;
};

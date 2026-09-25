import type { Behind } from './pixel-cels.ts';
import { type CameraPath, type WorldAtlas } from './pixel-drawings.ts';
import type { Translation } from './pixel-frame.ts';
import { type MeasuredCamera, type PixelFrameSource, type StageProgress } from './pixel-layers.ts';
import { type LayerPlate } from './pixel-plate.ts';
/**
 * A held painting that slides with its own rigid motion over the camera's plate, such as a parallax
 * forest. Its path maps like the camera's: frame pixel (x, y) shows layer point (x - dx, y - dy).
 */
export type RigidLayer = {
    path: CameraPath;
    atlas: WorldAtlas;
    /** Pairs where the layer's own motion was measured. */
    measured: number;
    /** Median speed of the layer in pixels per frame: in a pan the slower plane is the farther one. */
    depth: number;
    /** The camera's own plane, when planes lie behind it and it needs a cover of its own. */
    camera?: true;
    /**
     * The farthest plane when planes lie behind the camera's own plane. It is never measured: cover and
     * decided are all ones, and it paints wherever no nearer plane does.
     */
    backdrop?: true;
    /** Frames between the two frames of the cover tests, one entry per displacement. */
    baselines: number[];
    /** Per atlas pixel: tests where only this layer's motion explains it, only the camera's, both, and all tests. */
    own: Uint16Array;
    back: Uint16Array;
    both: Uint16Array;
    tested: Uint16Array;
    /** 1 where the layer paints. */
    cover: Uint8Array;
    /** Straight alpha and premultiplied color on the cover's rim, where the layer mixes with what is behind it. */
    matte?: RigidMatte;
    /** 1 where enough tests measured the pixel to decide; elsewhere nobody knows which layer shows. */
    decided: Uint8Array;
    plate?: LayerPlate;
};
export type RigidOptions = {
    /**
     * Relative displacements the cover tests span: smooth scenery repeats over a few pixels, not over these.
     * The longer one decides flat paint over scenery that only changes slowly.
     */
    displacements?: number[];
    /** Test every this many frames, per displacement. */
    strides?: number[];
    /** Paint needs this many tests where only the layer's motion explains it. */
    minimumOwn?: number;
    /** Paint tolerates this many camera-only tests per layer-only test, from drawings held in front of it. */
    occlusion?: number;
    /**
     * Layer-only tests must be this fraction of all but the camera-only ones, which are left to `occlusion`.
     * Smooth scenery through a gap matches both motions most of the time and the layer's alone now and then;
     * paint matches the camera's only by coincidence.
     */
    ownFraction?: number;
    /** Paint is closed by this radius, then enclosed holes under `maximumHole` pixels are filled. */
    closing?: number;
    maximumHole?: number;
    /** A hole stays open when camera-only tests are on average this fraction of its tests. */
    openHole?: number;
    /** Cover components under this many pixels are dropped. */
    minimumArea?: number;
    /** A pixel is decided after this many tests. */
    minimumTests?: number;
    /**
     * Per frame, pixels of drawings in front of the layer. A test skips a pixel covered in either of its
     * frames, where only occlusion could be measured: the first pass has none, a second can pass the silhouettes.
     */
    exclude?: (frame: number) => Uint8Array | undefined;
    /**
     * Per frame, pixels nearer planes paint or leave undecided. A test skips a pixel only where they hide it
     * in the first frame or hide where its paint goes in the second. `exclude` also skips a pixel when any
     * plane's destination is covered, right for small drawings, but under trunks covering a third of the
     * frame that discards most of the tests that did see the plane.
     */
    occluders?: (frame: number) => Uint8Array | undefined;
    /**
     * Trace each other plane's content at the paint's destination back to where that plane held it in the
     * first frame, which is exact when the other planes move. Off, the check reads the first frame at the
     * destination, the same test when the other planes hold still.
     */
    arrival?: boolean;
    progress?: StageProgress;
};
/**
 * Paths of the rigid layers other than the camera: non-camera candidate motions linked into tracks, tracks
 * whose mean motions agree within `merge` pixels joined into one layer (a layer found twice on some pairs
 * splits the greedy linking into several tracks), and a layer kept when measured on `minimumPresence` of
 * the pairs. A pair's step is the median of the layer's candidates there; missing pairs interpolate.
 */
export declare function rigidPaths(camera: MeasuredCamera, minimumPresence?: number, merge?: number): {
    path: CameraPath;
    measured: number;
    steps: Translation[];
}[];
/**
 * Where a rigid layer paints, from frames a baseline apart: a pixel of the layer holds its value in the
 * layer's coordinates, a pixel where the camera's scenery shows through holds it in the camera's. Frames
 * a pair apart cannot tell smooth scenery from paint, as it repeats a few pixels on; each baseline spans
 * one of `displacements` in pixels of relative motion. Pixels neither motion decides are paint only
 * inside enclosed holes that the camera does not explain.
 */
export declare function measureRigidCover(source: PixelFrameSource, camera: CameraPath, layer: {
    path: CameraPath;
    measured: number;
}, options?: RigidOptions & {
    others?: CameraPath[];
}): Promise<RigidLayer>;
/**
 * The same test for any plane against every other one, the camera's included: bit 0 of each test is
 * this plane's motion. Used as is for the camera's own plane when planes lie behind it.
 */
export declare function measurePlaneCover(source: PixelFrameSource, layer: {
    path: CameraPath;
    measured: number;
}, others: CameraPath[], options?: RigidOptions): Promise<RigidLayer>;
/** Median step length of a path in pixels per frame. */
export declare function pathSpeed(path: CameraPath): number;
/** A plane to measure: a found rigid path, or the camera's own plane and the backdrop once planes lie behind it. */
export type PlaneEntry = {
    path: CameraPath;
    measured: number;
    camera?: true;
    backdrop?: true;
};
/**
 * The scene's planes back to front. In a pan, scenery moves the way the camera's own plane does and the
 * farther the slower, so a plane is behind the camera's when it is slower and its median step points the
 * same way. With none behind, the found planes are all in front, faster nearer, and the camera's plane is
 * the plate as before. Otherwise the camera's own plane joins between them and the farthest plane becomes
 * the backdrop. Speed is only a parallax prior: a plane moving on its own, or scenery sliding behind a
 * still foreground, gets the wrong depth.
 */
export declare function orderPlanes(camera: CameraPath, found: {
    path: CameraPath;
    measured: number;
}[]): PlaneEntry[];
/**
 * Covers for planes in back-to-front order, measured front to back: each plane is tested against every
 * other one, and only where the planes already measured in front of it leave it visible. The backdrop is
 * never measured, and one already built is reused, as is every other plane's order. With a camera entry
 * the other planes follow their paint to where it arrives; without one this is `measureRigidCover` for
 * each plane.
 */
export declare function measureScenePlanes(source: PixelFrameSource, camera: CameraPath, planes: (PlaneEntry | RigidLayer)[], options?: RigidOptions): Promise<RigidLayer[]>;
/**
 * Per frame, what hides plane `index` of a back-to-front list: `exclude` (drawings in front), and every
 * nearer plane's cover and undecided pixels grown by `rim` pixels, where that plane's antialiased edge
 * mixes into what is behind it. `exclude` itself when no plane is nearer.
 */
export declare function hiddenBy(layers: RigidLayer[], index: number, exclude?: (frame: number) => Uint8Array | undefined, rim?: number): ((frame: number) => Uint8Array | undefined) | undefined;
/**
 * Drop cover what lies behind the layer explains: the camera's plate, or `behind` for a plane with planes
 * behind it. A narrow gap of smooth scenery between two pieces of paint holds still in the layer's
 * coordinates while paint crosses its scenery, so motion alone calls it paint, but its pixels show what is
 * behind at their own positions, where paint only matches it by coincidence. A cover pixel is dropped when
 * at least `minimumAgree` frames, and `fraction` of the frames where what is behind is known, match it
 * within `tolerance` codes. `exclude` keeps drawings and nearer planes in front out of the count.
 */
export declare function refineRigidCover(source: PixelFrameSource, camera: CameraPath, plate: LayerPlate, layer: RigidLayer, options?: {
    tolerance?: number;
    fraction?: number;
    minimumAgree?: number;
    exclude?: (frame: number) => Uint8Array | undefined;
    behind?: Behind;
    progress?: StageProgress;
}): Promise<RigidLayer & {
    dropped: number;
}>;
/** Where plane `index` of a back-to-front list shows on one frame: its cover, outside every nearer plane's cover and undecided pixels. */
export declare function planeShown(layers: RigidLayer[], index: number, frame: number): Uint8Array;
/** The layer's cover on one frame's pixel grid, at the frame's integer placement; `undecided` also marks pixels nobody decided. */
export declare function renderCover(layer: RigidLayer, frame: number, undecided?: boolean): Uint8Array;
/** The layer's paint: a trimmed mean in its own coordinates of every frame pixel under its cover, outside `exclude`. */
export declare function buildRigidPlate(source: PixelFrameSource, layer: RigidLayer, exclude?: (frame: number) => Uint8Array | undefined, options?: {
    margin?: number;
    floor?: number;
    progress?: StageProgress;
}): Promise<LayerPlate>;
/**
 * A rigid layer's edge: `slot` maps atlas pixels within the rim band to entries of `alpha` and of
 * `color` (premultiplied, three per entry); -1 elsewhere. `identified` entries (`solved` of them) had
 * alpha measured from the scenery behind them changing; the others borrow it, so only their composite is
 * exact. Alpha NaN: too few frames.
 */
export type RigidMatte = {
    slot: Int32Array;
    alpha: Float32Array;
    color: Float32Array;
    identified: Uint8Array;
    solved: number;
};
/**
 * Unmix the rim of a rigid layer from what shows behind it. A layer pixel slides over changing scenery,
 * so its observations follow `frame = G + (1 - alpha) * behind` with one premultiplied color G and one
 * alpha for every frame: least squares over the frames gives alpha = 1 - cov(frame, behind) / var(behind)
 * summed over channels. Frames are resampled onto the layer's atlas grid, and the camera plate with them,
 * so every observation of an atlas pixel is the same point of the layer. Pixels within `band` of the
 * cover's edge are solved where the scenery behind them varied by at least `minimumSpread` codes; frames
 * where `exclude` (drawings or nearer planes in front) or an unknown plate touches the pixel are skipped.
 * What is behind is the camera plate unless `behind` renders the farther planes instead.
 */
export declare function matteRigidLayer(source: PixelFrameSource, camera: CameraPath, plate: LayerPlate, layer: RigidLayer, options?: {
    band?: number;
    minimumSpread?: number;
    minimumFrames?: number;
    exclude?: (frame: number) => Uint8Array | undefined;
    behind?: Behind;
    progress?: StageProgress;
}): Promise<RigidMatte>;
/**
 * The scene without its drawings: the camera plate with the rigid layers composited over it in order,
 * back to front, each resampled at its sub-pixel position as premultiplied color and alpha: its plate
 * where it covers, and its matte, when solved, on its rim. A pixel is unknown where a layer's contribution
 * is (paint never observed, or a pixel nobody decided), or where it is not opaque and what is behind is.
 */
export declare function renderScene(plate: LayerPlate, camera: CameraPath, layers: RigidLayer[], frame: number): {
    data: Float32Array;
    known: Uint8Array;
};

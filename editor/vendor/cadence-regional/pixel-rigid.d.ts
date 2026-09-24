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
    /** Frames between the two frames of the cover tests, one entry per displacement. */
    baselines: number[];
    /** Per atlas pixel: tests where only this layer's motion explains it, only the camera's, both, and all tests. */
    own: Uint16Array;
    back: Uint16Array;
    both: Uint16Array;
    tested: Uint16Array;
    /** 1 where the layer paints. */
    cover: Uint8Array;
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
    progress?: StageProgress;
};
/**
 * Paths of the rigid layers other than the camera: non-camera candidate motions linked into tracks,
 * kept when measured on `minimumPresence` of the pairs. Missing pairs interpolate between measured ones.
 */
export declare function rigidPaths(camera: MeasuredCamera, minimumPresence?: number): {
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
export declare function measureRigidCover(source: PixelFrameSource, camera: MeasuredCamera, layer: {
    path: CameraPath;
    measured: number;
}, options?: RigidOptions): Promise<RigidLayer>;
/**
 * Drop cover the camera's plate explains: a narrow gap of smooth scenery between two pieces of paint holds
 * still in the layer's coordinates while paint crosses its scenery, so motion alone calls it paint, but its
 * pixels show the camera plate at their own positions, where paint only matches it by coincidence. A cover
 * pixel is dropped when at least `minimumAgree` frames, and `fraction` of the frames where the plate is
 * known, match it within `tolerance` codes. `exclude` keeps drawings in front out of the count.
 */
export declare function refineRigidCover(source: PixelFrameSource, camera: CameraPath, plate: LayerPlate, layer: RigidLayer, options?: {
    tolerance?: number;
    fraction?: number;
    minimumAgree?: number;
    exclude?: (frame: number) => Uint8Array | undefined;
    progress?: StageProgress;
}): Promise<RigidLayer & {
    dropped: number;
}>;
/** The layer's cover on one frame's pixel grid, at the frame's integer placement; `undecided` also marks pixels nobody decided. */
export declare function renderCover(layer: RigidLayer, frame: number, undecided?: boolean): Uint8Array;
/** The layer's paint: a trimmed mean in its own coordinates of every frame pixel under its cover, outside `exclude`. */
export declare function buildRigidPlate(source: PixelFrameSource, layer: RigidLayer, exclude?: (frame: number) => Uint8Array | undefined, options?: {
    margin?: number;
    floor?: number;
    progress?: StageProgress;
}): Promise<LayerPlate>;
/**
 * The scene without its drawings: the camera plate with the rigid layers over it in order, back to front,
 * where each covers the pixel. A covered pixel is known only where its layer's plate is, and a pixel whose
 * layer nobody decided is unknown.
 */
export declare function renderScene(plate: LayerPlate, camera: CameraPath, layers: RigidLayer[], frame: number): {
    data: Float32Array;
    known: Uint8Array;
};

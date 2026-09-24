import { type CameraPath } from './pixel-drawings.ts';
import { type PixelFrame } from './pixel-frame.ts';
import { type MeasuredCamera, type MeasuredEvidence, type PixelFrameSource, type SceneSilhouettes, type StageProgress } from './pixel-layers.ts';
import { type LayerPlate } from './pixel-plate.ts';
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
/**
 * Median of every observation, silhouettes ignored, of the world pixels that fall in some frame's edge
 * band. Where a drawing's outline jitters over background, the background is what most frames show, so
 * the median recovers it where the plate, which excludes every silhouette, has nothing. A pixel a drawing
 * covers most of the time gets the drawing; the carve's line-art stop protects that case.
 */
export declare function bandMedianPlate(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, band?: number, progress?: StageProgress): Promise<LayerPlate>;
/**
 * Carve every frame's silhouettes against a plate built from them, with `layers` (rigid layers whose plates
 * are built) over it; the plates should be rebuilt afterwards.
 */
export declare function refineSilhouettes(source: PixelFrameSource, camera: CameraPath, silhouettes: SceneSilhouettes, plate: LayerPlate, options?: CarveOptions & {
    minimumArea?: number;
    medianFallback?: boolean;
    progress?: StageProgress;
    layers?: RigidLayer[];
}): Promise<SceneSilhouettes & {
    carved: number[];
}>;
/**
 * The second pass over rigid layers, once the drawings are known: each cover is measured again without
 * the drawings, cover the camera plate explains is dropped, both kinds of plate are rebuilt, each rim is
 * matted and the silhouettes carved again against the new scene. The returned plate is the camera plate the carve used;
 * rebuild it from the returned silhouettes. With no rigid layers the input comes back unchanged.
 */
export declare function refineRigidScene(source: PixelFrameSource, camera: MeasuredCamera, silhouettes: SceneSilhouettes, layers: RigidLayer[], options?: {
    evidence?: Pick<MeasuredEvidence, 'others' | 'othersBackward'>;
    carve?: CarveOptions & {
        minimumArea?: number;
    };
    progress?: StageProgress;
}): Promise<{
    layers: RigidLayer[];
    silhouettes: SceneSilhouettes & {
        carved?: number[];
    };
    plate?: LayerPlate;
    dropped: number[];
}>;

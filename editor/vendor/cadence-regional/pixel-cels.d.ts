import type { CameraPath, WorldAtlas } from './pixel-drawings.ts';
import { type LayerFrames } from './pixel-frames.ts';
import type { PixelFrameSource, SceneSilhouettes } from './pixel-layers.ts';
/**
 * One held drawing as premultiplied color and straight alpha on a box of the world atlas: atlas pixel
 * (x + i, y + j) is entry j * width + i. Frames `first` to `last` show it; with the camera path, frame
 * pixel (fx, fy) shows atlas point (fx - dx - atlas.x, fy - dy - atlas.y).
 */
export type HeldCel = {
    layer: number;
    drawing: number;
    first: number;
    last: number;
    x: number;
    y: number;
    width: number;
    height: number;
    alpha: Float32Array;
    color: Float32Array;
};
/** What a frame shows behind the drawings: color and a known flag per pixel (a plate or scene render). */
export type Behind = (frame: number) => {
    data: Float32Array;
    known: Uint8Array;
};
/**
 * Assemble a held drawing from every frame of its hold: in each, the layer's pixels are matted against
 * what is behind them and resampled onto the world atlas at the frame's sub-pixel camera position; per
 * pixel the frames agreeing with the median alpha are averaged. A drawing entering the frame edge is
 * complete wherever most frames of its hold showed it whole, and its edge averages the sampling phases
 * of the hold. World-held drawings only: the camera carries it.
 */
export declare function assembleCel(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, silhouettes: SceneSilhouettes, frames: LayerFrames, layer: number, drawing: number, behind: Behind, margin?: number): Promise<HeldCel>;
/**
 * Composite held drawings over what is behind a frame, each resampled at the frame's camera position with
 * the same cubic kernel the plate renders with, in the order given. `layered` marks pixels a drawing reaches
 * with alpha over 1%.
 */
export declare function composeCels(behind: {
    data: Float32Array;
    known: Uint8Array;
}, camera: CameraPath, atlas: WorldAtlas, cels: HeldCel[], frame: number): {
    data: Float32Array;
    known: Uint8Array;
    layered: Uint8Array;
};
/** The drawings each frame shows, one per layer present, assembled once and reused. */
export declare function assembleCels(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, silhouettes: SceneSilhouettes, frames: LayerFrames, behind: Behind): Promise<HeldCel[][]>;

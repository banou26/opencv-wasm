import type { CameraPath, WorldAtlas } from './pixel-drawings.ts';
import { type LayerFrames } from './pixel-frames.ts';
import type { PixelFrameSource, SceneSilhouettes } from './pixel-layers.ts';
import { type MatteOptions } from './pixel-matte.ts';
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
 * of the hold. World-held drawings only: the camera carries it. The matte picks each edge pixel's
 * foreground color from the drawing's pixels nearby that explain it best (`foreground: 'fitting'`).
 */
export declare function assembleCel(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, silhouettes: SceneSilhouettes, frames: LayerFrames, layer: number, drawing: number, behind: Behind, margin?: number, matte?: MatteOptions): Promise<HeldCel>;
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
/**
 * Refine a held drawing against every frame of its hold. Its premultiplied color C and alpha A on the atlas
 * are solved by least squares (conjugate gradients) so that `frame = warp(C) + (1 - warp(A)) * behind`,
 * with the cubic warp `composeCels` renders with, holds over the whole hold at every sub-pixel phase the
 * camera put it at: recomposing the hold then reproduces its frames, antialiased edges included. Alpha
 * is only identifiable where what is behind changes over the hold; over a behind that stays the same (a
 * drawing held in the world over the plate) only C - A * behind shows, so alpha is pulled toward the
 * starting cel's (its matte) with `anchor` times the frames' weight, and the frames decide the color.
 * `exclude` keeps pixels other drawings cover out of the fit. Color stays within [0, 255 * alpha], alpha
 * within [0, 1].
 */
export declare function solveCel(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, cel: HeldCel, behind: Behind, options?: {
    iterations?: number;
    anchor?: number;
    exclude?: (frame: number) => Uint8Array | undefined;
}): Promise<HeldCel>;
/** The drawings each frame shows, one per layer present, assembled once and reused. */
export declare function assembleCels(source: PixelFrameSource, camera: CameraPath, atlas: WorldAtlas, silhouettes: SceneSilhouettes, frames: LayerFrames, behind: Behind): Promise<HeldCel[][]>;

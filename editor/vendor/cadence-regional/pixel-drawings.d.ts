import { type PairChange } from './pixel-change.ts';
import type { Translation } from './pixel-frame.ts';
import type { Box } from './types.ts';
/** Frame pixel (x, y) shows world point (x - positions[t].dx, y - positions[t].dy). */
export type CameraPath = {
    width: number;
    height: number;
    positions: Translation[];
};
/** Integer world rectangle covering every frame of the path. */
export type WorldAtlas = {
    x: number;
    y: number;
    width: number;
    height: number;
};
/** Ink appears across the pair: the later frame is darker. */
export declare const ARRIVE = 1;
/** Ink disappears across the pair: the earlier frame is darker. */
export declare const LEAVE = 2;
export declare const CHANGE = 4;
/** Sorted world-atlas indices of one pair's changes, grown to absorb integer placement. */
export type PairEvidence = {
    indices: Uint32Array;
    flags: Uint8Array;
};
export type DrawingEvidence = {
    camera: CameraPath;
    atlas: WorldAtlas;
    dilation: number;
    inkDilation: number;
    pairs: PairEvidence[];
};
export declare function cameraPath(width: number, height: number, steps: Translation[]): CameraPath;
export declare function worldAtlas(camera: CameraPath, margin?: number): WorldAtlas;
/** Integer atlas offset of a frame: atlas column = x + offset.x, row = y + offset.y. */
export declare function frameOffset(camera: CameraPath, atlas: WorldAtlas, frame: number): {
    x: number;
    y: number;
};
/**
 * Merge a pair's two directions into world coordinates. `forward` tests frame `pair` against the next
 * frame, `backward` the next frame against `pair`; each keeps its own frame's pixel grid.
 */
export declare function pairEvidence(camera: CameraPath, atlas: WorldAtlas, pair: number, forward: PairChange, backward: PairChange, dilation?: number, inkDilation?: number): PairEvidence;
export type SilhouetteOptions = {
    closeRadius?: number;
    minimumArea?: number;
};
/**
 * Pixels of one frame that belong to a drawing held at that frame. A pixel is ink of the held drawing
 * when ink arrived at its last change before the frame, or leaves at its next change after it. Ink is
 * closed, enclosed holes are filled and small components dropped. Background vacated or about to be
 * covered keeps the other ink sign and stays outside; artwork that never changes is never a drawing.
 */
export type DrawingSilhouette = {
    width: number;
    height: number;
    frame: number;
    /** 1 inside a silhouette. */
    mask: Uint8Array;
    /** Bit ARRIVE: ink from the entry change; bit LEAVE: ink from the exit change. */
    ink: Uint8Array;
    components: {
        area: number;
        box: Box;
    }[];
};
export declare function drawingInk(evidence: DrawingEvidence, frame: number): Uint8Array;
export declare function fillEnclosed(mask: Uint8Array, width: number, height: number): Uint8Array;
export declare function drawingSilhouette(evidence: DrawingEvidence, frame: number, options?: SilhouetteOptions): DrawingSilhouette;

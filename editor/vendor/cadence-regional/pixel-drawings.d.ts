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
/** A change carries the luma just before and after it (bit VALUED set). */
export declare const VALUED = 8;
/** The change only boiled: a counterpart lies within 1.5 px. */
export declare const BOILED = 16;
/** The value after the change is the pixel's scenery (its median over the shot). */
export declare const AFTER_SCENERY = 32;
/** The value before the change is the pixel's scenery. */
export declare const BEFORE_SCENERY = 64;
/** Sorted world-atlas indices of one pair's changes, grown to absorb integer placement. */
export type PairEvidence = {
    indices: Uint32Array;
    flags: Uint8Array;
    before?: Uint8Array;
    after?: Uint8Array;
};
/** `others`/`othersBackward`, when present, pack per pair the pixels only another rigid layer explains (frame p, then p + 1). */
export type DrawingEvidence = {
    camera: CameraPath;
    atlas: WorldAtlas;
    dilation: number;
    inkDilation: number;
    pairs: PairEvidence[];
    others?: Uint8Array[];
    othersBackward?: Uint8Array[];
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
/** `erode` trims the filled outline; 0 keeps every antialiased edge pixel, which the carve can then trim against the plate. */
export type SilhouetteOptions = {
    closeRadius?: number;
    minimumArea?: number;
    erode?: number;
    /** 'both' requires ink to arrive at the last change and leave at the next when both exist; 'either' accepts one. */
    inkRule?: 'either' | 'both';
    /** Drop ink whose value recurs outside the drawing's hold, within this many luma codes; 0 disables. */
    recurrence?: number;
    /** Drop ink whose bracket is a local minority (see `drawingInk`); radius 0 disables. */
    consistency?: BracketConsistency;
    /** Ink components under this many pixels are dropped before closing. */
    minimumInk?: number;
    /** Surviving ink spreads this many pixels to absorb half-pixel placement quantization. */
    spread?: number;
    /**
     * Leaving ink whose value is the scenery: 'never' (default) keeps it, 'recurring' rejects it when the value
     * also recurs across a different stretch of time, 'known' when the pixel never changed before the frame or
     * its last change revealed the scenery (the value shown now is scenery either way), 'always' whenever it
     * did not boil. A drawing that stood still from the first frame is its own median, so the rejections can
     * cost its outline; on market-pan 'recurring' removes scenery about to be covered but splits a mostly
     * static character off its group.
     */
    sceneryLeaves?: 'never' | 'recurring' | 'known' | 'always';
    /**
     * Leaving ink whose value is the scenery and that did not boil is dropped when its change is at least
     * this many frames away (0 disables). A drawing on twos or threes leaves within a few frames; scenery an
     * effect sweeps over late in the shot would otherwise be ink for every frame before it.
     */
    leaveHorizon?: number;
    /**
     * With the frame's own luma, held ink must show the value its bracket measured, within this many codes
     * of the range of its 3x3 neighborhood:
     * a pixel that fades in below the change threshold and then vanishes has one change, and its value
     * just before it is not the value of the frames long before.
     */
    holdTolerance?: number;
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
/**
 * Ink of the drawing held at `frame`. With `recurrence` > 0, ink is dropped where the pixel's current
 * value (luma) also appears before its previous change or after its next one, within that many codes:
 * scenery that a drawing covers and uncovers shows the same value again, a drawing's boiling line does
 * not. Background line art about to be covered by a light drawing carries a drawing's ink signature
 * otherwise.
 */
export type BracketConsistency = {
    radius: number;
    fraction: number;
};
/**
 * `consistency` keeps an ink pixel only where its bracket (last change, next change) holds at least
 * `fraction` of the ink of the dominant bracket within `radius`: every line of one drawing changes at the
 * same redraws, while scenery revealed or about to be covered next to it has a bracket of its own.
 */
export declare function drawingInk(evidence: DrawingEvidence, frame: number, rule?: 'either' | 'both', recurrence?: number, consistency?: BracketConsistency, spread?: number, sceneryLeaves?: 'never' | 'recurring' | 'known' | 'always', leaveHorizon?: number, hold?: {
    luma: Uint8Array;
    tolerance: number;
}): Uint8Array;
export declare function fillEnclosed(mask: Uint8Array, width: number, height: number): Uint8Array;
export declare function drawingSilhouette(evidence: DrawingEvidence, frame: number, options?: SilhouetteOptions, luma?: Uint8Array): DrawingSilhouette;

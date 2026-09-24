import type { FrameVectorGroups } from './vector-frame-groups.ts';
export type FrameVectorSupportOptions = {
    fillHoles?: boolean;
    fillEdges?: boolean;
    edgeReach?: number;
};
export type FrameVectorSupport = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    columns: number;
    rows: number;
    options: Required<FrameVectorSupportOptions>;
    frames: {
        frame: number;
        /** Completed frame-local support, not measured motion or pixel ownership. */
        labels: Int32Array;
        /** 0 unknown, 1 measured, 2 enclosed-hole inference, 3 edge inference. */
        provenance: Uint8Array;
        counts: {
            measured: number;
            holes: number;
            border: number;
            unknown: number;
        };
        observations: {
            id: number;
            holeCells: number[];
            borderCells: number[];
        }[];
    }[];
};
/** Infer missing support from frozen geometry without modifying raw groups or inventing vectors. */
export declare function completeFrameVectorSupport(groups: FrameVectorGroups, options?: FrameVectorSupportOptions): FrameVectorSupport;

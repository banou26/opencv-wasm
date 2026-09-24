import type { FrameVectorGroups } from './vector-frame-groups.ts';
import type { FrameVectorIdentities } from './vector-identities.ts';
import type { FrameVectorSupport } from './vector-support.ts';
export type FrameVectorFragmentOptions = {
    enabled?: boolean;
    maxCells?: number;
    maxRun?: number;
};
export type FrameVectorFragments = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    columns: number;
    rows: number;
    options: Required<FrameVectorFragmentOptions>;
    frames: {
        frame: number;
        /** Derived completed-support track IDs; original group maps remain separate. */
        trackLabels: Int32Array;
        merged: Uint8Array;
        merges: {
            fromGroupId: number;
            toGroupId: number;
            fromTrackId: number;
            toTrackId: number;
            cells: number[];
            measuredCells: number[];
            reason: 'enclosed' | 'partial';
            runLength: number;
        }[];
    }[];
};
/** Inferred membership only: no source pixels, vectors, raw groups or identity history are modified. */
export declare function mergeFrameVectorFragments(groups: FrameVectorGroups, support: FrameVectorSupport, identities: FrameVectorIdentities, options?: FrameVectorFragmentOptions): FrameVectorFragments;

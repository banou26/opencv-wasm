import type { FrameVectorGroups } from './vector-frame-groups.ts';
export type FrameVectorIdentityOptions = {
    maxGap?: number;
    matchRadius?: number;
};
export type FrameVectorIdentities = {
    width: number;
    height: number;
    frameCount: number;
    cellSize: number;
    options: {
        maxGap: number;
        matchRadius: number;
    };
    frames: {
        frame: number;
        observations: {
            groupId: number;
            trackId: number;
            previousFrame: number | null;
            score: number | null;
        }[];
        dormantTrackIds: number[];
    }[];
    tracks: {
        id: number;
        firstFrame: number;
        lastFrame: number;
        observations: number;
    }[];
};
/**
 * Scene-local display identities only. No candidate, group, support or vector
 * changes. Dominant group0 is the camera anchor, not a semantic classification.
 * An absent foreground stays dormant; held-frame foreground masks are not made.
 */
export declare function trackFrameVectorIdentities(groups: FrameVectorGroups, options?: FrameVectorIdentityOptions): FrameVectorIdentities;

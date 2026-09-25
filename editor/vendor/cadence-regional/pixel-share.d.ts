import type { PixelFrameSource } from './pixel-layers.ts';
/**
 * Runs named per-range tasks over a shot's frames on other threads (`pixel-pool.ts` in Node): `map` hands
 * every range the same input and resolves with the results in range order. A stage given one splits its
 * frames into ranges and merges what comes back; given none, it runs them itself. Tasks read `source`,
 * which holds the frames the pool shares.
 */
export type FramePool = {
    size: number;
    source: PixelFrameSource;
    map<T>(task: string, input: unknown, ranges: [number, number][]): Promise<T[]>;
};
/** A worker's task over one range; tasks a pool loads from other modules get the shared frames as `source`. */
export type PoolTask = (input: any, range: [number, number], source: PixelFrameSource) => Promise<unknown>;
/** A copy of `value` whose typed arrays are backed by shared memory, so that posting it to a worker shares them. */
export declare function shareDeep<T>(value: T, seen?: Map<unknown, unknown>): T;
/** The items from `first` up to `end` in `parts` contiguous ranges of near-equal length, empty ones left out. */
export declare function splitRange(first: number, end: number, parts: number): [number, number][];

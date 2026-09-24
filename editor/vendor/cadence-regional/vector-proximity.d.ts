import type { MotionGrid } from './regional-types.ts';
/** Separate distant supported islands without letting small fragments bridge them. */
export declare function spatialIslands(cells: number[], grid: MotionGrid, gap: number): number[][];

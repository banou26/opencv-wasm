import type { GraphDocument, PortType } from './engine/types'
import type { NodeStatus } from './engine/execute'
import type { RenderQuality } from './engine/render-quality'

/** Metadata for the currently attached clip. Frame numbers are presentation ranks. */
export type SourceInfo = { id: string; name: string; width: number; height: number; frameCount: number; fps: number; codec: string; decoder: 'software' | 'hardware'; warnings: string[] }
/** Inspect requests are immutable snapshots so a later edit cannot modify a running plan. */
export type Inspection = { doc: GraphDocument; referenceAsset?: string; path?: string[]; selected: string; port: string | null; frame: number; gain: number }
export type SourceDemand = { asset: string; frame: number }
/** Main-thread commands; native matrices and GPU objects never cross this boundary. */
export type WorkerCommand =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'load'; request: number; file: File; asset: string }
  | { type: 'inspect'; request: number; value: Inspection }
  | { type: 'cancel'; request: number }
  | { type: 'thumbnails'; generation: number; value: Inspection; nodes: string[] }
  | { type: 'budget'; bytes: number }
  | { type: 'bake'; request: number; value: Inspection; start: number; end: number; fps: number; quality: RenderQuality }
  | { type: 'pixel'; request: number; x: number; y: number }
  | { type: 'export'; request: number }
/** Worker feedback, including explicit failure and bounded-memory statistics. */
export type WorkerEvent =
  | { type: 'ready'; adapter: string }
  | { type: 'thumbnail'; generation: number; path?: string[]; node: string; frame: number; bitmap?: ImageBitmap; scalar?: number; summary?: string; kind?: PortType; error?: string }
  | { type: 'source'; request: number; value: SourceInfo }
  | { type: 'status'; request: number; value: NodeStatus }
  | { type: 'result'; request: number; selected: string; path?: string[]; frame: number; width: number; height: number; kind: PortType; sources: SourceDemand[]; summary?: string; scalar?: number; motion?: { dx: number; dy: number; response: number }; range: 'unit' | 'signed'; elapsed: number; cacheBytes: number; cacheEntries: number }
  | { type: 'error'; request: number; message: string; fatal?: boolean }
  | { type: 'bake-progress'; request: number; done: number; total: number }
  | { type: 'bake-done'; request: number; count: number; start: number; fps: number; cancelled: boolean; blob?: Blob }
  | { type: 'pixel'; request: number; x: number; y: number; rgba: number[] }
  | { type: 'export'; request: number; blob: Blob }

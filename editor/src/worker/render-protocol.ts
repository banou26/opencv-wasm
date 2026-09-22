import type { Inspection } from '../protocol'

/** Local File handles are cloned; compressed video bytes are read only when needed. */
export type RenderInit = { type: 'init'; wasm: Uint8Array<ArrayBuffer>; files: { asset: string; file: File }[]; source?: string; value: Inspection; budget: number }
/** Initialization precedes sequential frame requests within each worker. */
export type RenderCommand = RenderInit | { type: 'frame'; index: number; time: number }
/** Pixel storage is transferred out of the worker, never copied from a native Mat handle. */
export type RenderFrame = { type: 'frame'; index: number; width: number; height: number; pixels: Uint8Array<ArrayBuffer> }
/** Each request resolves to readiness, owned pixels, or a reported failure. */
export type RenderEvent = { type: 'ready' } | RenderFrame | { type: 'error'; message: string }

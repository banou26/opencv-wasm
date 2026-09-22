/** Transport revisions distinguish an explicit seek from frames decoded for older requests. */
export type PlayerCommand =
  | { type: 'open'; url: string; fps: number; count: number }
  | { type: 'presented' }
  | { type: 'transport'; request: number; index: number; playing: boolean; rate: number; loop: boolean }

/** Each transferred frame belongs to the receiver and must be closed after display or rejection. */
export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'frame'; request: number; index: number; frame: VideoFrame }
  | { type: 'ended'; request: number }
  | { type: 'error'; request: number; message: string }

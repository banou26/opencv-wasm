import type { RenderCommand, RenderEvent, RenderFrame, RenderInit } from './render-protocol'

type Slot = { worker: Worker; pending?: { resolve: (event: RenderEvent) => void; reject: (error: Error) => void } }

/** Bounded render workers, terminated on completion, cancellation, and every failure. */
export class RenderPool {
  private slots: Slot[] = []
  private closed = false
  private failure = new Error('Render cancelled')
  private abort = () => this.close()
  constructor(count: number, private signal: AbortSignal) {
    signal.addEventListener('abort', this.abort, { once: true })
    try {
      for (let i = 0; i < count; i++) {
        const slot: Slot = { worker: new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module', name: `opencv-render-${i + 1}` }) }
        this.slots.push(slot)
        slot.worker.onmessage = ({ data }: MessageEvent<RenderEvent>) => {
          const pending = slot.pending; slot.pending = undefined
          if (data.type === 'error') pending?.reject(new Error(data.message))
          else pending?.resolve(data)
        }
        slot.worker.onerror = event => this.close(new Error(event.message || 'A render worker stopped'))
        slot.worker.onmessageerror = () => this.close(new Error('Cannot read a render worker result'))
      }
    } catch (error) { this.close(); throw error }
  }
  private request(slot: Slot, command: RenderCommand) {
    if (this.closed || this.signal.aborted) return Promise.reject(this.failure)
    if (slot.pending) return Promise.reject(new Error('Render worker is already busy'))
    return new Promise<RenderEvent>((resolve, reject) => {
      slot.pending = { resolve, reject }
      try { slot.worker.postMessage(command) }
      catch (error) { slot.pending = undefined; reject(error) }
    })
  }
  /** The already verified binary is cloned once per heap, without repeat downloads. */
  async initialize(value: RenderInit) {
    await Promise.all(this.slots.map(async slot => {
      const event = await this.request(slot, value)
      if (event.type !== 'ready') throw new Error('Unexpected render initialization response')
    }))
  }
  async frame(slot: number, index: number, time: number): Promise<RenderFrame> {
    const event = await this.request(this.slots[slot]!, { type: 'frame', index, time })
    if (event.type !== 'frame' || event.index !== index) throw new Error('Render worker returned an unexpected frame')
    return event
  }
  close(error = new Error('Render cancelled')) {
    if (this.closed) return
    this.closed = true; this.failure = error; this.signal.removeEventListener('abort', this.abort)
    for (const slot of this.slots) { slot.pending?.reject(error); slot.pending = undefined; slot.worker.terminate() }
    this.slots = []
  }
}

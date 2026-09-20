import type { MainModule, GComputation, GCompileArgs, GraphValue, GraphFrame, GraphSource, GraphFrames, GraphStreamHandle } from '../lib/opencv.js'

/** Convert a synchronous or asynchronous iterable to a source with explicit end-of-stream cleanup. */
export const makeIterableSource = (frames: GraphFrames): GraphSource => {
  const iterator = Symbol.asyncIterator in frames ? frames[Symbol.asyncIterator]() : frames[Symbol.iterator]()
  let closed = false
  return {
    async pull(signal) {
      if (closed || signal.aborted) return null
      const frame = await iterator.next()
      return frame.done ? null : frame.value
    },
    async close() {
      if (closed) return
      closed = true
      await iterator.return?.()
    },
  }
}

/** Serial graph execution over frame sources. Use await using or await delete() to release retained handles. */
export class GraphStream implements GraphStreamHandle {
  #graph: GComputation
  #options: GCompileArgs | undefined
  #source: GraphSource | undefined
  #controller: AbortController | undefined
  #pending: Promise<GraphValue[] | null> | undefined
  #closing: Promise<void> | undefined
  #active = false
  #deleted = false
  #sequence = 0n

  /** Retain a computation and its compilation options for serial frame execution. The original handles remain caller-owned. */
  constructor(graph: GComputation, options?: GCompileArgs) {
    this.#graph = graph.clone()
    try { this.#options = options?.clone() }
    catch (error) { this.#graph.delete(); throw error }
  }

  /** Set a source before starting. Stop the previous source before replacing it. */
  setSource(source: GraphSource | GraphFrames): void {
    this.#assertAlive()
    if (this.#source || this.#pending || this.#closing) throw new Error('Stop the previous source before replacing it')
    this.#source = 'pull' in source ? source : makeIterableSource(source)
  }

  /** Begin pulling the configured source. No work is queued ahead of pull(). */
  start(): void {
    this.#assertAlive()
    if (!this.#source || this.#active || this.#closing) throw new Error('A stopped source must be configured before starting')
    this.#controller = new AbortController()
    this.#sequence = 0n
    this.#active = true
  }

  /** True while accepting frames. End of stream, stop and callback failures clear this state. */
  running(): boolean { return this.#active }

  /** Return owned graph outputs, or null at end of stream. Concurrent pulls are rejected. */
  pull(): Promise<GraphValue[] | null> {
    this.#assertAlive()
    if (this.#pending) return Promise.reject(new Error('A frame pull is already pending'))
    if (!this.#active) return Promise.reject(new Error('Start the graph stream before pulling'))
    this.#pending = this.#next().finally(() => { this.#pending = undefined })
    return this.#pending
  }

  async #next(): Promise<GraphValue[] | null> {
    try {
      const frame = await this.#source!.pull(this.#controller!.signal)
      if (frame === null) {
        this.#active = false
        await this.#closeSource()
        return null
      }
      const batch = 'values' in frame && !Array.isArray(frame) ? frame as Exclude<GraphFrame, readonly GraphValue[]> : { values: frame as readonly GraphValue[] }
      let outputs: GraphValue[] | undefined
      try {
        if (!this.#active) return null
        const metadata = {
          seqId: batch.metadata?.seqId ?? this.#sequence,
          timestamp: batch.metadata?.timestamp ?? BigInt(Date.now()) * 1000n,
        }
        for (const value of Object.values(metadata)) {
          if (typeof value !== 'bigint' || BigInt.asIntN(64, value) !== value) throw new RangeError('Frame metadata must use signed 64-bit bigint values')
        }
        this.#sequence++
        outputs = this.#options ? this.#graph.applyWithMetadata(batch.values, metadata, this.#options) : this.#graph.applyWithMetadata(batch.values, metadata)
        return outputs
      } finally {
        try { batch.release?.() }
        catch (error) {
          // A throwing release callback prevents delivery of otherwise successful outputs.
          const dispose = (values: readonly GraphValue[]): void => {
            for (const value of values) {
              if (Array.isArray(value)) dispose(value)
              else if (typeof value === 'object' && value && 'delete' in value) value.delete()
            }
          }
          if (outputs) dispose(outputs)
          throw error
        }
      }
    } catch (error) {
      this.#active = false
      await this.#closeSource()
      throw error
    }
  }

  async #closeSource(): Promise<void> {
    const source = this.#source
    this.#source = undefined
    await source?.close?.()
  }

  /** Abort a pending source read and close the source after the read settles. */
  stop(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#active = false
    this.#controller?.abort()
    this.#closing = (async () => {
      try { await this.#pending } catch {}
      await this.#closeSource()
    })().finally(() => { this.#closing = undefined })
    return this.#closing
  }

  /** Idempotently stop the source and dispose the retained computation and compile arguments. */
  async delete(): Promise<void> {
    if (this.#deleted) { await this.#closing; return }
    this.#deleted = true
    try { await this.stop() }
    finally {
      this.#options?.delete()
      this.#graph.delete()
    }
  }

  /** Integrate with TypeScript's await using resource management. */
  [Symbol.asyncDispose](): Promise<void> { return this.delete() }

  #assertAlive(): void {
    if (this.#deleted) throw new Error('This graph stream has been deleted')
  }
}

/** Create file and iterable source factories for one isolated OpenCV instance. */
export const createStreamAPI = (cv: MainModule) => {
  /** Open a video in this instance's virtual filesystem and yield owned frames with automatic release after graph execution. Supports this build's MJPEG AVI and image-sequence backends. */
  const make_capture_src = (path: string, apiPreference = cv.CAP_ANY): GraphSource => {
    const capture = new cv.VideoCapture(path, apiPreference)
    if (!capture.isOpened()) { capture.delete(); throw new Error(`Could not open video source: ${path}`) }
    let closed = false
    return {
      pull(signal) {
        if (closed || signal.aborted) return null
        const frame = new cv.Mat()
        try {
          if (!capture.read(frame)) { frame.delete(); return null }
          return { values: [frame], release: () => { frame.delete() } }
        } catch (error) { frame.delete(); throw error }
      },
      close() {
        if (closed) return
        closed = true
        try { capture.release() } finally { capture.delete() }
      },
    }
  }
  /** Return an existing source or wrap an iterable with serial pull and close operations. */
  const get_streaming_source = (source: GraphSource | GraphFrames): GraphSource => 'pull' in source ? source : makeIterableSource(source)
  return {
    /** Open an MJPEG AVI or image-sequence source in the virtual filesystem. Frame matrices are automatically released after graph execution. */
    make_capture_src,
    /** Wrap an iterable of frame inputs as a serial source with EOF cleanup. Values are borrowed unless a frame provides release(). */
    make_js_src: makeIterableSource,
    /** Return an existing source or adapt a synchronous/asynchronous iterable. */
    get_streaming_source,
  }
}

/** Install the streaming adapter on this instance's computation prototype. */
export const installGraphStreaming = (cv: MainModule): void => {
  const constructor = cv.GComputation as unknown as { prototype: GComputation }
  Object.defineProperty(constructor.prototype, 'compileStreaming', {
    configurable: true,
    value(this: GComputation, options?: GCompileArgs) { return new GraphStream(this, options) },
  })
}

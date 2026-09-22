import { createFile } from 'mp4box'

/** Stream generated frames into a silent H.264 MP4 without retaining raw baked frames. */
export class MovieEncoder {
  private muxer = createFile()
  private encoder: VideoEncoder
  private track: number | undefined
  private failure: Error | undefined
  private encodedBytes = 0
  private lastTimestamp = -1
  private constructor(private width: number, private height: number, private fps: number, config: VideoEncoderConfig) {
    this.encoder = new VideoEncoder({
      error: error => { this.failure = error },
      output: (chunk, metadata) => {
        try {
          if (this.track === undefined) {
            const description = metadata?.decoderConfig?.description
            if (!description) throw new Error('Encoder did not supply its H.264 configuration')
            const bytes = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description)
            this.track = this.muxer.addTrack({ type: 'avc1', hdlr: 'vide', timescale: 1_000_000, width, height, avcDecoderConfigRecord: bytes.slice().buffer })
          }
          if (chunk.timestamp <= this.lastTimestamp) throw new Error('Encoder returned reordered frames despite realtime mode')
          this.lastTimestamp = chunk.timestamp
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data)
          this.encodedBytes += data.byteLength
          if (this.encodedBytes > 512 * 1024 ** 2) throw new Error('The encoded video exceeds the 512 MiB export budget. Render a shorter range.')
          this.muxer.addSample(this.track, data, { duration: chunk.duration ?? Math.round(1_000_000 / fps), cts: chunk.timestamp, dts: chunk.timestamp, is_sync: chunk.type === 'key' })
        } catch (error) { this.failure = error instanceof Error ? error : new Error(String(error)) }
      },
    })
    this.encoder.configure(config)
  }

  /** Prefer a software encoder; an available hardware encoder uses the same pixel input. */
  static async create(width: number, height: number, fps: number): Promise<MovieEncoder> {
    if (typeof VideoEncoder === 'undefined') throw new Error('VideoEncoder is unavailable in this browser')
    if (width % 2 || height % 2) throw new Error('H.264 export needs an even image width and height')
    for (const hardwareAcceleration of ['prefer-software', 'prefer-hardware'] as const) {
      const config: VideoEncoderConfig = { codec: 'avc1.640033', width, height, bitrate: Math.max(2_000_000, width * height * fps * 0.12), framerate: fps, latencyMode: 'realtime', hardwareAcceleration, avc: { format: 'avc' } }
      if ((await VideoEncoder.isConfigSupported(config)).supported) return new MovieEncoder(width, height, fps, config)
    }
    throw new Error('This Chrome session has no H.264 encoder. Enable its normal graphics session to export video.')
  }

  /** Enqueue one output frame with a precise timestamp and bounded encoder backpressure. */
  async add(pixels: Uint8Array<ArrayBuffer>, index: number) {
    const started = performance.now()
    while (this.encoder.encodeQueueSize > 3) {
      if (this.failure) throw this.failure
      if (performance.now() - started > 15_000) throw new Error('Video encoder stalled')
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    if (this.failure) throw this.failure
    const timestamp = Math.round(index * 1_000_000 / this.fps), duration = Math.round((index + 1) * 1_000_000 / this.fps) - timestamp
    const frame = new VideoFrame(pixels, { format: 'RGBA', codedWidth: this.width, codedHeight: this.height, timestamp, duration })
    try { this.encoder.encode(frame, { keyFrame: index % Math.max(1, Math.round(this.fps * 2)) === 0 }) }
    finally { frame.close() }
  }

  /** Flush the encoder before constructing the file, including a cancelled partial bake. */
  async finish(): Promise<Blob> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.encoder.flush(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Video encoder flush timed out')), 15_000) })])
      if (this.failure) throw this.failure
      if (this.track === undefined) throw new Error('No frames were encoded')
      return new Blob([this.muxer.getBuffer().buffer], { type: 'video/mp4' })
    } finally { clearTimeout(timer); this.close() }
  }

  /** Close an unfinished encoder after an error without leaking queued resources. */
  close() { if (this.encoder.state !== 'closed') this.encoder.close() }
}

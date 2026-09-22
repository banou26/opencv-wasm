import { createFile, MP4BoxBuffer, MultiBufferStream, VisualSampleEntry } from 'mp4box'
import type { Sample, Track } from 'mp4box'
import { frameRate, presentationOrder, startSample } from '../engine/video-index'
import type { SourceInfo } from '../protocol'

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 1))

/** Indexed MP4 reader with a software-first decoder and a bounded look-ahead window. */
export class VideoSource {
  private decoder: VideoDecoder | null = null
  private frames = new Map<number, VideoFrame>()
  private next = 0
  private wanted = -1
  private needsKey = true
  private failure: Error | null = null
  private generation = 0
  private ranks = new Map<number, number>()
  private minimumRank = 0
  readonly ordered: Sample[]

  private constructor(private file: File, private samples: Sample[], private config: VideoDecoderConfig, readonly info: SourceInfo) {
    this.ordered = presentationOrder(samples)
    this.ordered.forEach((s, rank) => this.ranks.set(s.number, rank))
  }

  /** Read sample metadata without retaining the compressed video in memory. */
  static async open(file: File): Promise<VideoSource> {
    if (typeof VideoDecoder === 'undefined') throw new Error('This browser does not provide WebCodecs VideoDecoder. Use a recent desktop Chrome.')
    const mp4 = createFile(), chunkSize = 2 * 1024 * 1024
    let track: Track | undefined, failure = ''
    mp4.onReady = info => { track = info.videoTracks[0] }
    mp4.onError = (_module, message) => { failure = message }
    let offset = 0
    while (offset < file.size) {
      const data = await file.slice(offset, offset + chunkSize).arrayBuffer()
      const next = mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(data, offset))
      offset = Math.max(offset + data.byteLength, next ?? 0)
      if (failure) throw new Error(`Cannot index this MP4: ${failure}`)
    }
    mp4.flush()
    if (!track?.video) throw new Error('Choose an MP4 with a video track. For MKV, remux first: ffmpeg -i input.mkv -map 0:v:0 -c copy output.mp4')
    const samples = mp4.getTrackSamplesInfo(track.id)
    if (!samples.length) throw new Error('The video track has no frames')
    if (track.video.width > 8192 || track.video.height > 8192) throw new Error('This clip exceeds the 8192-pixel working dimension limit')
    const description = samples[0]?.description
    let bytes: Uint8Array<ArrayBuffer> | undefined
    if (description instanceof VisualSampleEntry) {
      const box = description.avcC ?? description.hvcC ?? description.av1C ?? description.vpcC
      if (box) { const stream = new MultiBufferStream(new MP4BoxBuffer(0)); box.write(stream); bytes = new Uint8Array(stream.buffer, 8, stream.getPosition() - 8).slice() }
    }
    let config: VideoDecoderConfig = { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, description: bytes, hardwareAcceleration: 'prefer-software' }
    let decoder: SourceInfo['decoder'] = 'software'
    if (!(await VideoDecoder.isConfigSupported(config)).supported) {
      config = { ...config, hardwareAcceleration: 'prefer-hardware' }; decoder = 'hardware'
      if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error(`This browser cannot decode ${track.codec}. Convert the clip to an H.264 MP4 first.`)
    }
    const ordered = presentationOrder(samples)
    const warnings = ['Video input is decoded to 8-bit RGBA. Use the original 16-bit PNGs outside this video path for precision measurements.']
    if (decoder === 'hardware') warnings.push('Hardware decoding can alter color and make seeking slower on this machine. H.264 software decoding is preferred.')
    const info: SourceInfo = { id: crypto.randomUUID(), name: file.name, width: track.video.width, height: track.video.height, frameCount: samples.length, fps: frameRate(ordered.map(s => s.cts), track.timescale), codec: track.codec, decoder, warnings }
    return new VideoSource(file, samples, config, info)
  }

  private reset(target: Sample) {
    this.generation++
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close()
    this.failure = null; this.next = startSample(this.samples, target); this.needsKey = false
    this.minimumRank = this.ranks.get(this.next) ?? 0
    const generation = this.generation
    this.decoder = new VideoDecoder({
      output: frame => {
        const rank = frame.timestamp
        if (generation !== this.generation || rank < Math.max(this.minimumRank, this.wanted - 2) || rank > this.wanted + 8) { frame.close(); return }
        this.frames.get(rank)?.close(); this.frames.set(rank, frame)
        this.prune()
      },
      error: error => { if (generation === this.generation) this.failure = error },
    })
    this.decoder.configure(this.config)
  }

  private prune() {
    for (const [rank, frame] of this.frames) if (rank < this.wanted - 2 || rank > this.wanted + 8) { this.frames.delete(rank); frame.close() }
  }

  /** Return an owned VideoFrame. The caller must close it, including on cancellation. */
  async frameAt(rank: number, cancelled: () => boolean): Promise<VideoFrame> {
    const target = this.ordered[rank]
    if (!Number.isInteger(rank) || !target) throw new Error(`Frame ${rank} is outside the clip`)
    const hit = this.frames.get(rank)
    if (hit) return hit.clone()
    if (this.needsKey || !this.decoder || this.decoder.state === 'closed' || rank < this.wanted || target.number < this.next) this.reset(target)
    this.wanted = rank; this.prune()
    const decoder = this.decoder
    if (!decoder) throw new Error('Video decoder did not initialize')
    const started = performance.now()
    while (!this.frames.has(rank)) {
      if (cancelled()) throw new Error('Cancelled')
      if (this.failure) throw this.failure
      if (performance.now() - started > 15_000) { this.needsKey = true; throw new Error('Video decoder timed out; try a shorter H.264 clip') }
      if (this.next >= this.samples.length || this.next > target.number + 24) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([decoder.flush(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Video decoder flush timed out')), 10_000) })])
        } finally { clearTimeout(timer); this.needsKey = true }
        if (!this.frames.has(rank)) throw new Error(`Decoder did not produce frame ${rank}`)
        break
      }
      if (decoder.decodeQueueSize > 6) { await pause(); continue }
      const sample = this.samples[this.next]
      if (!sample) throw new Error('Missing compressed sample')
      const data = await this.file.slice(sample.offset, sample.offset + sample.size).arrayBuffer()
      if (cancelled()) throw new Error('Cancelled')
      const timestamp = this.ranks.get(sample.number)
      if (timestamp === undefined) throw new Error('Missing presentation timestamp')
      decoder.decode(new EncodedVideoChunk({ type: sample.is_sync ? 'key' : 'delta', timestamp, duration: 1, data }))
      this.next++
    }
    const frame = this.frames.get(rank)
    if (!frame) throw new Error('Decoded frame is missing')
    return frame.clone()
  }

  /** Close all retained frames and invalidate callbacks from the previous session. */
  close() {
    this.generation++
    if (this.decoder?.state !== 'closed') this.decoder?.close()
    for (const frame of this.frames.values()) frame.close()
    this.frames.clear(); this.decoder = null
  }
}

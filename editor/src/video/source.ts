import { createFile, MP4BoxBuffer, MultiBufferStream, VisualSampleEntry } from 'mp4box'
import type { Sample, Track } from 'mp4box'
import { avcHasIdr, frameRate, presentationOrder, startSample } from '../engine/video-index'
import type { SourceInfo } from '../protocol'
import { DecodedFrameCache } from './frame-cache'

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 1))

/** Indexed MP4 reader with a software-first decoder and bounded bidirectional frame reuse. */
export class VideoSource {
  private decoder: VideoDecoder | null = null
  private frames = new DecodedFrameCache<VideoFrame>()
  private next = 0
  private wanted = -1
  private needsKey = true
  private failure: Error | null = null
  private generation = 0
  private submitted = new Set<number>()
  private ranks = new Map<number, number>()
  private minimumRank = 0
  readonly ordered: Sample[]

  /** Cloneable local-file reference for independent render-worker decoders. */
  get inputFile() { return this.file }

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
    // MP4 open-GOP sync samples may be non-IDR pictures that cannot start WebCodecs AVC decoding.
    if (config.codec.startsWith('avc') && bytes && bytes.length >= 5) {
      const lengthBytes = (bytes[4]! & 3) + 1
      for (const sample of samples) if (sample.is_sync) sample.is_sync = avcHasIdr(new Uint8Array(await file.slice(sample.offset, sample.offset + sample.size).arrayBuffer()), lengthBytes)
    }
    const ordered = presentationOrder(samples)
    const warnings = ['Video input is decoded to 8-bit RGBA. Use the original 16-bit PNGs outside this video path for precision measurements.']
    if (decoder === 'hardware') warnings.push('Hardware decoding can alter color and make seeking slower on this machine. H.264 software decoding is preferred.')
    const info: SourceInfo = { id: crypto.randomUUID(), name: file.name, width: track.video.width, height: track.video.height, frameCount: samples.length, fps: frameRate(ordered.map(s => s.cts), track.timescale), codec: track.codec, decoder, warnings }
    return new VideoSource(file, samples, config, info)
  }

  private reset(target: Sample) {
    this.generation++; this.submitted.clear()
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close()
    this.failure = null; this.next = startSample(this.samples, target); this.needsKey = false
    this.minimumRank = this.ranks.get(this.next) ?? 0
    const generation = this.generation
    this.decoder = new VideoDecoder({
      output: frame => {
        const rank = frame.timestamp
        if (generation !== this.generation) { frame.close(); return }
        this.submitted.delete(rank)
        // Dependencies decoded on the way to a target are useful for reverse
        // scrubbing. Discarding them forced another keyframe decode every third step.
        if (rank < this.minimumRank || rank > this.wanted + 8) { frame.close(); return }
        this.frames.set(rank, frame, this.wanted)
      },
      error: error => { if (generation === this.generation) this.failure = new Error(`Cannot decode frame ${this.wanted}: ${error.message}`) },
    })
    this.decoder.configure(this.config)
  }

  /** Return an owned VideoFrame. The caller must close it, including on cancellation. */
  async frameAt(rank: number, cancelled: () => boolean): Promise<VideoFrame> {
    const target = this.ordered[rank]
    if (!Number.isInteger(rank) || !target) throw new Error(`Frame ${rank} is outside the clip`)
    const hit = this.frames.get(rank)
    if (hit) { this.wanted = rank; return hit.clone() }
    if (this.needsKey || !this.decoder || this.decoder.state === 'closed' || rank < this.wanted || target.number < this.next && !this.submitted.has(rank)) this.reset(target)
    this.wanted = rank
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
      this.submitted.add(timestamp)
      decoder.decode(new EncodedVideoChunk({ type: sample.is_sync ? 'key' : 'delta', timestamp, duration: 1, data }))
      this.next++
    }
    const frame = this.frames.get(rank)
    if (!frame) throw new Error('Decoded frame is missing')
    return frame.clone()
  }

  /** Close all retained frames and invalidate callbacks from the previous session. */
  close() {
    this.generation++; this.submitted.clear()
    if (this.decoder?.state !== 'closed') this.decoder?.close()
    this.frames.clear(); this.decoder = null
  }
}

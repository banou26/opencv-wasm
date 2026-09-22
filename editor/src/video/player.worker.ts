import { VideoSource } from './source'
import type { PlayerCommand, PlayerEvent } from './player-protocol'

let source: VideoSource | undefined, fps = 60, count = 0, request = 0
let index = 0, presented = -1, playing = false, rate = 1, loop = true, anchor = 0
let running = false, failed = false, inFlight = false
const post = (event: PlayerEvent, transfer: Transferable[] = []) => self.postMessage(event, { transfer })
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 4))

/** Decode dependencies privately; only the requested presentation rank leaves this worker. */
const drive = async () => {
  if (running || !source || failed) return
  running = true
  try {
    while (source && !failed) {
      // Keep at most one transferred frame awaiting the UI, even in a busy tab.
      if (inFlight) { await pause(); continue }
      const revision = request
      const elapsed = playing ? Math.floor((performance.now() - anchor) * fps * rate / 1000) : 0
      const position = index + elapsed, ended = playing && !loop && position >= count
      const target = playing && loop ? position % count : Math.min(count - 1, position)
      if (target !== presented) {
        try {
          const frame = await source.frameAt(target, () => request !== revision)
          if (request !== revision) { frame.close(); continue }
          // Playback can skip frames when decoding is slower than the requested rate.
          // A seek never exposes the keyframes or dependencies decoded on the way here.
          inFlight = true
          post({ type: 'frame', request: revision, index: target, frame }, [frame])
          presented = target
        } catch (error) {
          if (request !== revision) continue
          throw error
        }
      }
      if (ended) { playing = false; index = count - 1; post({ type: 'ended', request }); return }
      if (!playing) return
      await pause()
    }
  } catch (error) {
    failed = true; playing = false; source?.close(); source = undefined
    post({ type: 'error', request, message: error instanceof Error ? error.message : String(error) })
  } finally { running = false }
}

self.onmessage = async ({ data }: MessageEvent<PlayerCommand>) => {
  if (data.type === 'presented') { inFlight = false; return }
  if (data.type === 'open') {
    try {
      const response = await fetch(data.url)
      if (!response.ok) throw new Error('Cannot read the rendered video')
      source = await VideoSource.open(new File([await response.blob()], 'rendered-output.mp4', { type: 'video/mp4' }))
      fps = data.fps; count = source.info.frameCount
      if (count !== data.count || !(fps > 0)) throw new Error('Rendered video frame metadata does not match its MP4')
      post({ type: 'ready' }); void drive()
    } catch (error) {
      source?.close(); source = undefined
      post({ type: 'error', request, message: error instanceof Error ? error.message : String(error) })
    }
  } else {
    request = data.request; index = Math.max(0, Math.min(count - 1, Math.floor(data.index)))
    playing = data.playing; rate = data.rate; loop = data.loop; anchor = performance.now()
    // Also acknowledge a seek to the already visible frame, so the UI can settle.
    presented = -1
    void drive()
  }
}

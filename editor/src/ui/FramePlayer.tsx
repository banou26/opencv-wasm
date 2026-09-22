import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { Movie } from './store'
import type { PlayerCommand, PlayerEvent } from '../video/player-protocol'
import { TimelineSlider } from './TimelineSlider'

/** Imperative transport for the active-preview shortcuts; stepping returns false until ready. */
export type FramePlayerHandle = { step: (direction: number) => boolean; pause: () => void }
type Transport = { index: number; playing: boolean; rate: number; loop: boolean }

/** A silent, frame-indexed MP4 preview that keeps the last good image visible while seeking. */
export const FramePlayer = ({ movie, ref }: { movie: Movie; ref: Ref<FramePlayerHandle> }) => {
  const canvas = useRef<HTMLCanvasElement>(null), player = useRef<HTMLDivElement>(null), worker = useRef<Worker | null>(null)
  const serial = useRef(0), ready = useRef(false), position = useRef<Transport>({ index: 0, playing: false, rate: 1, loop: true })
  const [view, setView] = useState({ ...position.current, ready: false, seeking: true, displayed: -1, error: '' })
  const send = (command: PlayerCommand) => worker.current?.postMessage(command)
  const transport = (patch: Partial<Transport>) => {
    if (!ready.current) return false
    position.current = { ...position.current, ...patch }
    send({ type: 'transport', request: ++serial.current, ...position.current })
    setView(current => ({ ...current, ...position.current, seeking: !position.current.playing }))
    return true
  }
  const seek = (index: number) => {
    if (!Number.isFinite(index)) return false
    return transport({ index: Math.max(0, Math.min(movie.count - 1, Math.floor(index))), playing: false })
  }
  const step = (direction: number) => seek(position.current.index + direction)
  const pause = () => { if (position.current.playing) transport({ playing: false }) }
  const toggle = () => transport({ playing: !position.current.playing, index: !position.current.playing && position.current.index === movie.count - 1 ? 0 : position.current.index })
  useImperativeHandle(ref, () => ({ step, pause }))
  useEffect(() => {
    const decoder = new Worker(new URL('../video/player.worker.ts', import.meta.url), { type: 'module' })
    worker.current = decoder
    const fail = (message: string) => { decoder.terminate(); worker.current = null; ready.current = false; position.current.playing = false; setView(current => ({ ...current, ready: false, playing: false, seeking: false, error: message })) }
    decoder.onmessage = ({ data }: MessageEvent<PlayerEvent>) => {
      if (data.type === 'ready') { ready.current = true; setView(current => ({ ...current, ready: true })); return }
      if (data.type === 'frame') {
        try {
          // A newer keypress may already have reached the main thread. Never paint
          // a stale reply, even if its decode finished just before that keypress.
          if (data.request !== serial.current) return
          const surface = canvas.current, context = surface?.getContext('2d', { alpha: false })
          if (!surface || !context) throw new Error('Cannot display the decoded output frame')
          if (surface.width !== data.frame.displayWidth) surface.width = data.frame.displayWidth
          if (surface.height !== data.frame.displayHeight) surface.height = data.frame.displayHeight
          context.drawImage(data.frame, 0, 0)
          surface.dataset.frame = String(data.index)
          position.current.index = data.index
          setView(current => ({ ...current, index: data.index, displayed: data.index, seeking: false }))
        } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
        finally { data.frame.close(); decoder.postMessage({ type: 'presented' } satisfies PlayerCommand) }
      } else if (data.request === serial.current) {
        if (data.type === 'error') fail(data.message)
        else { position.current.playing = false; setView(current => ({ ...current, playing: false })) }
      }
    }
    decoder.onerror = event => fail(event.message || 'Output decoder failed')
    decoder.postMessage({ type: 'open', url: movie.url, count: movie.count, fps: movie.fps } satisfies PlayerCommand)
    return () => { ready.current = false; decoder.terminate(); worker.current = null }
  }, [movie.url, movie.count, movie.fps])
  useEffect(() => {
    const hide = () => { if (document.hidden) pause() }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  return <div className="frame-player" ref={player} tabIndex={0} role="group" aria-label="Rendered output video"
    data-src={movie.url} data-frame={view.displayed} data-requested-frame={view.index} data-playing={view.playing} data-ready={view.ready} data-seeking={view.seeking}
    onKeyDown={event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement && event.target.closest('input, select, button')) return
      if (event.key === ' ') { event.preventDefault(); toggle() }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1) }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); seek(event.key === 'Home' ? 0 : movie.count - 1) }
    }}>
    <div className="output-surface" onPointerDown={() => player.current?.focus({ preventScroll: true })} onDoubleClick={() => {
      void (document.fullscreenElement ? document.exitFullscreen() : player.current?.requestFullscreen())?.catch(() => {})
    }}>
      <canvas ref={canvas} aria-label="Rendered output frame" />
      {view.seeking && <span className="output-player-status">{view.ready ? `Seeking frame ${view.index}…` : 'Opening rendered video…'}</span>}
      {view.error && <div className="output-player-error" role="alert">{view.error}</div>}
    </div>
    <div className="output-transport">
      <div className="output-buttons"><button aria-label="Previous output frame" title="Previous frame (< or ,)" disabled={!view.ready || view.index === 0} onClick={() => step(-1)}>‹</button><button aria-label={view.playing ? 'Pause output' : 'Play output'} disabled={!view.ready} onClick={toggle}>{view.playing ? 'Ⅱ' : '▶'}</button><button aria-label="Next output frame" title="Next frame (> or .)" disabled={!view.ready || view.index === movie.count - 1} onClick={() => step(1)}>›</button></div>
      <label className="output-frame-label">Frame <input aria-label="Output frame" type="number" min={0} max={movie.count - 1} step={1} value={view.index} disabled={!view.ready} onChange={event => { if (Number.isInteger(event.target.valueAsNumber)) seek(event.target.valueAsNumber) }} /><span>/ {movie.count - 1}</span></label>
      <code>{(view.displayed < 0 ? 0 : view.displayed / movie.fps).toFixed(3)} s</code>
      <select aria-label="Output playback speed" value={view.rate} onChange={event => transport({ rate: Number(event.target.value) })} disabled={!view.ready}>{[0.25, 0.5, 1, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select>
      <button aria-label="Loop output" aria-pressed={view.loop} className={view.loop ? 'active' : ''} onClick={() => transport({ loop: !position.current.loop })} disabled={!view.ready}>Loop</button>
      <button aria-label="Fullscreen output" onClick={() => { void (document.fullscreenElement ? document.exitFullscreen() : player.current?.requestFullscreen())?.catch(() => {}) }}>⛶</button>
      <TimelineSlider label="Output timeline" max={movie.count - 1} step={1} value={view.index} disabled={!view.ready} onChange={seek} />
      <span className="output-shortcut-hint">&lt; / &gt; step · Space play / pause</span>
    </div>
  </div>
}

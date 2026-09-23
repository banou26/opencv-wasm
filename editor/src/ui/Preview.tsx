import { useEffect, useRef, useState } from 'react'
import { exportFrame, initialize, inspectPixel } from './client'
import { useEditor } from './store'

/** One native-resolution surface: zoom and pan affect presentation, never the graph data. */
export const Preview = () => {
  const result = useEditor(s => s.result), busy = useEditor(s => s.busy), pixel = useEditor(s => s.pixel), ready = useEditor(s => s.ready), source = useEditor(s => s.source)
  const fatal = useEditor(s => s.fatal)
  const viewport = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [box, setBox] = useState({ width: 640, height: 360 }), [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 }), [pinned, setPinned] = useState(false)
  const pinnedPosition = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null), throttle = useRef(0)
  const visual = !!result?.width && !!result?.height, nativePixels = result?.kind === 'frame' || result?.kind === 'motion'
  const width = result?.width || source?.width || 1920, height = result?.height || source?.height || 1080
  const fit = Math.min(Math.max(1, box.width - 28) / width, Math.max(1, box.height - 28) / height), scale = fit * zoom
  const current = useRef({ zoom, pan, fit }); current.current = { zoom, pan, fit }
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === surface.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height }) }); observer.observe(el)
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const { zoom: oldZoom, pan: oldPan } = current.current, rect = el.getBoundingClientRect()
      const next = Math.min(64, Math.max(0.15, oldZoom * Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.0025)))
      const anchor = { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 }
      setPan({ x: anchor.x - (anchor.x - oldPan.x) * next / oldZoom, y: anchor.y - (anchor.y - oldPan.y) * next / oldZoom }); setZoom(next)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); el.removeEventListener('wheel', wheel) }
  }, [])
  useEffect(() => { setPan({ x: 0, y: 0 }); setZoom(1); setPinned(false) }, [source?.id])
  useEffect(() => { if (pinned && pinnedPosition.current && nativePixels) inspectPixel(pinnedPosition.current.x, pinnedPosition.current.y) }, [pinned, result?.request, nativePixels])
  return <div className="frame-preview" ref={surface} onKeyDown={event => {
    if (event.key === 'Escape' && document.fullscreenElement === surface.current) { event.preventDefault(); void document.exitFullscreen().catch(() => {}) }
  }}>
    <div className="preview-tools"><div><span className="eyebrow">VIEW</span><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Fit</button><button onClick={() => { setZoom(1 / fit); setPan({ x: 0, y: 0 }) }}>1:1</button><code>{Math.round(scale * 100)}%</code></div><div><span className="muted">Scroll to zoom · drag to pan</span><button onClick={exportFrame} disabled={!nativePixels || busy !== 'idle'} title="Save the displayed image with the current view gain">Save PNG</button><button className="preview-fullscreen" aria-label={fullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview'} title={fullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview'} aria-pressed={fullscreen} disabled={!visual} onClick={() => { void (fullscreen ? document.exitFullscreen() : surface.current?.requestFullscreen())?.catch(() => {}) }}>⛶</button></div></div>
    <div ref={viewport} tabIndex={0} aria-label="Image preview" title="Scroll to zoom, drag to pan. Press < or > (comma or period) to step through source frames." className={`image-viewport ${drag.current ? 'dragging' : ''}`} onDoubleClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} onPointerDown={e => {
      if (e.button !== 0) return
      e.currentTarget.focus({ preventScroll: true })
      drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }; e.currentTarget.setPointerCapture(e.pointerId)
    }} onPointerUp={e => { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId) }} onPointerCancel={() => { drag.current = null }} onPointerMove={e => {
      if (drag.current) setPan({ x: drag.current.panX + e.clientX - drag.current.x, y: drag.current.panY + e.clientY - drag.current.y })
      else if (!pinned && nativePixels && performance.now() - throttle.current > 50) {
        const rect = e.currentTarget.getBoundingClientRect()
        inspectPixel((e.clientX - rect.left - box.width / 2 - pan.x) / scale + width / 2, (e.clientY - rect.top - box.height / 2 - pan.y) / scale + height / 2); throttle.current = performance.now()
      }
    }}>
      <canvas ref={initialize} aria-label="Selected node result" style={{ width: width * scale, height: height * scale, left: box.width / 2 + pan.x, top: box.height / 2 + pan.y, imageRendering: scale >= 1 ? 'pixelated' : 'auto', visibility: visual ? 'visible' : 'hidden' }} />
      {!source && !result && <div className="empty-preview"><span className="empty-icon">▷</span><h2>A frame is just the beginning.</h2><p>Open a clip, follow its data through the graph,<br />then turn your experiment into a video.</p><span className="eyebrow">{fatal ? 'ENGINE UNAVAILABLE' : ready ? 'YOUR MEDIA STAYS ON THIS MACHINE' : 'STARTING OPENCV + PREVIEW…'}</span></div>}
      {result?.scalar !== undefined && <div className="scalar-preview"><span className="eyebrow">SCALAR OUTPUT</span><strong>{result.scalar.toFixed(6)}</strong><span>Number · usable by another node’s parameter input</span></div>}
      {result && !visual && result.scalar === undefined && <div className="value-preview"><span className="eyebrow">{result.kind === 'video' ? 'VIDEO CLIP' : result.kind.toUpperCase()}</span><pre>{result.summary}</pre></div>}
      {result?.kind === 'frames' && <div className="preview-badge">Pyramid overview · use Pyramid Level for native pixels</div>}
      {busy === 'inspect' && <div className="preview-badge">Updating frame…</div>}
      {result?.motion && <div className="motion-key"><strong>Δx {result.motion.dx.toFixed(3)} px &nbsp; Δy {result.motion.dy.toFixed(3)} px</strong><span>Global translation · arrows enlarged 4× · response {result.motion.response.toFixed(3)}</span></div>}
    </div>
    <div className="pixel-bar"><span className="eyebrow">PIXEL</span>{pixel && nativePixels ? <><code>{pixel.x}, {pixel.y}</code><span className="swatch" style={{ background: `rgb(${pixel.rgba.slice(0, 3).map(v => Math.round(v * 255)).join(' ')})` }} /><code>{pixel.rgba.slice(0, 3).map(v => v.toFixed(4)).join(' · ')}</code><span className="muted">RGB · float</span></> : <span className="muted">Hover over the image to inspect its values</span>}<button className={pinned ? 'active' : ''} onClick={() => { if (pixel) pinnedPosition.current = { x: pixel.x, y: pixel.y }; setPinned(!pinned) }} disabled={!pixel && !pinned}>{pinned ? 'Unpin' : 'Pin'}</button></div>
  </div>
}

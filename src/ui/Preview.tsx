import { useEffect, useRef, useState } from 'react'
import { exportFrame, initialize, inspectPixel } from './client'
import { useEditor } from './store'

/** One native-resolution surface: zoom and pan affect presentation, never the graph data. */
export const Preview = () => {
  const result = useEditor(s => s.result), busy = useEditor(s => s.busy), pixel = useEditor(s => s.pixel), ready = useEditor(s => s.ready), source = useEditor(s => s.source)
  const viewport = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 640, height: 360 }), [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 }), [pinned, setPinned] = useState(false)
  const pinnedPosition = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null), throttle = useRef(0)
  const width = result?.width || source?.width || 1920, height = result?.height || source?.height || 1080
  const fit = Math.min((box.width - 28) / width, (box.height - 28) / height), scale = fit * zoom
  const current = useRef({ zoom, pan, fit }); current.current = { zoom, pan, fit }
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
  useEffect(() => { if (pinned && pinnedPosition.current && result?.scalar === undefined) inspectPixel(pinnedPosition.current.x, pinnedPosition.current.y) }, [pinned, result?.request, result?.scalar])
  return <>
    <div className="preview-tools"><div><span className="eyebrow">VIEW</span><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Fit</button><button onClick={() => { setZoom(1 / fit); setPan({ x: 0, y: 0 }) }}>1:1</button><code>{Math.round(scale * 100)}%</code></div><div><span className="muted">Scroll to zoom · drag to pan</span><button onClick={exportFrame} disabled={!result || result.scalar !== undefined || busy !== 'idle'} title="Save the displayed image with the current view gain">Save PNG</button></div></div>
    <div ref={viewport} className={`image-viewport ${drag.current ? 'dragging' : ''}`} onDoubleClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} onPointerDown={e => {
      if (e.button !== 0) return
      drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }; e.currentTarget.setPointerCapture(e.pointerId)
    }} onPointerUp={e => { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId) }} onPointerCancel={() => { drag.current = null }} onPointerMove={e => {
      if (drag.current) setPan({ x: drag.current.panX + e.clientX - drag.current.x, y: drag.current.panY + e.clientY - drag.current.y })
      else if (!pinned && result?.scalar === undefined && performance.now() - throttle.current > 50) {
        const rect = e.currentTarget.getBoundingClientRect()
        inspectPixel((e.clientX - rect.left - box.width / 2 - pan.x) / scale + width / 2, (e.clientY - rect.top - box.height / 2 - pan.y) / scale + height / 2); throttle.current = performance.now()
      }
    }}>
      <canvas ref={initialize} aria-label="Selected node result" style={{ width: width * scale, height: height * scale, left: box.width / 2 + pan.x, top: box.height / 2 + pan.y, imageRendering: scale >= 1 ? 'pixelated' : 'auto', visibility: result && result.scalar === undefined ? 'visible' : 'hidden' }} />
      {!source && <div className="empty-preview"><span className="empty-icon">▷</span><h2>A frame is just the beginning.</h2><p>Open a clip, follow its data through the graph,<br />then turn your experiment into a video.</p><span className="eyebrow">{ready ? 'YOUR MEDIA STAYS ON THIS MACHINE' : 'STARTING OPENCV + PREVIEW…'}</span></div>}
      {result?.scalar !== undefined && <div className="scalar-preview"><span className="eyebrow">SCALAR OUTPUT</span><strong>{result.scalar.toFixed(6)}</strong><span>Normalized value · select the image socket to see pixels</span></div>}
      {busy === 'inspect' && <div className="preview-badge">Updating frame…</div>}
      {result?.motion && <div className="motion-key"><strong>Δx {result.motion.dx.toFixed(3)} px &nbsp; Δy {result.motion.dy.toFixed(3)} px</strong><span>Global translation · arrows enlarged 4× · response {result.motion.response.toFixed(3)}</span></div>}
    </div>
    <div className="pixel-bar"><span className="eyebrow">PIXEL</span>{pixel && result?.scalar === undefined ? <><code>{pixel.x}, {pixel.y}</code><span className="swatch" style={{ background: `rgb(${pixel.rgba.slice(0, 3).map(v => Math.round(v * 255)).join(' ')})` }} /><code>{pixel.rgba.slice(0, 3).map(v => v.toFixed(4)).join(' · ')}</code><span className="muted">RGB · float</span></> : <span className="muted">Hover over the image to inspect its values</span>}<button className={pinned ? 'active' : ''} onClick={() => { if (pixel) pinnedPosition.current = { x: pixel.x, y: pixel.y }; setPinned(!pinned) }} disabled={!pixel && !pinned}>{pinned ? 'Unpin' : 'Pin'}</button></div>
  </>
}

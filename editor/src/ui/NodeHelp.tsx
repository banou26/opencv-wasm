import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NodeSpec } from '../engine/types'

/** Help stays at reading size even when the graph is zoomed out. */
export const NodeHelp = ({ spec }: { spec: NodeSpec }) => {
  const id = useId(), button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const clear = () => { clearTimeout(timer.current) }
  const close = () => { clear(); setOpen(false); setPinned(false) }
  const leave = () => {
    clear()
    if (!pinned) timer.current = setTimeout(() => { if (document.activeElement !== button.current) setOpen(false) }, 180)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (!open || !button.current || !popup.current) return
    const place = () => {
      const anchor = button.current!.getBoundingClientRect(), box = popup.current!.getBoundingClientRect()
      const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8))
      const top = anchor.bottom + box.height + 16 <= window.innerHeight ? anchor.bottom + 8 : Math.max(8, anchor.top - box.height - 8)
      setPosition({ left, top })
    }
    place()
    const observer = new ResizeObserver(place); observer.observe(popup.current)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [open, spec.description])
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      const target = event.target as Node | null
      if (!button.current?.contains(target) && !popup.current?.contains(target)) close()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('wheel', outside, { capture: true, passive: true })
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('wheel', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])
  return <>
    <button ref={button} type="button" className="node-help nodrag nopan" aria-label={`${spec.title} description`} aria-describedby={open ? id : undefined} aria-expanded={open} aria-pressed={pinned}
      onMouseEnter={() => { clear(); timer.current = setTimeout(() => setOpen(true), 250) }} onMouseLeave={leave}
      onFocus={() => { clear(); setOpen(true) }} onBlur={leave}
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); clear(); if (pinned) close(); else { setPinned(true); setOpen(true) } }}
    >ⓘ</button>
    {open && createPortal(<div ref={popup} id={id} role="tooltip" aria-label={`About ${spec.title}`} className="node-description" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onMouseEnter={clear} onMouseLeave={leave} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    ><span className="eyebrow">{spec.category}</span><strong>{spec.title}</strong><p>{spec.description}</p><code>{spec.algorithm}</code><small>{pinned ? 'Pinned · click ⓘ again, click outside, or press Esc to close' : 'Click ⓘ to keep this open · Esc to dismiss'}</small></div>, document.body)}
  </>
}

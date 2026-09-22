import { useRef } from 'react'
import type { PointerEvent } from 'react'

/** Keep a scrub gesture alive through preview updates and movement outside the track. */
export const TimelineSlider = ({ label, max, step, value, disabled, onChange }: {
  label: string; max: number; step: number; value: number; disabled: boolean; onChange: (value: number) => void
}) => {
  const drag = useRef<{ id: number; left: number; width: number } | null>(null)
  const update = (event: PointerEvent<HTMLInputElement>) => {
    const active = drag.current
    if (!active || active.id !== event.pointerId || disabled) return
    const fraction = Math.max(0, Math.min(1, (event.clientX - active.left) / active.width))
    onChange(Math.min(max, Number((Math.round(fraction * max / step) * step).toFixed(6))))
  }
  return <input className="timeline-slider" aria-label={label} type="range" min={0} max={max} step={step} value={value} disabled={disabled}
    onChange={event => onChange(Number(event.currentTarget.value))}
    onPointerDown={event => {
      if (disabled || event.button !== 0 || !event.isPrimary) return
      // Handle pointer scrubbing ourselves; retain native keyboard and accessibility behavior.
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      const rect = event.currentTarget.getBoundingClientRect()
      // The 14px thumb's center travels between these endpoints. Keep them stable mid-drag.
      drag.current = { id: event.pointerId, left: rect.left + 7, width: Math.max(1, rect.width - 14) }
      event.currentTarget.setPointerCapture(event.pointerId)
      update(event)
    }}
    onPointerMove={update}
    onPointerUp={event => {
      update(event)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      drag.current = null
    }}
    onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}
  />
}

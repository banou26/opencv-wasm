/** One annotated snapshot in the illustrated example, rendered without OpenCV. */
export type Snapshot = { title: string; svg: string; detail: string }
/** A persistent input and three genuinely different stages of a teaching example. */
export type Visual = { input: Snapshot; stages: [Snapshot, Snapshot, Snapshot]; note: string }
/** Coordinates in a panel's 320 by 224 view box. */
export type Point = [number, number]
/** Shared, high-contrast diagram palette on the dark drawing surface. */
export const palette = {
  ink: '#e4e8f0',
  muted: '#97a3b8',
  grid: '#293344',
  purple: '#b5a0ff',
  green: '#63e2bd',
  orange: '#ffae80',
  blue: '#79bcff',
  dark: '#141b27'
}
/** Escape author text before placing it in generated SVG markup. */
export const escape = (s: string | number) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
/** SVG rectangle, optionally outlined. */
export const rect = (x: number, y: number, w: number, h: number, fill = palette.dark, stroke = 'none', radius = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
/** SVG path for lines, curves and closed regions. */
export const path = (d: string, colour = palette.purple, width = 2, fill = 'none', dashed = false) =>
  `<path d="${d}" fill="${fill}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="5 5"' : ''}/>`
/** SVG circle used for observations, samples and neighbourhoods. */
export const dot = (x: number, y: number, r = 3, fill = palette.purple, stroke = 'none') =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
/** Small panel label; alignment is explicit to keep labels within the view box. */
export const label = (
  x: number,
  y: number,
  value: string | number,
  colour = palette.muted,
  anchor = 'start',
  size = 11
) => `<text x="${x}" y="${y}" fill="${colour}" text-anchor="${anchor}" font-size="${size}">${escape(value)}</text>`
/** Connected samples; closing the curve is opt-in. */
export const line = (points: Point[], colour = palette.purple, width = 2, close = false, fill = 'none') =>
  path(
    points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + (close ? 'Z' : ''),
    colour,
    width,
    fill
  )
/** Arrow with its own geometry, so repeated diagrams need no SVG IDs. */
export const arrow = (x: number, y: number, u: number, v: number, colour = palette.green) => {
  const a = Math.atan2(v - y, u - x),
    s = 6
  return path(
    `M${x} ${y}L${u} ${v}m${-s * Math.cos(a - 0.5)} ${-s * Math.sin(a - 0.5)}L${u} ${v}l${-s * Math.cos(a + 0.5)} ${-s * Math.sin(a + 0.5)}`,
    colour,
    1.6
  )
}
/** Subtle coordinate grid, with no embedded text or external assets. */
export const paper = () =>
  Array.from({ length: 11 }, (_, i) => path(`M${16 + i * 28} 16V208`, palette.grid, 0.6)).join('') +
  Array.from({ length: 8 }, (_, i) => path(`M16 ${16 + i * 27}H304`, palette.grid, 0.6)).join('')
/** Common drawing frame. SVG strings are authored internally, never user input. */
export const svg = (content: string) =>
  `<svg viewBox="0 0 320 224" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${paper()}${content}</svg>`
/** Create an annotated, complete panel from drawing primitives. */
export const shot = (title: string, content: string, detail: string): Snapshot => ({ title, svg: svg(content), detail })
/** Construct the contract shared by full guides and static reference previews. */
export const visual = (
  input: Snapshot,
  stages: [Snapshot, Snapshot, Snapshot],
  note = 'Illustrative example. The stages explain the method; they are not a live OpenCV execution.'
): Visual => ({ input, stages, note })

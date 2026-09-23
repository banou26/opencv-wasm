import type { MotionCell, DrawingEvent } from 'cadence/regional'
import { regionalFineGrid } from 'cadence/regional'
import type { RegionalData } from './regional-data'

export type RegionalView = 'source' | 'flow' | 'validity' | 'cells' | 'tracks' | 'events' | 'timeline' | 'review'
export type RegionalRaster = { width: number; height: number; pixels: Uint8Array; summary: string; labels?: { x: number; y: number; text: string }[] }
const color = (id: number): [number, number, number] => {
  const h = (id * .61803398875) % 1
  return hue(h)
}
const hue = (h: number): [number, number, number] => {
  const x = h * 6, f = x - Math.floor(x), a = Math.round(220 * (1 - f)) + 35, b = Math.round(220 * f) + 35
  return [[255, b, 35], [a, 255, 35], [35, 255, b], [35, a, 255], [b, 35, 255], [255, 35, a]][Math.floor(x) % 6]! as [number, number, number]
}

/** Diagnostic pixels are separate from source artwork and never used as layer alpha. */
export const renderRegional = (data: RegionalData, sourceFrame: number, view: RegionalView, cellSize: number, groupPage = 0): RegionalRaster => {
  const index = sourceFrame - data.scene.first, source = data.scene.frames[index]
  if (!Number.isSafeInteger(sourceFrame) || !source) throw new RangeError(`Source frame must be in the analyzed range ${data.scene.first} to ${data.scene.last}`)
  const { width, height } = source, pair = data.sequence?.pairs[index]
  if (view !== 'source' && !data.sequence) throw new Error('This view requires dense motion data')
  if ((view === 'tracks' || view === 'events' || view === 'review') && !data.tracks) throw new Error('This view requires whole-scene tracks')
  if ((view === 'events' || view === 'review' || view === 'timeline') && !data.analysis) throw new Error('This view requires drawing events')
  if (view === 'timeline') return renderTiming(data, sourceFrame, groupPage)
  const sourcePixels = (): Uint8Array => {
    const result = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      result[i * 4] = source.data[i * 3 + 2]!; result[i * 4 + 1] = source.data[i * 3 + 1]!; result[i * 4 + 2] = source.data[i * 3]!; result[i * 4 + 3] = 255
    }
    return result
  }
  const paint = (pixels: Uint8Array, i: number, rgb: readonly number[], opacity = 1) => {
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = Math.round(pixels[i * 4 + c]! * (1 - opacity) + rgb[c]! * opacity)
    pixels[i * 4 + 3] = 255
  }
  const cellPaint = (pixels: Uint8Array, cell: MotionCell, rgb: readonly number[], opacity: number) => {
    for (let y = cell.y; y < cell.y + cell.height; y++) for (let x = cell.x; x < cell.x + cell.width; x++) paint(pixels, y * width + x, rgb, opacity)
  }
  const panel = (mode: Exclude<RegionalView, 'review' | 'timeline'>): Uint8Array => {
    const pixels = sourcePixels()
    if (mode === 'source') return pixels
    if (mode === 'flow' || mode === 'validity') {
      for (let i = 0; i < width * height; i++) {
        if (!pair?.flow.valid[i]) {
          const bright = ((i % width >> 3) + (Math.floor(i / width) >> 3)) % 2
          paint(pixels, i, bright ? [71, 49, 67] : [40, 31, 40]); continue
        }
        const dx = pair.flow.vectors[i * 2]!, dy = pair.flow.vectors[i * 2 + 1]!
        const rgb = hue((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1), saturation = Math.min(1, Math.hypot(dx, dy) / 8)
        paint(pixels, i, mode === 'validity' ? [235, 248, 243] : rgb.map(v => 245 * (1 - saturation) + v * saturation))
      }
    } else if (mode === 'cells') {
      const grid = pair?.grids.find(g => g.cellSize === cellSize)
      if (pair && !grid) throw new Error('Pool motion before inspecting this cell size')
      for (const cell of grid?.cells ?? []) {
        const rgb = cell.coherent && cell.dx !== null && cell.dy !== null ? hue((Math.atan2(cell.dy, cell.dx) / (2 * Math.PI) + 1) % 1) : cell.accepted ? [230, 170, 40] : [90, 65, 90]
        cellPaint(pixels, cell, rgb, .55)
        for (let x = cell.x; x < cell.x + cell.width; x++) paint(pixels, cell.y * width + x, [20, 20, 20], .6)
        for (let y = cell.y; y < cell.y + cell.height; y++) paint(pixels, y * width + cell.x, [20, 20, 20], .6)
      }
    } else if (pair) {
      const grid = regionalFineGrid(pair)
      const observations = mode === 'events' ? data.analysis!.frames[index]?.observations : data.tracks!.frames[index]?.observations
      for (const observation of observations ?? []) {
        const event = 'event' in observation ? observation.event as DrawingEvent : undefined
        const rgb = mode === 'events' ? event?.status === 'held' ? [61, 211, 139] : event?.status === 'changed' ? [246, 87, 72] : [150, 150, 165] : color(observation.id)
        for (const c of observation.cells) if (grid.cells[c]) cellPaint(pixels, grid.cells[c]!, rgb, .6)
      }
    }
    return pixels
  }
  const valid = pair ? pair.flow.valid.reduce((sum, v) => sum + Number(v !== 0), 0) : 0
  const events = data.analysis?.frames[index]?.observations ?? []
  const summary = [`Source ${sourceFrame}${pair ? ` -> ${sourceFrame + 1}` : ': final frame, no outgoing pair'}`, `${valid}/${width * height} supported flow pixels`, ...events.map(o => `Group ${o.id}: ${o.event.status}; ${o.event.reason}`)].join('\n')
  if (view !== 'review') return { width, height, pixels: panel(view), summary }
  const pixels = new Uint8Array(width * height * 16)
  const modes = ['source', 'flow', 'tracks', 'events'] as const
  for (let p = 0; p < modes.length; p++) {
    const part = panel(modes[p]!), ox = p % 2 * width, oy = Math.floor(p / 2) * height
    for (let y = 0; y < height; y++) pixels.set(part.subarray(y * width * 4, (y + 1) * width * 4), ((y + oy) * width * 2 + ox) * 4)
  }
  return { width: width * 2, height: height * 2, pixels, summary: `Top: source / flow. Bottom: motion groups / drawing events.\n${summary}` }
}

/** Unknown boundaries break completed holds; no forced on-2s or on-3s classification. */
const renderTiming = (data: RegionalData, sourceFrame: number, page: number): RegionalRaster => {
  const analysis = data.analysis!, pageSize = 32, groups = analysis.groups.slice(page * pageSize, (page + 1) * pageSize)
  if (!Number.isSafeInteger(page) || page < 0 || page > 0 && !groups.length) throw new RangeError('Timing group page is outside the observed groups')
  const count = data.scene.frames.length - 1, column = Math.max(2, Math.min(12, Math.floor(960 / count)))
  const left = 64, top = 30, row = 18, width = Math.max(384, left + count * column + 8), height = Math.max(96, top + groups.length * row + 28)
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) pixels.set([24, 25, 27, 255], i * 4)
  const labels = [{ x: left, y: 18, text: `${data.scene.first} -> ${data.scene.last} | source pair` }]
  const lines = [`Group page ${page}: ${groups.length}/${analysis.groups.length} groups`, 'H held / C changed / ? unknown. Patterns follow source-pair order.']
  const observations = analysis.frames.map(f => new Map(f.observations.map(o => [o.id, o.event.status])))
  for (const [r, group] of groups.entries()) {
    labels.push({ x: 4, y: top + r * row + 12, text: `G${group.id}` })
    const pattern: string[] = []
    for (let f = 0; f < count; f++) {
      const status = observations[f]?.get(group.id) ?? 'unknown'
      const rgb = status === 'held' ? [61, 211, 139] : status === 'changed' ? [246, 87, 72] : [102, 102, 118]
      pattern.push(status === 'held' ? 'H' : status === 'changed' ? 'C' : '?')
      for (let y = top + r * row; y < top + (r + 1) * row - 3; y++) for (let x = left + f * column; x < left + (f + 1) * column - Number(column > 3); x++) pixels.set([...rgb, 255], (y * width + x) * 4)
    }
    const changes = group.timing.changeFrames.map(f => f + data.scene.first)
    lines.push(`G${group.id}: ${pattern.join('')}`, `Changes: ${changes.join(', ') || 'none'}; completed hold lengths: ${JSON.stringify(group.timing.holdLengthHistogram)}`)
  }
  const cursor = sourceFrame - data.scene.first
  if (cursor < count) for (let y = top - 3; y < Math.min(height, top + groups.length * row); y++) pixels.set([255, 255, 255, 255], (y * width + left + cursor * column) * 4)
  labels.push({ x: 4, y: height - 9, text: `G = motion group | frame ${sourceFrame}` })
  if (!groups.length) labels.push({ x: 4, y: 50, text: 'No supported motion groups' })
  return { width, height, pixels, labels, summary: lines.join('\n') }
}

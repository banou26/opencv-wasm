import type { AnalysisFrame, MotionCell, DrawingEvent } from 'cadence/regional'
import { motionComparisonEvidence, regionalFineGrid } from 'cadence/regional'
import type { RegionalData } from './regional-data'

export type RegionalView = 'source' | 'flow' | 'validity' | 'cells' | 'tracks' | 'families' | 'velocities' | 'conflicts' | 'events' | 'timeline' | 'review'
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
export const renderRegional = (data: RegionalData, sourceFrame: number, view: RegionalView, cellSize: number, groupPage = 0, displaySource?: AnalysisFrame): RegionalRaster => {
  const index = sourceFrame - data.scene.first, source = data.scene.frames[index]
  if (!Number.isSafeInteger(sourceFrame) || !source) throw new RangeError(`Source frame must be in the analyzed range ${data.scene.first} to ${data.scene.last}`)
  const { width: analysisWidth, height: analysisHeight } = source, pair = data.sequence?.pairs[index]
  if (view !== 'source' && !data.sequence) throw new Error('This view requires dense motion data')
  if ((view === 'tracks' || view === 'events' || view === 'review' || view === 'conflicts') && !data.tracks) throw new Error('This view requires whole-scene tracks')
  if ((view === 'events' || view === 'review' || view === 'timeline') && !data.analysis) throw new Error('This view requires drawing events')
  if ((view === 'families' || view === 'velocities' || view === 'conflicts') && !data.families) throw new Error('This view requires motion-history grouping')
  if (view === 'timeline') return renderTiming(data, sourceFrame, groupPage)
  if (view === 'velocities') return renderVelocities(data, sourceFrame, groupPage)
  if (view === 'conflicts') return renderConflicts(data, sourceFrame, groupPage)
  const displayed = displaySource ?? source, { width, height } = displayed
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || displayed.data.length !== width * height * 3) throw new RangeError('Display source must contain a complete BGR image')
  const sourcePixels = (): Uint8Array => {
    const result = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      result[i * 4] = displayed.data[i * 3 + 2]!; result[i * 4 + 1] = displayed.data[i * 3 + 1]!; result[i * 4 + 2] = displayed.data[i * 3]!; result[i * 4 + 3] = 255
    }
    return result
  }
  // Half-open analysis rectangles share exact display boundaries, even at odd scale ratios.
  const paintRect = (pixels: Uint8Array, x0: number, y0: number, x1: number, y1: number, rgb: readonly number[], opacity: number) => {
    const left = Math.max(0, Math.ceil(x0 * width / analysisWidth)), right = Math.min(width, Math.ceil(x1 * width / analysisWidth))
    const top = Math.max(0, Math.ceil(y0 * height / analysisHeight)), bottom = Math.min(height, Math.ceil(y1 * height / analysisHeight))
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c]! * (1 - opacity) + rgb[c]! * opacity)
      pixels[i + 3] = 255
    }
  }
  const paint = (pixels: Uint8Array, i: number, rgb: readonly number[], opacity = 1) => {
    const x = i % analysisWidth, y = Math.floor(i / analysisWidth)
    paintRect(pixels, x, y, x + 1, y + 1, rgb, opacity)
  }
  const cellPaint = (pixels: Uint8Array, cell: MotionCell, rgb: readonly number[], opacity: number) => {
    paintRect(pixels, cell.x, cell.y, cell.x + cell.width, cell.y + cell.height, rgb, opacity)
  }
  const panel = (mode: Exclude<RegionalView, 'review' | 'timeline' | 'velocities' | 'conflicts'>): Uint8Array => {
    const pixels = sourcePixels()
    if (mode === 'source') return pixels
    if (mode === 'flow' || mode === 'validity') {
      for (let i = 0; i < analysisWidth * analysisHeight; i++) {
        if (!pair?.flow.valid[i]) {
          const bright = ((i % analysisWidth >> 3) + (Math.floor(i / analysisWidth) >> 3)) % 2
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
        for (let x = cell.x; x < cell.x + cell.width; x++) paint(pixels, cell.y * analysisWidth + x, [20, 20, 20], .6)
        for (let y = cell.y; y < cell.y + cell.height; y++) paint(pixels, y * analysisWidth + cell.x, [20, 20, 20], .6)
      }
    } else if (pair) {
      const grid = regionalFineGrid(pair)
      const observations = mode === 'events' ? data.analysis!.frames[index]?.observations : mode === 'families' ? data.families!.frames[index]?.observations : data.tracks!.frames[index]?.observations
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
  const familySummary = data.families ? [
    `${data.tracks!.groups.length} original regions -> ${data.families.families.length} motion families; support only, not silhouettes`,
    ...data.families.families.map(family => {
      const observed = data.families!.frames[index]?.observations.find(o => o.id === family.id)
      return `Family ${family.id}: regions ${family.regionIds.join(', ')}; ${observed ? `present ${observed.regionIds.join(', ')}; dx ${observed.dx.toFixed(3)}, dy ${observed.dy.toFixed(3)} analysis px/pair` : 'unobserved in this pair'}`
    }),
  ] : []
  const summary = [`Source ${sourceFrame}${pair ? ` -> ${sourceFrame + 1}` : ': final frame, no outgoing pair'}`, `${width} x ${height} display / ${analysisWidth} x ${analysisHeight} analysis`, `${valid}/${analysisWidth * analysisHeight} supported flow pixels`, ...familySummary, ...events.map(o => `Group ${o.id}: ${o.event.status}; ${o.event.reason}`)].join('\n')
  if (view !== 'review') return { width, height, pixels: panel(view), summary }
  const pixels = new Uint8Array(width * height * 16)
  const modes = ['source', 'flow', data.families ? 'families' : 'tracks', 'events'] as const
  for (let p = 0; p < modes.length; p++) {
    const part = panel(modes[p]!), ox = p % 2 * width, oy = Math.floor(p / 2) * height
    for (let y = 0; y < height; y++) pixels.set(part.subarray(y * width * 4, (y + 1) * width * 4), ((y + oy) * width * 2 + ox) * 4)
  }
  return { width: width * 2, height: height * 2, pixels, summary: `Top: source / flow. Bottom: ${data.families ? 'motion families / original-region drawing events' : 'motion groups / drawing events'}.\n${summary}` }
}

/** Measured velocities only: gaps are left blank, never filled with zero or joined. */
const renderVelocities = (data: RegionalData, sourceFrame: number, page: number): RegionalRaster => {
  const grouped = data.families!, pageSize = 8, families = grouped.families.slice(page * pageSize, (page + 1) * pageSize)
  if (!Number.isSafeInteger(page) || page < 0 || page > 0 && !families.length) throw new RangeError('Group page is outside the observed motion families')
  const count = data.scene.frames.length - 1, column = Math.max(2, Math.min(12, Math.floor(960 / count)))
  const left = 70, top = 42, row = 64, width = Math.max(384, left + count * column + 8), height = Math.max(128, top + families.length * row + 28)
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) pixels.set([24, 25, 27, 255], i * 4)
  const observations = grouped.frames.map(frame => new Map(frame.observations.map(observation => [observation.id, observation])))
  const visible = new Set(families.map(family => family.id))
  const scale = Math.max(1, ...grouped.frames.flatMap(frame => frame.observations.filter(observation => visible.has(observation.id)).flatMap(observation => [Math.abs(observation.dx), Math.abs(observation.dy)])))
  const labels = [{ x: left, y: 16, text: `dx teal / dy amber | +/-${scale.toFixed(2)} analysis px/pair` }, { x: left, y: 32, text: `${data.scene.first} -> ${data.scene.last} | blank = unobserved` }]
  const lines = [`Family page ${page}: ${families.length}/${grouped.families.length} motion families`, 'dx,dy are analysis pixels per source pair; ? is unobserved, not zero.']
  for (const [r, family] of families.entries()) {
    const baseline = top + r * row + row / 2
    labels.push({ x: 4, y: baseline + 4, text: `F${family.id}` })
    const history: string[] = []
    for (let f = 0; f < count; f++) {
      const observation = observations[f]?.get(family.id), x = left + f * column
      for (let xx = x; xx < x + column; xx++) pixels.set([57, 60, 63, 255], (baseline * width + xx) * 4)
      history.push(observation ? `${f + data.scene.first}:${observation.dx.toFixed(3)},${observation.dy.toFixed(3)}` : `${f + data.scene.first}:?`)
      if (!observation) continue
      for (const [value, rgb] of [[observation.dy, [240, 178, 72]], [observation.dx, [66, 220, 183]]] as const) {
        const y = baseline - Math.round(value / scale * (row / 2 - 8))
        for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x; xx < x + Math.max(1, column - 1); xx++) pixels.set([...rgb, 255], (yy * width + xx) * 4)
      }
    }
    lines.push(`F${family.id}: regions ${family.regionIds.join(', ')}`, history.join(' | '))
  }
  const cursor = sourceFrame - data.scene.first
  if (cursor < count) for (let y = top; y < top + families.length * row; y++) pixels.set([255, 255, 255, 255], (y * width + left + cursor * column) * 4)
  labels.push({ x: 4, y: height - 9, text: `Frame ${sourceFrame} | every member must agree over shared pairs` })
  if (!families.length) labels.push({ x: left, y: 68, text: 'No supported motion families' })
  return { width, height, pixels, labels, summary: lines.join('\n') }
}

/** Show the original motion veto beside drawing evidence without changing either. */
const renderConflicts = (data: RegionalData, sourceFrame: number, page: number): RegionalRaster => {
  const { pairCount, comparisons } = motionComparisonEvidence(data.tracks!, data.families!, data.analysis, page)
  const count = data.scene.frames.length - 1, column = Math.max(2, Math.min(12, Math.floor(960 / count)))
  const left = 88, top = 58, row = 64, width = Math.max(640, left + count * column + 12), height = Math.max(144, top + comparisons.length * row + 28)
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) pixels.set([24, 25, 27, 255], i * 4)
  const tolerance = data.families!.options.tolerance
  const scale = Math.max(1, tolerance, ...comparisons.map(comparison => comparison.maximum)) * 1.1
  const cursor = sourceFrame - data.scene.first
  const current = cursor < count ? `Source ${sourceFrame} -> ${sourceFrame + 1}` : `Source ${sourceFrame}: final frame, no outgoing pair`
  const labels = [
    { x: left, y: 16, text: 'Raw error | red: C/C | green: H/H | gray: other/unknown' },
    { x: left, y: 32, text: `Amber guide: ${tolerance.toFixed(3)} | scale: ${scale.toFixed(3)} analysis px/pair` },
    { x: left, y: 48, text: 'C = changed, H = held | blank = no shared motion sample' },
  ]
  const lines = [`Conflict page ${page}: ${comparisons.length}/${pairCount} raw-veto pairs`, current,
    'Sorted by mean raw velocity error; every shared sample still participates in the veto.',
    'C/C red: both changed; H/H green: both held; gray: mixed, unknown or missing timing. Blank: no shared motion sample.']
  for (const [r, comparison] of comparisons.entries()) {
    const baseline = top + r * row + row - 10, plotHeight = row - 20
    const samples = new Map(comparison.samples.map(sample => [sample.frame, sample]))
    const event = (status: DrawingEvent['status'] | null) => status ?? 'null (not measured)'
    const describe = (sample: (typeof comparison.samples)[number]) => `error ${sample.error.toFixed(3)}; A ${sample.dxA.toFixed(3)},${sample.dyA.toFixed(3)}; B ${sample.dxB.toFixed(3)},${sample.dyB.toFixed(3)}; events ${event(sample.eventA)}/${event(sample.eventB)}; ${sample.veto ? 'VETO' : 'within tolerance'}`
    labels.push({ x: 4, y: baseline - 15, text: `G${comparison.a}/${comparison.b}` })
    const history: string[] = []
    for (let f = 0; f < count; f++) {
      const sample = samples.get(f), x = left + f * column, absolute = f + data.scene.first
      for (let xx = x; xx < x + column; xx++) pixels.set([57, 60, 63, 255], (baseline * width + xx) * 4)
      history.push(`${absolute}->${absolute + 1}: ${sample ? describe(sample) : '? (unobserved)'}`)
      if (!sample) continue
      const rgb = sample.eventA === 'changed' && sample.eventB === 'changed' ? [246, 87, 72]
        : sample.eventA === 'held' && sample.eventB === 'held' ? [61, 211, 139] : [150, 150, 165]
      const y = baseline - Math.max(1, Math.round(sample.error / scale * plotHeight))
      for (let yy = y; yy < baseline; yy++) for (let xx = x; xx < x + Math.max(1, column - 1); xx++) pixels.set([...rgb, 255], (yy * width + xx) * 4)
    }
    const guide = baseline - Math.round(comparison.tolerance / scale * plotHeight)
    for (let x = left; x < left + count * column; x++) if ((x - left) % 4 < 2) pixels.set([240, 178, 72, 255], (guide * width + x) * 4)
    const vetoes = comparison.samples.filter(sample => sample.veto).length
    lines.push(`G${comparison.a}/${comparison.b}: families F${comparison.familyA}/F${comparison.familyB}; mean ${comparison.error.toFixed(3)}; maximum ${comparison.maximum.toFixed(3)}; tolerance ${comparison.tolerance.toFixed(3)}; vetoes ${vetoes}/${comparison.samples.length} shared pairs`)
    if (cursor < count) lines.push(`Current ${sourceFrame}->${sourceFrame + 1}: ${samples.has(cursor) ? describe(samples.get(cursor)!) : '? (unobserved)'}`)
    lines.push(history.join(' | '))
  }
  if (cursor < count) for (let y = top; y < top + comparisons.length * row; y++) pixels.set([255, 255, 255, 255], (y * width + left + cursor * column) * 4)
  labels.push({ x: 4, y: height - 9, text: current })
  if (!comparisons.length) labels.push({ x: left, y: 88, text: 'No raw motion conflicts' })
  return { width, height, pixels, labels, summary: lines.join('\n') }
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

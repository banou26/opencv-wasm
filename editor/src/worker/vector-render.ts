import type { AnalysisFrame } from 'cadence/regional'
import type { RegionalData } from './regional-data'
import { regionalCanvas } from './regional-render'

export const groupColor = (id: number): [number, number, number] => {
  const hue = (.61 + id * .61803398875) % 1, sector = hue * 6, fraction = sector - Math.floor(sector)
  const low = 45, high = 231, falling = Math.round(high - (high - low) * fraction), rising = Math.round(low + (high - low) * fraction)
  return [[high, rising, low], [falling, high, low], [low, high, rising], [low, falling, high], [rising, low, high], [high, low, falling]][Math.floor(sector)]! as [number, number, number]
}
const CONFIDENCE = [[102, 106, 113], [238, 177, 65], [63, 216, 180]] as const

/** Motion proposals stay distinct from observed pixels and from ownership/silhouette claims. */
export const renderVectorPanels = (data: RegionalData, sourceFrame: number, displaySource?: AnalysisFrame, gain = 3) => {
  if (!['vector-candidates', 'vector-groups'].includes(data.stage) || !data.sequence) throw new Error('Direct motion inspection requires vector candidates or vector groups')
  if (data.stage === 'vector-groups' && !data.frameVectorGroups) throw new Error('Frame-local group data is required; recompute legacy direct-motion groups')
  if (!Number.isFinite(gain) || gain < .1 || gain > 20) throw new RangeError('Vector display gain must be between 0.1 and 20')
  const { index, width, height, analysisWidth, analysisHeight, sourcePixels, paintRect } = regionalCanvas(data, sourceFrame, displaySource)
  const pair = data.sequence.pairs.find(pair => pair.frame === index), grid = pair?.grids[0]
  const grouped = data.frameVectorGroups?.frames.find(frame => frame.frame === index)
  if (pair && data.frameVectorGroups && !grouped) throw new Error('Frame-local groups are missing for this candidate pair')
  const panels = { source: sourcePixels(), candidates: sourcePixels(), groups: sourcePixels(), confidence: sourcePixels() }
  const counts = [0, 0, 0]
  let candidates = 0, mixed = 0, assigned = 0
  const dot = (x: number, y: number, rgb: readonly number[], radius = 0) => {
    const cx = Math.round(x), cy = Math.round(y)
    for (let py = cy - radius; py <= cy + radius; py++) for (let px = cx - radius; px <= cx + radius; px++) {
      if (px < 0 || px >= width || py < 0 || py >= height) continue
      panels.candidates.set([...rgb, 255], (py * width + px) * 4)
    }
  }
  const line = (x: number, y: number, tx: number, ty: number, rgb: readonly number[]) => {
    const steps = Math.ceil(Math.max(Math.abs(tx - x), Math.abs(ty - y)))
    for (let step = 0; step <= steps; step++) {
      const t = steps ? step / steps : 0
      dot(x + (tx - x) * t, y + (ty - y) * t, rgb)
    }
  }
  for (const [id, cell] of (grid?.cells ?? []).entries()) {
    const valid = cell.dx !== null && cell.dy !== null && Number.isFinite(cell.dx) && Number.isFinite(cell.dy)
    const confidence = grouped ? grouped.confidence[id]! : valid ? cell.coherent ? 2 : 1 : 0
    const label = grouped?.labels[id] ?? -1
    if (grouped && (valid !== (label >= 0) || confidence !== (valid ? cell.coherent ? 2 : 1 : 0))) throw new Error('Frame-local grouping must preserve every candidate and its confidence')
    counts[confidence]!++
    paintRect(panels.confidence, cell.x, cell.y, cell.x + cell.width, cell.y + cell.height, CONFIDENCE[confidence]!, .6)
    if (label >= 0) {
      assigned++
      paintRect(panels.groups, cell.x, cell.y, cell.x + cell.width, cell.y + cell.height, groupColor(label), confidence === 1 ? .38 : .6)
    }
    if (!valid) continue
    candidates++; mixed += Number(!cell.coherent)
    const rgb = cell.coherent ? CONFIDENCE[2] : CONFIDENCE[1]
    const x = (cell.x + cell.width / 2) * width / analysisWidth, y = (cell.y + cell.height / 2) * height / analysisHeight
    const dx = cell.dx! * gain * width / analysisWidth, dy = cell.dy! * gain * height / analysisHeight
    // Bound drawn arrow length, not the measurement; extreme estimates cannot monopolize a raster.
    const factor = Math.min(1, Math.max(width, height) / Math.max(1, Math.hypot(dx, dy)))
    const tx = x + dx * factor, ty = y + dy * factor, angle = Math.atan2(dy, dx), head = Math.min(7, Math.hypot(tx - x, ty - y) * .4)
    line(x, y, tx, ty, rgb)
    if (head >= 1) for (const side of [-.6, .6]) line(tx, ty, tx - Math.cos(angle + side) * head, ty - Math.sin(angle + side) * head, rgb)
    dot(x, y, [242, 188, 133], width >= 640 ? 1 : 0)
  }
  const summary = [
    `Source ${sourceFrame}${pair ? ` -> ${sourceFrame + 1}` : ': final frame, no outgoing pair'}`,
    `${width} x ${height} display / ${analysisWidth} x ${analysisHeight} analysis`,
    `Candidate vectors: ${candidates}; mixed/weak ${mixed}; cell size ${grid?.cellSize ?? data.sequence.pairs[0]?.grids[0]?.cellSize ?? '?'}`,
    'Candidate arrows: teal coherent; amber mixed/weak. Display gain changes arrow length only.',
    data.vectorBorderCorrections ? `Border vector verification: enabled; ${data.vectorBorderCorrections.find(entry => entry.frame === index)?.corrections.length ?? 0} corrected cells; original dense flow retained.` : 'Border vector verification: disabled; original pooled vectors.',
    grouped ? `Candidate cells: ${candidates}; grouped cells: ${assigned}; temporal filtering: none\nConfidence cells: unknown ${counts[0]}; mixed assigned ${counts[1]}; coherent assigned ${counts[2]}`
      : `Ungrouped candidate confidence: unknown ${counts[0]}; weak ${counts[1]}; coherent ${counts[2]}. Motion-group panel is unpainted before grouping.`,
    'Confidence colors: gray missing vector; amber mixed; teal coherent.',
    'No hole filling. Group colors are motion proposals, not pixel ownership or recovered artwork.',
    ...(data.frameVectorGroups ? [`${grouped?.observations.length ?? 0} frame-local motion groups; maximum radius ${data.frameVectorGroups.options.tolerance} analysis pixels/pair`, `Subtle motion separation: ${data.frameVectorGroups.options.splitSubtleMotion ? 'enabled' : 'disabled'}; candidate support preserved`, `Distant region separation: ${data.frameVectorGroups.options.splitDistantRegions ? 'enabled' : 'disabled'}; foreground gap ${data.frameVectorGroups.options.proximityGap} cells; dominant background unchanged`, 'Velocities are recomputed per pair, allowing easing and direction changes.', 'Group IDs and colors are frame-local, not tracked identities. Candidate arrows show the vectors used for grouping.'] : []),
    ...(grouped?.observations ?? []).map(observation => `Group ${observation.id}: ${observation.cells.length} cells; ${observation.strongCells} coherent; velocity ${observation.dx.toFixed(3)}, ${observation.dy.toFixed(3)}; parent motion ${observation.motionId}`),
    ...(data.vectorBorderCorrections?.find(entry => entry.frame === index)?.corrections ?? []).map(correction => `Border cell ${correction.cell}: ${correction.original.dx.toFixed(3)}, ${correction.original.dy.toFixed(3)} -> ${correction.replacement.dx.toFixed(3)}, ${correction.replacement.dy.toFixed(3)}; footprint MAE ${correction.footprint.candidate.mae.toFixed(3)} -> ${correction.footprint.reference.mae.toFixed(3)} (${correction.footprint.compared} observed); context MAE ${correction.context.candidate.mae.toFixed(3)} -> ${correction.context.reference.mae.toFixed(3)} (${correction.context.compared} observed)`),
  ].join('\n')
  return { width, height, panels, summary }
}

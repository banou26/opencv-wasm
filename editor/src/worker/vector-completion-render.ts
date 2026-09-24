import type { AnalysisFrame } from 'cadence/regional'
import type { RegionalData } from './regional-data'
import { regionalCanvas } from './regional-render'
import { groupColor } from './vector-render'

const PROVENANCE = [[0, 0, 0], [150, 150, 165], [240, 178, 72], [66, 220, 183]] as const

/** Inferred support is displayed separately and never becomes measured motion evidence. */
export const renderVectorCompletionPanels = (data: RegionalData, sourceFrame: number, displaySource?: AnalysisFrame) => {
  if (data.stage !== 'vector-completion' || !data.frameVectorGroups || !data.frameVectorSupport) throw new Error('Direct completion inspection requires completed frame-vector support')
  const { index, width, height, analysisWidth, analysisHeight, sourcePixels, paintRect } = regionalCanvas(data, sourceFrame, displaySource)
  const completion = data.frameVectorSupport, frame = completion.frames.find(frame => frame.frame === index)
  const measured = data.frameVectorGroups.frames.find(frame => frame.frame === index)
  const panels = { source: sourcePixels(), measured: sourcePixels(), completed: sourcePixels(), provenance: sourcePixels() }
  if (completion.width !== analysisWidth || completion.height !== analysisHeight || completion.cellSize !== data.frameVectorGroups.cellSize) throw new Error('Direct completion geometry does not match measured groups')
  if (index < data.scene.frames.length - 1 && (!frame || !measured)) throw new Error('Direct completion is missing an analyzed pair')
  if (frame && measured) {
    const cells = completion.columns * completion.rows, known = new Set(measured.observations.map(group => group.id))
    if (frame.labels.length !== cells || frame.provenance.length !== cells || measured.labels.length !== cells) throw new Error('Direct completion grid is incomplete')
    for (let cell = 0; cell < cells; cell++) {
      const raw = measured.labels[cell]!, label = frame.labels[cell]!, provenance = frame.provenance[cell]!
      if (raw >= 0 ? label !== raw || provenance !== 1 : provenance === 1 || provenance > 3 || (label >= 0 ? provenance < 2 || !known.has(label) : provenance !== 0)) throw new Error('Direct completion must preserve measured labels and identify every inference')
      const x = cell % completion.columns * completion.cellSize, y = Math.floor(cell / completion.columns) * completion.cellSize
      const right = Math.min(analysisWidth, x + completion.cellSize), bottom = Math.min(analysisHeight, y + completion.cellSize)
      if (raw >= 0) paintRect(panels.measured, x, y, right, bottom, groupColor(raw), measured.confidence[cell] === 1 ? .38 : .6)
      if (label >= 0) paintRect(panels.completed, x, y, right, bottom, groupColor(label), raw >= 0 && measured.confidence[cell] === 1 ? .38 : .6)
      if (provenance > 0) paintRect(panels.provenance, x, y, right, bottom, PROVENANCE[provenance]!, .6)
    }
  }
  const summary = [
    `Source ${sourceFrame}${frame ? ` -> ${sourceFrame + 1}` : ': final frame, no outgoing pair'}`,
    `${width} x ${height} display / ${analysisWidth} x ${analysisHeight} analysis`,
    `Cell size ${completion.cellSize}; ${completion.columns} columns; ${completion.rows} rows`,
    frame ? `Cells: measured ${frame.counts.measured}; inferred holes ${frame.counts.holes}; inferred edge ${frame.counts.border}; unknown ${frame.counts.unknown}` : 'No outgoing pair: no completion evidence.',
    'Provenance: gray measured; amber enclosed-hole inference; teal edge inference; unpainted unknown.',
    'Measured groups, velocities and confidence remain unchanged. Inferred cells have no measured motion.',
    'Completed support is not a recovered layer silhouette or recovered pixels. Group IDs remain frame-local.',
    'Completion order: preserve 75% measured-edge majorities; otherwise use the largest touching group. Resolve corners by original measured size, then fill enclosed holes until stable.',
    'Hole owner: largest touching group by original measured frame-wide cell count; equal sizes choose the lowest ID. Inferred area does not vote.',
    `Enclosed holes: ${completion.options.fillHoles ? 'enabled' : 'disabled'}; edge extension: ${completion.options.fillEdges ? 'enabled' : 'disabled'}; edge reach ${completion.options.edgeReach} cells`,
    ...(frame?.observations ?? []).map(group => `Group ${group.id}: inferred holes ${group.holeCells.length}; inferred edge ${group.borderCells.length}`),
  ].join('\n')
  return { width, height, panels, summary }
}

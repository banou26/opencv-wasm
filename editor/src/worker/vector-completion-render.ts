import type { AnalysisFrame, FrameVectorIdentities, FrameVectorFragments } from 'cadence/regional'
import type { RegionalData } from './regional-data'
import { regionalCanvas } from './regional-render'
import { groupColor } from './vector-render'
import { fragmentDisplayFrame } from './vector-fragment-render'

const PROVENANCE = [[0, 0, 0], [150, 150, 165], [240, 178, 72], [66, 220, 183]] as const

/** Inferred support is displayed separately and never becomes measured motion evidence. */
export const renderVectorCompletionPanels = (data: RegionalData, sourceFrame: number, displaySource?: AnalysisFrame, identities?: FrameVectorIdentities, fragments?: FrameVectorFragments) => {
  if (!['vector-completion', 'vector-fragments'].includes(data.stage) || !data.frameVectorGroups || !data.frameVectorSupport) throw new Error('Direct completion inspection requires completed frame-vector support')
  const { index, width, height, analysisWidth, analysisHeight, sourcePixels, paintRect } = regionalCanvas(data, sourceFrame, displaySource)
  const completion = data.frameVectorSupport, frame = completion.frames.find(frame => frame.frame === index)
  const measured = data.frameVectorGroups.frames.find(frame => frame.frame === index)
  const identityFrame = identities?.frames.find(frame => frame.frame === index), mapping = new Map<number, number>()
  const panels = { source: sourcePixels(), measured: sourcePixels(), completed: sourcePixels(), provenance: sourcePixels() }
  if (completion.width !== analysisWidth || completion.height !== analysisHeight || completion.cellSize !== data.frameVectorGroups.cellSize) throw new Error('Direct completion geometry does not match measured groups')
  if (index < data.scene.frames.length - 1 && (!frame || !measured)) throw new Error('Direct completion is missing an analyzed pair')
  if (identities && (identities.width !== analysisWidth || identities.height !== analysisHeight || identities.frameCount !== completion.frameCount || identities.cellSize !== completion.cellSize)) throw new Error('Identity geometry does not match completed support')
  if (fragments && !identities) throw new Error('Fragment display requires stable identity colors')
  if (identities && frame && measured) {
    if (!identityFrame) throw new Error('Identity mapping is missing an analyzed pair')
    const known = new Set(measured.observations.map(group => group.id)), assigned = new Set<number>()
    for (const observation of identityFrame.observations) {
      const { groupId, trackId } = observation
      if (!known.has(groupId) || mapping.has(groupId) || !Number.isSafeInteger(trackId) || trackId < 0 || assigned.has(trackId) || (groupId === 0) !== (trackId === 0)) throw new Error('Identity mapping must preserve background and cover each group one-to-one')
      mapping.set(groupId, trackId); assigned.add(trackId)
    }
    if (mapping.size !== known.size) throw new Error('Identity mapping must cover every measured group')
  }
  const colorId = (label: number) => identities ? mapping.get(label)! : label
  const fragmentFrame = fragments && frame && measured ? fragmentDisplayFrame(fragments, completion, frame, measured, mapping) : undefined
  if (frame && measured) {
    const cells = completion.columns * completion.rows, known = new Set(measured.observations.map(group => group.id))
    if (frame.labels.length !== cells || frame.provenance.length !== cells || measured.labels.length !== cells) throw new Error('Direct completion grid is incomplete')
    for (let cell = 0; cell < cells; cell++) {
      const raw = measured.labels[cell]!, label = frame.labels[cell]!, provenance = frame.provenance[cell]!
      if (raw >= 0 ? label !== raw || provenance !== 1 : provenance === 1 || provenance > 3 || (label >= 0 ? provenance < 2 || !known.has(label) : provenance !== 0)) throw new Error('Direct completion must preserve measured labels and identify every inference')
      const x = cell % completion.columns * completion.cellSize, y = Math.floor(cell / completion.columns) * completion.cellSize
      const right = Math.min(analysisWidth, x + completion.cellSize), bottom = Math.min(analysisHeight, y + completion.cellSize)
      if (raw >= 0) paintRect(panels.measured, x, y, right, bottom, groupColor(colorId(raw)), measured.confidence[cell] === 1 ? .38 : .6)
      if (label >= 0) paintRect(panels.completed, x, y, right, bottom, groupColor(fragmentFrame?.trackLabels[cell] ?? colorId(label)), raw >= 0 && measured.confidence[cell] === 1 ? .38 : .6)
      if (provenance > 0) paintRect(panels.provenance, x, y, right, bottom, fragmentFrame?.merged[cell] ? [235, 95, 160] : PROVENANCE[provenance]!, .6)
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
    'Completion order: preserve established 75% edge and bounded support; extend only remaining unknown edges and corners, then fill enclosed holes until stable.',
    'Hole owner: largest touching group by original measured frame-wide cell count; equal sizes choose the lowest ID. Inferred area does not vote.',
    `Enclosed holes: ${completion.options.fillHoles ? 'enabled' : 'disabled'}; edge extension: ${completion.options.fillEdges ? 'enabled' : 'disabled'}; edge reach ${completion.options.edgeReach} cells`,
    ...(frame?.observations ?? []).map(group => `Group ${group.id}: inferred holes ${group.holeCells.length}; inferred edge ${group.borderCells.length}`),
    ...(identities ? [
      'Stable identity colors: enabled; raw group IDs and completed support remain unchanged.',
      `Identity options: max gap ${identities.options.maxGap} pairs; match radius ${identities.options.matchRadius} cells`,
      `Dormant tracks: ${identityFrame?.dormantTrackIds.join(', ') || 'none'}`,
      'Held background-only frames remain background. Dormant identities do not create foreground masks.',
      ...(identityFrame?.observations ?? []).map(observation => `Track ${observation.trackId}: local group ${observation.groupId}; previous source ${observation.previousFrame === null ? 'none' : observation.previousFrame + data.scene.first}; score ${observation.score === null ? 'new' : observation.score.toFixed(4)}`),
    ] : []),
    ...(fragments ? [
      `Transient fragment merging: ${fragments.options.enabled ? 'enabled' : 'disabled'}; merged cells ${fragmentFrame?.merged.reduce((sum, value) => sum + value, 0) ?? 0}; components ${fragmentFrame?.merges.length ?? 0}`,
      `Fragment limits: partial ${fragments.options.maxCells} measured cells; enclosed ${fragments.options.maxCells * 4}; ${fragments.options.maxRun} consecutive pairs`,
      'Pink provenance: inferred fragment membership. Source, measured groups, original completion and track associations remain unchanged.',
      ...(fragmentFrame?.merges ?? []).map(merge => `Merge: group ${merge.fromGroupId} -> ${merge.toGroupId}; track ${merge.fromTrackId} -> ${merge.toTrackId}; reason ${merge.reason}; run ${merge.runLength}; cells ${merge.cells.join(',')}; measured ${merge.measuredCells.join(',')}`),
    ] : []),
  ].join('\n')
  return { width, height, panels, summary }
}

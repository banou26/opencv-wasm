import type { FrameVectorFragments, FrameVectorGroups, FrameVectorSupport } from 'cadence/regional'

/** Validate derived membership independently before it can replace any display label. */
export const fragmentDisplayFrame = (
  fragments: FrameVectorFragments,
  support: FrameVectorSupport,
  completed: FrameVectorSupport['frames'][number],
  measured: FrameVectorGroups['frames'][number],
  mapping: Map<number, number>,
) => {
  for (const key of ['width', 'height', 'frameCount', 'cellSize', 'columns', 'rows'] as const) {
    if (fragments[key] !== support[key]) throw new Error('Fragment geometry does not match completed support')
  }
  const frame = fragments.frames.find(frame => frame.frame === completed.frame), cells = support.columns * support.rows
  if (!frame || frame.trackLabels.length !== cells || frame.merged.length !== cells) throw new Error('Fragment display is missing a complete analyzed pair')
  const listed = new Map<number, number>()
  for (const merge of frame.merges) {
    if (merge.fromGroupId <= 0 || merge.toGroupId <= 0 || merge.fromGroupId === merge.toGroupId || mapping.get(merge.fromGroupId) !== merge.fromTrackId || mapping.get(merge.toGroupId) !== merge.toTrackId) throw new Error('Fragment merge must reference distinct current foreground groups and tracks')
    if (!merge.cells.length || !Number.isSafeInteger(merge.runLength) || merge.runLength < 1 || !['enclosed', 'partial'].includes(merge.reason)) throw new Error('Fragment merge needs explicit component evidence')
    const measuredCells = new Set(merge.measuredCells)
    if (measuredCells.size !== merge.measuredCells.length) throw new Error('Fragment merge lists duplicate measured cells')
    for (const cell of merge.cells) {
      if (!Number.isSafeInteger(cell) || cell < 0 || cell >= cells || listed.has(cell) || completed.labels[cell] !== merge.fromGroupId || measuredCells.has(cell) !== (measured.labels[cell] === merge.fromGroupId)) throw new Error('Fragment merge cells must exactly identify the original component and its measurements')
      listed.set(cell, merge.toTrackId); measuredCells.delete(cell)
    }
    if (measuredCells.size) throw new Error('Fragment merge includes measurements outside its component')
  }
  if (!fragments.options.enabled && listed.size) throw new Error('Disabled fragment merging must preserve every display label')
  for (let cell = 0; cell < cells; cell++) {
    const raw = completed.labels[cell]!, expected = raw < 0 ? -1 : mapping.get(raw), replacement = listed.get(cell)
    if (frame.trackLabels[cell] !== (replacement ?? expected) || frame.merged[cell] !== Number(replacement !== undefined)) throw new Error('Fragment display must change only explicitly listed component cells')
  }
  return frame
}

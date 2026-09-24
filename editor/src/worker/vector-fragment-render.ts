import type { FrameVectorFragments, FrameVectorGroups, FrameVectorSupport } from 'cadence/regional'

const validateTemporalEvidence = (merge: FrameVectorFragments['frames'][number]['merges'][number], frame: number, frameCount: number) => {
  const evidence = merge.temporal ?? [], measured = new Set(merge.measuredCells), covered = new Set<number>()
  if ((merge.reason === 'temporal') !== (evidence.length > 0)) throw new Error('Temporal merge requires explicit temporal witnesses')
  for (const component of evidence) {
    const cells = new Set(component.cells)
    if (!cells.size || cells.size !== component.cells.length || component.cells.some(cell => !measured.has(cell) || covered.has(cell))) throw new Error('Temporal components must identify distinct original measured fragment cells')
    component.cells.forEach(cell => covered.add(cell))
    if (component.witnesses.length !== 2) throw new Error('Temporal merge requires two witness frames')
    const [a, b] = component.witnesses
    if (component.witnesses.some(witness => !Number.isSafeInteger(witness.frame) || witness.frame < 0 || witness.frame >= frameCount - 1 || Math.abs(witness.frame - frame) > 12)
      || !(a.frame < b.frame) || (component.mode === 'bracketed' ? !(a.frame < frame && b.frame > frame) : component.mode === 'birth' ? !(a.frame > frame && b.frame > frame) : true)) throw new Error('Temporal witness frames must match the declared evidence mode')
    const sets = component.witnesses.map(witness => new Set(witness.cells))
    for (let index = 0; index < 2; index++) if (sets[index]!.size !== component.witnesses[index]!.cells.length || component.witnesses[index]!.cells.some(cell => !cells.has(cell))) throw new Error('Temporal witness cells must stay within the current measured component')
    const common = new Set(component.commonCells), intersection = [...sets[0]!].filter(cell => sets[1]!.has(cell))
    if (common.size !== component.commonCells.length || common.size !== intersection.length || intersection.some(cell => !common.has(cell)) || common.size < cells.size * .75) throw new Error('Temporal common support must match both original witnesses')
  }
}

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
    if (!merge.cells.length || !Number.isSafeInteger(merge.runLength) || merge.runLength < 1 || !['enclosed', 'partial', 'temporal'].includes(merge.reason)) throw new Error('Fragment merge needs explicit component evidence')
    validateTemporalEvidence(merge, completed.frame, support.frameCount)
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

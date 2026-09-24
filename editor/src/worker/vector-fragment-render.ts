import type { FrameVectorFragments, FrameVectorGroups, FrameVectorSupport } from 'cadence/regional'

const validateClippedComponents = (cells: Set<number>, raw: Int32Array, id: number, columns: number, rows: number, maxCells: number) => {
  const seen = new Set<number>()
  for (const seed of cells) {
    if (seen.has(seed)) continue
    const component = [seed]; seen.add(seed)
    let edges = 0
    for (let cursor = 0; cursor < component.length; cursor++) {
      const cell = component[cursor]!, x = cell % columns, y = Math.floor(cell / columns)
      if (!cells.has(cell)) throw new Error('Clipped evidence must identify complete original measured components')
      edges |= Number(x === 0) | Number(x === columns - 1) * 2 | Number(y === 0) * 4 | Number(y === rows - 1) * 8
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= columns || y + dy < 0 || y + dy >= rows) continue
        const next = (y + dy) * columns + x + dx
        if (raw[next] === id && !seen.has(next)) { seen.add(next); component.push(next) }
      }
    }
    if (component.length > maxCells * 4 || !edges || (edges & (edges - 1))) throw new Error('Clipped evidence applies only to bounded components touching one frame edge')
  }
}

const validateTemporalEvidence = (merge: FrameVectorFragments['frames'][number]['merges'][number], frame: number, frameCount: number, maxCells: number, gridCells: number) => {
  const evidence = merge.temporal ?? [], measured = new Set(merge.measuredCells), covered = new Set<number>()
  if ((merge.reason === 'temporal') !== (evidence.length > 0)) throw new Error('Temporal merge requires explicit temporal witnesses')
  for (const component of evidence) {
    const cells = new Set(component.cells)
    if (!cells.size || cells.size !== component.cells.length || component.cells.some(cell => !measured.has(cell) || covered.has(cell))) throw new Error('Temporal components must identify distinct original measured fragment cells')
    component.cells.forEach(cell => covered.add(cell))
    if (component.witnesses.length !== 2) throw new Error('Temporal merge requires two witness frames')
    const [a, b] = component.witnesses
    if (component.mode === 'enclosure' && (cells.size <= maxCells * 4 || cells.size > maxCells * 8)) throw new Error('Enclosure witnesses apply only to enlarged measured components')
    if (['attachment', 'association'].includes(component.mode) && cells.size > maxCells * 4) throw new Error('Attachment and association witnesses apply only to bounded measured components')
    const matchingMode = component.mode === 'bracketed' || component.mode === 'association' ? a.frame < frame && b.frame > frame
      : component.mode === 'birth' ? a.frame > frame && b.frame > frame
        : component.mode === 'enclosure' ? (a.frame < frame && b.frame < frame) || (a.frame > frame && b.frame > frame)
          : component.mode === 'attachment' ? a.frame !== frame && b.frame !== frame : false
    if (component.witnesses.some(witness => !Number.isSafeInteger(witness.frame) || witness.frame < 0 || witness.frame >= frameCount - 1 || Math.abs(witness.frame - frame) > 12)
      || !(a.frame < b.frame) || !matchingMode) throw new Error('Temporal witness frames must match the declared evidence mode')
    const sets = component.witnesses.map(witness => new Set(witness.cells))
    for (let index = 0; index < 2; index++) if (sets[index]!.size !== component.witnesses[index]!.cells.length || component.witnesses[index]!.cells.some(cell => !cells.has(cell))) throw new Error('Temporal witness cells must stay within the current measured component')
    let enclosedComponents = 0
    for (const witness of component.witnesses) {
      if (component.mode !== 'association') {
        if (witness.hostCells !== undefined || witness.enclosed !== undefined) throw new Error('Enclosed donor components require association mode')
        continue
      }
      if (!Array.isArray(witness.hostCells) || !Array.isArray(witness.enclosed)) throw new Error('Association witnesses must identify direct host cells and enclosed donor components')
      const claimed = new Set<number>(), donorCells = new Set<number>(), witnessCells = new Set(witness.cells), donorHosts = new Set<number>()
      const claim = (currentCells: number[]) => {
        for (const cell of currentCells) {
          if (!witnessCells.has(cell) || claimed.has(cell)) throw new Error('Association evidence must partition current witness cells without overlap')
          claimed.add(cell)
        }
      }
      claim(witness.hostCells)
      for (const donor of witness.enclosed) {
        if (!Number.isSafeInteger(donor.groupId) || !Number.isSafeInteger(donor.hostGroupId) || donor.groupId <= 0 || donor.hostGroupId <= 0 || donor.groupId === donor.hostGroupId
          || !donor.cells.length || donor.cells.length > maxCells * 4 || !donor.currentCells.length) throw new Error('Association donor must identify a bounded original foreground component and distinct host')
        donorHosts.add(donor.hostGroupId)
        if (donorHosts.size > 1) throw new Error('Association donors in one frame must share their original host')
        for (const cell of donor.cells) {
          if (!Number.isSafeInteger(cell) || cell < 0 || cell >= gridCells || donorCells.has(cell)) throw new Error('Association donor components must contain distinct in-frame raw cells')
          donorCells.add(cell)
        }
        claim(donor.currentCells); enclosedComponents++
      }
      if (claimed.size !== witnessCells.size) throw new Error('Association metadata must account for every witness cell')
    }
    if (component.mode === 'association' && !enclosedComponents) throw new Error('Association mode requires enclosed donor support')
    const common = new Set(component.commonCells), intersection = [...sets[0]!].filter(cell => sets[1]!.has(cell))
    if (common.size !== component.commonCells.length || common.size !== intersection.length || intersection.some(cell => !common.has(cell)) || common.size < cells.size * .75) throw new Error('Temporal common support must match both original witnesses')
  }
  if (merge.reason === 'temporal' && covered.size !== measured.size) throw new Error('Temporal evidence must cover every measured fragment cell')
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
    if (!merge.cells.length || !Number.isSafeInteger(merge.runLength) || merge.runLength < 1 || !['enclosed', 'partial', 'clipped', 'temporal'].includes(merge.reason)) throw new Error('Fragment merge needs explicit component evidence')
    validateTemporalEvidence(merge, completed.frame, support.frameCount, fragments.options.maxCells, cells)
    const measuredCells = new Set(merge.measuredCells)
    if (measuredCells.size !== merge.measuredCells.length) throw new Error('Fragment merge lists duplicate measured cells')
    if (merge.reason === 'clipped') validateClippedComponents(measuredCells, measured.labels, merge.fromGroupId, support.columns, support.rows, fragments.options.maxCells)
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

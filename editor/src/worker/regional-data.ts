import type { AnalysisFrame, RegionalMotionSequence, RegionalTracks, RegionalAnalysis, MotionHistoryGroups, MotionCompletion } from 'cadence/regional'

export type SceneData = {
  asset: string; first: number; last: number; sourceWidth: number; sourceHeight: number
  frames: AnalysisFrame[]
}
/** Immutable JS-owned data. No borrowed WASM views or decoded VideoFrame handles. */
export type RegionalData = {
  stage: 'scene' | 'motion' | 'pooled' | 'tracks' | 'history' | 'timing' | 'completion'
  scene: SceneData
  sequence?: RegionalMotionSequence
  tracks?: RegionalTracks
  families?: MotionHistoryGroups
  analysis?: RegionalAnalysis
  completion?: MotionCompletion
}

export const regionalSummary = (data: RegionalData): string => {
  const frame = data.scene.frames[0]!
  const lines = [`${data.stage}: frames ${data.scene.first} to ${data.scene.last} (inclusive)`, `${frame.width} x ${frame.height} analysis / ${data.scene.sourceWidth} x ${data.scene.sourceHeight} source`]
  if (data.sequence) lines.push(`${data.sequence.pairs.length} forward pairs; invalid pixels are unknown`)
  if (data.stage === 'pooled' || data.tracks) lines.push('Cells: 96, 48, 24, 12, 8; one shared dense field')
  if (data.tracks) lines.push(`${data.tracks.groups.length} motion groups / ${data.tracks.tracks.length} support tracks; not silhouettes`)
  if (data.families) {
    lines.push(`${data.families.families.length} motion families; original region IDs retained`, `Velocity tolerance: ${data.families.options.tolerance} analysis pixels/pair; minimum shared pairs: ${data.families.options.minimumOverlap}`)
    lines.push(data.families.options.proximityWeight === 0 ? 'Proposal order: motion only; no spatial proximity prior'
      : `Research data only: proximity weight ${data.families.options.proximityWeight}; not produced by the editor`)
    lines.push(['compatible', 'different', 'insufficient-overlap'].map(status => `${status}: ${data.families!.comparisons.filter(pair => pair.status === status).length}`).join(' / '))
    for (const family of data.families.families) lines.push(`Family ${family.id}: regions ${family.regionIds.join(', ')}`)
  }
  if (data.analysis) {
    const events = data.analysis.frames.flatMap(f => f.observations.map(o => o.event.status))
    lines.push(['held', 'changed', 'unknown'].map(status => `${status}: ${events.filter(s => s === status).length}`).join(' / '))
  }
  if (data.completion) {
    const counts = data.completion.frames.reduce((sum, frame) => ({ measured: sum.measured + frame.counts.measured, motion: sum.motion + frame.counts.motion, holes: sum.holes + frame.counts.holes,
      border: sum.border + frame.counts.border, isolated: sum.isolated + frame.counts.isolated, temporal: sum.temporal + frame.counts.temporal,
      blocked: sum.blocked + frame.counts.blocked, unknown: sum.unknown + frame.counts.unknown }), { measured: 0, motion: 0, holes: 0, border: 0, isolated: 0, temporal: 0, blocked: 0, unknown: 0 })
    lines.push(`Support completion (cell-pair counts): ${Object.entries(counts).map(([name, value]) => `${name} ${value}`).join('; ')}`,
      'Inferred support is not measured family membership, recovered pixels or a pixel-accurate silhouette.')
  }
  return lines.join('\n')
}

/** Stages share immutable object graphs; buffer aliases refer to one backing allocation. */
export const regionalResources = (data: RegionalData, resources = new Map<object, number>(), seen = new Set<object>()): Map<object, number> => {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (ArrayBuffer.isView(value)) {
      resources.set(value.buffer, value.buffer.byteLength)
      return
    }
    if (value instanceof ArrayBuffer) { resources.set(value, value.byteLength); return }
    resources.set(value, 64)
    Object.values(value).forEach(visit)
  }
  visit(data)
  return resources
}

export const regionalBytes = (data: RegionalData): number => [...regionalResources(data).values()].reduce((sum, bytes) => sum + bytes, 0)

import type { LayerFrames, LayerPlate, MeasuredCamera, MeasuredEvidence, RigidLayer, SceneSilhouettes } from 'cadence/regional'
import type { AnalysisFrame, RegionalMotionSequence, RegionalTracks, RegionalAnalysis, MotionHistoryGroups, MotionCompletion, FrameVectorGroups, FrameVectorSupport, FrameVectorIdentities, FrameVectorFragments, VectorBorderCorrection } from 'cadence/regional'

export type SceneData = {
  asset: string; first: number; last: number; sourceWidth: number; sourceHeight: number
  frames: AnalysisFrame[]
}
/** Immutable JS-owned data. No borrowed WASM views or decoded VideoFrame handles. */
export type RegionalData = {
  stage: 'scene' | 'motion' | 'pooled' | 'tracks' | 'history' | 'timing' | 'completion' | 'vector-candidates' | 'vector-groups' | 'vector-identities' | 'vector-completion' | 'vector-fragments'
    | 'pixel-camera' | 'pixel-evidence' | 'pixel-silhouettes' | 'pixel-plate' | 'pixel-refined' | 'pixel-frames'
  scene: SceneData
  sequence?: RegionalMotionSequence
  tracks?: RegionalTracks
  families?: MotionHistoryGroups
  analysis?: RegionalAnalysis
  completion?: MotionCompletion
  frameVectorGroups?: FrameVectorGroups
  frameVectorSupport?: FrameVectorSupport
  frameVectorIdentities?: FrameVectorIdentities
  frameVectorFragments?: FrameVectorFragments
  vectorBorderCorrections?: { frame: number; corrections: VectorBorderCorrection[] }[]
  pixelCamera?: MeasuredCamera
  /** Sliding layers found besides the camera, back to front; their plates once Background Plate built them. */
  pixelRigid?: RigidLayer[]
  /** Cover pixels what lies behind explained, per sliding layer, in the second pass: the camera plate, or the farther planes. */
  pixelRigidDropped?: number[]
  pixelEvidence?: MeasuredEvidence
  pixelSilhouettes?: SceneSilhouettes
  pixelPlate?: LayerPlate
  /** Pixels carved from each frame's silhouettes by Refine Silhouettes. */
  pixelCarved?: number[]
  /** Pixels Grow Silhouettes added to each frame's silhouettes. */
  pixelGrown?: number[]
  pixelFrames?: LayerFrames
  /** One RGBA thumbnail per held drawing, cut from its first frame; alpha 0 outside the layer. */
  pixelDrawings?: { layer: number; drawing: number; width: number; height: number; rgba: Uint8Array }[]
}

export const regionalSummary = (data: RegionalData): string => {
  const frame = data.scene.frames[0]!
  const lines = [`${data.stage}: frames ${data.scene.first} to ${data.scene.last} (inclusive)`, `${frame.width} x ${frame.height} analysis / ${data.scene.sourceWidth} x ${data.scene.sourceHeight} source`]
  if (data.sequence) lines.push(`${data.sequence.pairs.length} forward pairs; invalid pixels are unknown`)
  if (data.stage === 'vector-candidates' || data.stage === 'vector-groups') lines.push('Regional motion vectors candidates; mixed cell medians retained; no spatial or temporal hole filling')
  if (data.stage.startsWith('vector-')) lines.push(data.vectorBorderCorrections
    ? `Border vector verification: enabled; ${data.vectorBorderCorrections.reduce((sum, pair) => sum + pair.corrections.length, 0)} corrected cells; original dense flow retained`
    : 'Border vector verification: disabled; original pooled vectors')
  if (data.frameVectorGroups) {
    const candidates = data.sequence!.pairs.reduce((sum, pair) => sum + pair.grids[0]!.cells.filter(cell => cell.dx !== null && cell.dy !== null && Number.isFinite(cell.dx) && Number.isFinite(cell.dy)).length, 0)
    const grouped = data.frameVectorGroups.frames.reduce((sum, frame) => sum + frame.labels.reduce((count, label) => count + Number(label >= 0), 0), 0)
    lines.push(`Candidate cells: ${candidates}; grouped cells: ${grouped}; temporal filtering: none`, `Maximum velocity radius: ${data.frameVectorGroups.options.tolerance} analysis pixels/pair`, `Subtle motion separation: ${data.frameVectorGroups.options.splitSubtleMotion ? 'enabled' : 'disabled'}; candidate support preserved`, 'Group IDs and colors are frame-local, not tracked artwork identities')
    lines.push(`Distant region separation: ${data.frameVectorGroups.options.splitDistantRegions ? 'enabled' : 'disabled'}; foreground gap ${data.frameVectorGroups.options.proximityGap} cells; dominant background unchanged`)
  }
  if (data.frameVectorSupport) {
    const completion = data.frameVectorSupport
    const counts = completion.frames.reduce((sum, frame) => ({ measured: sum.measured + frame.counts.measured, holes: sum.holes + frame.counts.holes, border: sum.border + frame.counts.border, unknown: sum.unknown + frame.counts.unknown }), { measured: 0, holes: 0, border: 0, unknown: 0 })
    lines.push(`Direct completion (cell-pair counts): measured ${counts.measured}; inferred holes ${counts.holes}; inferred edge ${counts.border}; unknown ${counts.unknown}`,
      `Enclosed holes: ${completion.options.fillHoles ? 'enabled' : 'disabled'}; edge extension: ${completion.options.fillEdges ? 'enabled' : 'disabled'}; edge reach ${completion.options.edgeReach} cells`,
      'Inferred cells have no measured vector or confidence; original groups and motion remain unchanged.')
  }
  if (data.frameVectorIdentities) lines.push(`${data.frameVectorIdentities.tracks.length} persistent motion tracks; max gap ${data.frameVectorIdentities.options.maxGap} pairs; match radius ${data.frameVectorIdentities.options.matchRadius} cells`,
    'Identity mapping does not change local groups or support. Dormant tracks do not recover foreground masks on background-only held frames.')
  if (data.frameVectorFragments) lines.push(`Transient fragment merging: ${data.frameVectorFragments.options.enabled ? 'enabled' : 'disabled'}; ${data.frameVectorFragments.frames.reduce((sum, frame) => sum + frame.merges.length, 0)} inferred component merges`,
    'Fragment labels are derived display membership. Raw measured groups, completed support and identity associations remain unchanged.')
  if (data.pixelCamera) {
    const steps = data.pixelCamera.fits, last = data.pixelCamera.positions[data.pixelCamera.positions.length - 1]!
    lines.push(`Pixel camera: ${steps.length} pairs at ${data.pixelCamera.width} x ${data.pixelCamera.height}; total ${last.dx.toFixed(2)}, ${last.dy.toFixed(2)} px; median fit residual ${steps.map(s => s.residual).sort((a, b) => a - b)[steps.length >> 1]?.toFixed(3)} codes`)
  }
  if (data.pixelRigid) {
    if (!data.pixelRigid.length) lines.push('Sliding layers: none; every other motion is too sparse to be a rigid layer')
    for (const [k, layer] of data.pixelRigid.entries()) {
      const last = layer.path.positions[layer.path.positions.length - 1]!, cover = layer.cover.reduce((s, v) => s + v, 0), undecided = layer.decided.reduce((s, v) => s + 1 - v, 0)
      const kind = layer.backdrop ? ' (backdrop, never measured)' : layer.camera ? ' (the camera\'s own plane)' : ''
      lines.push(`Sliding layer ${k}${kind}: speed ${layer.depth.toFixed(2)} px per frame, total ${last.dx.toFixed(2)}, ${last.dy.toFixed(2)} px over ${layer.measured} measured pairs; baselines ${layer.baselines.join(', ')} frames; cover ${(100 * cover / layer.cover.length).toFixed(1)}% of a ${layer.atlas.width} x ${layer.atlas.height} atlas, undecided ${(100 * undecided / layer.cover.length).toFixed(1)}%${data.pixelRigidDropped ? `; ${data.pixelRigidDropped[k]} pixels dropped by what lies behind` : ''}${layer.plate ? '; plate built' : ''}${layer.matte ? `; rim matte ${layer.matte.solved} of ${layer.matte.alpha.length} alphas measured` : ''}`)
    }
  }
  if (data.pixelEvidence) {
    const counts = data.pixelEvidence.summaries.map(s => s.forward), sorted = [...counts].sort((a, b) => a - b)
    lines.push(`Redraw evidence: changed pixels per pair median ${sorted[sorted.length >> 1]}, max ${sorted[sorted.length - 1]}; world atlas ${data.pixelEvidence.atlas.width} x ${data.pixelEvidence.atlas.height}`,
      `Pairs over 5,000 changed pixels: ${counts.flatMap((count, pair) => count > 5000 ? [pair] : []).join(', ') || 'none'}`)
  }
  if (data.pixelSilhouettes) {
    const areas = data.pixelSilhouettes.frames.map(f => f.area)
    lines.push(`Drawing silhouettes: close ${data.pixelSilhouettes.options.closeRadius ?? 6} px, minimum area ${data.pixelSilhouettes.options.minimumArea ?? 800} px; frames with a drawing ${areas.filter(a => a > 0).length}/${areas.length}; largest ${Math.max(...areas)} px`)
  }
  if (data.pixelCarved) lines.push(`Refined silhouettes: ${data.pixelCarved.reduce((a, b) => a + b, 0)} pixels carved over ${data.pixelCarved.length} frames`)
  if (data.pixelGrown) lines.push(`Grown silhouettes: ${data.pixelGrown.reduce((a, b) => a + b, 0)} pixels the scene could not explain added over ${data.pixelGrown.length} frames`)
  if (data.pixelPlate) {
    const known = data.pixelPlate.count.reduce((sum, n) => sum + Number(n > 0), 0)
    lines.push(`Background plate: ${data.pixelPlate.atlas.width} x ${data.pixelPlate.atlas.height}; observed ${(100 * known / data.pixelPlate.count.length).toFixed(1)}%`)
  }
  if (data.pixelFrames) lines.push(`Layer frames: ${data.pixelFrames.layers.length} layers; ${data.pixelFrames.layers.map(layer => `layer ${layer.id} ${layer.drawings.length} drawings`).join(', ')}`)
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

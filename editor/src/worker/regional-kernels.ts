import { Mat, matFromArray, cvtColor, resize, putText, FONT_HERSHEY_SIMPLEX, LINE_AA, CV_8UC4, CV_32F, COLOR_RGBA2BGR, INTER_AREA } from '@banou/opencv-wasm'
import { analyzeMotionPair, poolMotionSequence, trackRegionalMotion, groupMotionHistories, analyzeRegionalTimingFrame, finishRegionalTiming, type AnalysisFrame, type RegionalAnalysis, type RegionalMotionSequence } from 'cadence/regional'
import type { Step } from '../engine/plan'
import type { Bundle } from '../engine/types'
import type { VideoSource } from '../video/source'
import { payloadBundle, type Payload } from './payload'
import type { RegionalData, SceneData } from './regional-data'
import { renderRegional, type RegionalView } from './regional-render'

/** Bound retained dense fields before decoding; downstream cache accounting includes JS arrays. */
export const sceneGeometry = (sourceWidth: number, sourceHeight: number, first: number, last: number, maxSide: number, frameCount: number) => {
  if (![sourceWidth, sourceHeight, first, last, maxSide, frameCount].every(Number.isSafeInteger) || sourceWidth < 1 || sourceHeight < 1 || first < 0 || last <= first || last >= frameCount || maxSide < 96 || maxSide > 640) throw new RangeError('Scene range needs at least two in-bounds frames and analysis max side 96 to 640')
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale)), count = last - first + 1
  if (Math.min(width, height) < 32) throw new RangeError('Scene analysis needs at least 32 pixels on each side')
  if (count > 500 || width * height * count > 10_000_000) throw new RangeError('Scene range exceeds the regional analysis budget; reduce the range or analysis max side')
  return { width, height, count }
}

const checkCancelled = (cancelled: () => boolean) => { if (cancelled()) throw new Error('Evaluation cancelled') }

/** Retain only the resized pixels; decoded frames always remain caller-owned. */
const readFrame = async (video: VideoSource, index: number, width: number, height: number, cancelled: () => boolean): Promise<AnalysisFrame> => {
  checkCancelled(cancelled)
  const frame = await video.frameAt(index, cancelled)
  try {
    checkCancelled(cancelled)
    const pixels = new Uint8Array(frame.displayWidth * frame.displayHeight * 4)
    await frame.copyTo(pixels, { format: 'RGBA', colorSpace: 'srgb', rect: { x: frame.visibleRect?.x ?? 0, y: frame.visibleRect?.y ?? 0, width: frame.displayWidth, height: frame.displayHeight }, layout: [{ offset: 0, stride: frame.displayWidth * 4 }] })
    checkCancelled(cancelled)
    using rgba = matFromArray(frame.displayHeight, frame.displayWidth, CV_8UC4, pixels)
    using bgr = new Mat(), small = new Mat()
    cvtColor(rgba, bgr, COLOR_RGBA2BGR)
    resize(bgr, small, { width, height }, 0, 0, INTER_AREA)
    return { width, height, data: small.data.slice() }
  } finally { frame.close() }
}

/** Display detail is independent of the scene's retained analysis resolution. */
export const regionalDisplayGeometry = (scene: SceneData, maxSide: number) => {
  if (!Number.isSafeInteger(maxSide) || maxSide < 0 || maxSide > 1280) throw new RangeError('Display max side must be between 0 and 1280')
  if (maxSide === 0) return { width: scene.frames[0]!.width, height: scene.frames[0]!.height }
  const scale = Math.min(1, maxSide / Math.max(scene.sourceWidth, scene.sourceHeight))
  return { width: Math.max(1, Math.round(scene.sourceWidth * scale)), height: Math.max(1, Math.round(scene.sourceHeight * scale)) }
}

export const regionalKernel = async (step: Step, inputs: Record<string, Payload>, sourceById: (asset: string) => VideoSource | undefined, cancelled: () => boolean): Promise<Bundle<Payload> | undefined> => {
  const type = step.node.type
  if (!['sceneRange', 'regionalMotion', 'regionalPool', 'regionalTracks', 'regionalHistory', 'regionalTiming', 'regionalInspect'].includes(type)) return undefined
  const checkpoint = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (cancelled()) throw new Error('Evaluation cancelled') }
  const params = step.node.params
  if (type === 'sceneRange') {
    const clip = inputs['in:video:clip'], video = clip?.kind === 'video' ? sourceById(clip.asset) : undefined
    if (!video) throw new Error('Connect a video clip to Scene Range')
    const first = Number(params.first), last = Number(params.last)
    const { width, height } = sceneGeometry(video.info.width, video.info.height, first, last, Number(params.maxSide), video.info.frameCount)
    const frames: AnalysisFrame[] = []
    for (let index = first; index <= last; index++) {
      await checkpoint()
      frames.push(await readFrame(video, index, width, height, cancelled))
    }
    const scene: SceneData = { asset: video.info.id, first, last, sourceWidth: video.info.width, sourceHeight: video.info.height, frames }
    return payloadBundle({ 'out:regions:data': { kind: 'regions', data: { stage: 'scene', scene } } })
  }
  const input = inputs['in:regions:data']
  if (input?.kind !== 'regions') throw new Error('Regional analysis data is required')
  const data = input.data
  const requireStage = (stage: RegionalData['stage']) => { if (data.stage !== stage && !(stage === 'tracks' && data.stage === 'history')) throw new Error(`This stage requires ${stage} data, received ${data.stage}`) }
  let output: RegionalData
  if (type === 'regionalMotion') {
    requireStage('scene')
    const frames = data.scene.frames, { width, height } = frames[0]!
    const sequence: RegionalMotionSequence = { width, height, frameCount: frames.length, pairs: [] }
    for (let i = 0; i < frames.length - 1; i++) {
      await checkpoint()
      sequence.pairs.push(analyzeMotionPair(frames[i]!, frames[i + 1]!, i, { cellSizes: [], window: Number(params.window), levels: Number(params.levels), roundTrip: Number(params.roundTrip) }))
    }
    output = { ...data, stage: 'motion', sequence }
  } else if (type === 'regionalPool') {
    requireStage('motion')
    const sequence = { ...data.sequence!, pairs: [] as RegionalMotionSequence['pairs'] }
    for (const pair of data.sequence!.pairs) {
      await checkpoint()
      sequence.pairs.push(poolMotionSequence({ ...data.sequence!, pairs: [pair] }).pairs[0]!)
    }
    output = { ...data, stage: 'pooled', sequence }
  } else if (type === 'regionalTracks') {
    requireStage('pooled'); await checkpoint()
    output = { ...data, stage: 'tracks', tracks: trackRegionalMotion(data.sequence!, { tolerance: Number(params.tolerance), minimumOverlap: Number(params.minimumOverlap) }) }
  } else if (type === 'regionalTiming') {
    requireStage('tracks')
    const frames: RegionalAnalysis['frames'] = [], groupIds = data.tracks!.groups.map(g => g.id)
    for (const observations of data.tracks!.frames) {
      await checkpoint()
      const i = observations.frame
      frames.push(analyzeRegionalTimingFrame(data.scene.frames[i]!, data.scene.frames[i + 1]!, data.sequence!.pairs[i]!, observations.observations, { ...(i > 0 ? { previous: { pair: data.sequence!.pairs[i - 1]!, observations: data.tracks!.frames[i - 1]!.observations } } : {}), groupIds }))
    }
    output = { ...data, stage: 'timing', analysis: finishRegionalTiming(frames, groupIds) }
  } else if (type === 'regionalHistory') {
    requireStage('tracks'); await checkpoint()
    output = { ...data, stage: 'history', families: groupMotionHistories(data.tracks!, { tolerance: Number(params.tolerance), minimumOverlap: Number(params.minimumOverlap), proximityWeight: Number(params.proximityWeight) }) }
  } else {
    const sourceFrame = Number(params.frame), view = String(params.view) as RegionalView
    const analysis = data.scene.frames[sourceFrame - data.scene.first]
    if (!Number.isSafeInteger(sourceFrame) || !analysis) throw new RangeError(`Source frame must be in the analyzed range ${data.scene.first} to ${data.scene.last}`)
    let display: AnalysisFrame | undefined
    if (view !== 'timeline' && view !== 'velocities') {
      const { width, height } = regionalDisplayGeometry(data.scene, Number(params.displayMaxSide))
      if (width !== analysis.width || height !== analysis.height) {
        const video = sourceById(data.scene.asset)
        if (!video) throw new Error('Attach the original video to render regional evidence at a different resolution')
        display = await readFrame(video, sourceFrame, width, height, cancelled)
      }
    }
    checkCancelled(cancelled)
    const raster = renderRegional(data, sourceFrame, view, Number(params.cellSize), Number(params.groupPage), display)
    using rgba = matFromArray(raster.height, raster.width, CV_8UC4, raster.pixels)
    for (const label of raster.labels ?? []) putText(rgba, label.text, { x: label.x, y: label.y }, FONT_HERSHEY_SIMPLEX, .35, [235, 238, 242, 255], 1, LINE_AA)
    const mat = new Mat()
    try {
      rgba.convertTo(mat, CV_32F, 1 / 255)
      return payloadBundle({ 'out:frame:image': { kind: 'frame', mat, range: 'unit' }, 'out:string:summary': { kind: 'string', value: raster.summary } })
    } catch (error) { mat.delete(); throw error }
  }
  await checkpoint()
  return payloadBundle({ 'out:regions:data': { kind: 'regions', data: output } })
}

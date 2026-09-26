import { Mat, matFromArray, putText, CV_8UC4, CV_32F, FONT_HERSHEY_SIMPLEX, LINE_AA } from '@banou/opencv-wasm'
import {
  annotateScenery, assembleCel, buildScenePlates, carveStill, releaseHeldScenery, solveCel, frameLayerLabels, growSilhouettes, renderPlate, renderScene, type HeldCel, refineRigidScene, refineSilhouettes, frameOffset, layerFrames, measureCameraPath, measureDrawingEvidence,
  measureScenePlanes, orderPlanes, pixelFrameFromRgba, promoteBackdrop, rigidPaths, sceneSilhouettes, unpackMask, type PixelFrame, type PixelFrameSource, type RigidLayer,
} from 'cadence/regional'
import type { Step } from '../engine/plan'
import type { Bundle } from '../engine/types'
import type { VideoSource } from '../video/source'
import { payloadBundle, type Payload } from './payload'
import type { RegionalData } from './regional-data'
import { renderPixelPanels } from './pixel-render'

const PIXEL_TYPES = new Set(['pixelCamera', 'pixelRigid', 'pixelEvidence', 'pixelScenery', 'pixelSilhouettes', 'pixelPlate', 'pixelRefine', 'pixelRigidRefine', 'pixelGrow', 'pixelStill', 'pixelRelease', 'pixelFrames', 'pixelInspect'])
const THUMBNAIL = { width: 150, height: 200 }

const decode = async (video: VideoSource, index: number, cancelled: () => boolean): Promise<PixelFrame> => {
  const frame = await video.frameAt(index, cancelled)
  try {
    const width = frame.displayWidth, height = frame.displayHeight, rgba = new Uint8Array(width * height * 4)
    await frame.copyTo(rgba, { format: 'RGBA', colorSpace: 'srgb', rect: { x: frame.visibleRect?.x ?? 0, y: frame.visibleRect?.y ?? 0, width, height }, layout: [{ offset: 0, stride: width * 4 }] })
    return pixelFrameFromRgba(width, height, rgba)
  } finally { frame.close() }
}

/** Original frames of the scene at full resolution; three stay decoded for the pair stages. */
const sceneSource = (data: RegionalData, video: VideoSource, cancelled: () => boolean): PixelFrameSource => {
  const cache = new Map<number, PixelFrame>()
  return {
    count: data.scene.last - data.scene.first + 1, width: data.scene.sourceWidth, height: data.scene.sourceHeight,
    frame: async index => {
      let frame = cache.get(index)
      if (!frame) {
        frame = await decode(video, data.scene.first + index, cancelled)
        if (frame.width !== data.scene.sourceWidth || frame.height !== data.scene.sourceHeight) throw new Error('Decoded frames do not match the scene size')
        cache.set(index, frame)
        if (cache.size > 3) cache.delete(cache.keys().next().value!)
      }
      return frame
    },
  }
}

export const pixelKernel = async (step: Step, inputs: Record<string, Payload>, sourceById: (asset: string) => VideoSource | undefined, cancelled: () => boolean): Promise<Bundle<Payload> | undefined> => {
  const type = step.node.type
  if (!PIXEL_TYPES.has(type)) return undefined
  const input = inputs['in:regions:data']
  if (input?.kind !== 'regions') throw new Error('Pixel layers need Scene Range data')
  const data = input.data, params = step.node.params
  const video = sourceById(data.scene.asset)
  if (!video) throw new Error('Attach the original video: pixel stages decode full-resolution frames')
  const progress = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (cancelled()) throw new Error('Evaluation cancelled') }
  const source = sceneSource(data, video, cancelled)
  let output: RegionalData
  if (type === 'pixelCamera') {
    if (data.stage !== 'scene') throw new Error('Pixel Camera Path takes Scene Range output')
    output = { ...data, stage: 'pixel-camera', pixelCamera: await measureCameraPath(source, { progress }) }
  } else if (type === 'pixelRigid') {
    if (!data.pixelCamera) throw new Error('Sliding Layers needs Pixel Camera Path')
    const options = { minimumOwn: Number(params.minimumOwn), ownFraction: Number(params.ownFraction), occlusion: Number(params.occlusion), closing: Number(params.closing), maximumHole: Number(params.maximumHole), minimumArea: Number(params.minimumArea), progress }
    // Back to front: planes behind the camera's own put it among them, with the farthest as the backdrop.
    const layers: RigidLayer[] = await measureScenePlanes(source, data.pixelCamera, orderPlanes(data.pixelCamera, rigidPaths(data.pixelCamera)), options)
    output = { ...data, pixelRigid: layers }
  } else if (type === 'pixelEvidence') {
    if (!data.pixelCamera) throw new Error('Redraw Ink Evidence needs Pixel Camera Path')
    const options = { reach: Number(params.reach), noiseFactor: Number(params.noiseFactor), gradientSlope: Number(params.gradientSlope), inkDelta: Number(params.inkDelta), lineDelta: Number(params.lineDelta), dilation: Number(params.dilation) }
    output = { ...data, stage: 'pixel-evidence', pixelEvidence: await measureDrawingEvidence(source, data.pixelCamera, { ...options, progress, ...(data.pixelRigid ? { rigid: data.pixelRigid } : {}) }) }
  } else if (type === 'pixelScenery') {
    if (!data.pixelEvidence) throw new Error('Scenery Median needs Redraw Ink Evidence')
    output = { ...data, stage: 'pixel-evidence', pixelEvidence: await annotateScenery(source, data.pixelEvidence, { tolerance: Number(params.tolerance), minimumSamples: Number(params.minimumSamples), progress }) }
  } else if (type === 'pixelSilhouettes') {
    if (!data.pixelEvidence) throw new Error('Drawing Silhouettes needs Redraw Ink Evidence')
    output = { ...data, stage: 'pixel-silhouettes', pixelSilhouettes: await sceneSilhouettes(data.pixelEvidence, { closeRadius: Number(params.closeRadius), minimumArea: Number(params.minimumArea), erode: Number(params.erode), recurrence: Number(params.recurrence), sceneryLeaves: String(params.sceneryLeaves) as 'never' | 'recurring' | 'known' | 'always', leaveHorizon: Number(params.leaveHorizon), holdTolerance: Number(params.holdTolerance), progress, ...(Number(params.holdTolerance) > 0 ? { source } : {}) }) }
  } else if (type === 'pixelBackdrop') {
    if (!data.pixelCamera || !data.pixelSilhouettes) throw new Error('Promote Backdrop needs Drawing Silhouettes')
    const rigid = data.pixelRigid ?? [], size = source.width * source.height, silhouettes = data.pixelSilhouettes
    const promoted = await promoteBackdrop(source, data.pixelCamera, rigid, frame => unpackMask(silhouettes.frames[frame]!.packed, size), {
      gap: Number(params.gap), stride: Number(params.stride), fraction: Number(params.fraction), support: Number(params.support), margin: Number(params.margin), away: Number(params.away),
    })
    output = { ...data, pixelRigid: promoted.layers, pixelBackdrop: { share: promoted.share, won: promoted.won, promoted: promoted.layers !== rigid } }
  } else if (type === 'pixelPlate') {
    if (!data.pixelCamera || !data.pixelSilhouettes) throw new Error('Background Plate needs Drawing Silhouettes')
    // The camera plate, then each plane's own plate outside the drawings and planes in front of it, its rim
    // matted over what lies behind it.
    const { plate: pixelPlate, layers: pixelRigid } = await buildScenePlates(source, data.pixelCamera, data.pixelSilhouettes, data.pixelRigid ?? [], {
      margin: Number(params.margin), floor: Number(params.floor), drift: Number(params.drift), backdropMedian: params.backdropMedian !== false, progress, ...(data.pixelEvidence ? { evidence: data.pixelEvidence } : {}),
      ...(data.pixelClear ? { clear: data.pixelClear } : {}),
    })
    output = { ...data, stage: 'pixel-plate', pixelPlate, ...(data.pixelRigid ? { pixelRigid } : {}) }
  } else if (type === 'pixelRefine') {
    if (!data.pixelCamera || !data.pixelSilhouettes || !data.pixelPlate) throw new Error('Refine Silhouettes needs Background Plate')
    const refined = await refineSilhouettes(source, data.pixelCamera, data.pixelSilhouettes, data.pixelPlate, { band: Number(params.band), tolerance: Number(params.tolerance), minimumCount: Number(params.minimumCount), progress, layers: data.pixelRigid ?? [] })
    const { carved, ...silhouettes } = refined
    output = { ...data, stage: 'pixel-refined', pixelSilhouettes: silhouettes, pixelCarved: carved }
  } else if (type === 'pixelRigidRefine') {
    if (!data.pixelCamera || !data.pixelSilhouettes) throw new Error('Sliding Layers, Second Pass needs Refine Silhouettes')
    if (!data.pixelRigid?.length) output = data
    else {
      const second = await refineRigidScene(source, data.pixelCamera, data.pixelSilhouettes, data.pixelRigid, {
        carve: { band: Number(params.band), tolerance: Number(params.tolerance), minimumCount: Number(params.minimumCount) }, progress, ...(data.pixelEvidence ? { evidence: data.pixelEvidence } : {}),
      })
      const { carved, ...silhouettes } = second.silhouettes
      output = { ...data, stage: 'pixel-refined', pixelSilhouettes: silhouettes, pixelCarved: carved ?? data.pixelCarved, pixelRigid: second.layers, pixelRigidDropped: second.dropped, pixelRigidClaimed: second.claimed, ...(second.plate ? { pixelPlate: second.plate } : {}) }
    }
  } else if (type === 'pixelGrow') {
    if (!data.pixelCamera || !data.pixelSilhouettes || !data.pixelPlate) throw new Error('Grow Silhouettes needs Background Plate')
    const grown = await growSilhouettes(source, data.pixelCamera, data.pixelSilhouettes, data.pixelPlate, {
      band: Number(params.band), bay: Number(params.bay), tolerance: Number(params.tolerance), layers: (data.pixelRigid ?? []).filter(layer => layer.plate), progress,
    })
    const { grown: counts, ...silhouettes } = grown
    output = { ...data, stage: 'pixel-refined', pixelSilhouettes: silhouettes, pixelGrown: counts }
  } else if (type === 'pixelStill') {
    if (!data.pixelCamera || !data.pixelEvidence || !data.pixelSilhouettes) throw new Error('Carve What Holds Still needs Drawing Silhouettes')
    const carved = await carveStill(source, data.pixelCamera, data.pixelEvidence, data.pixelSilhouettes, {
      hold: Number(params.hold), consistent: Number(params.consistent), span: Number(params.span), islands: Number(params.islands), lasting: Number(params.lasting), covering: Number(params.covering), ...(Number(params.vote) ? {} : { vote: false }), progress,
    })
    const { stilled, continued: _, taken, ...silhouettes } = carved
    output = { ...data, stage: 'pixel-refined', pixelSilhouettes: silhouettes, pixelStilled: stilled, pixelClear: taken }
  } else if (type === 'pixelRelease') {
    if (!data.pixelEvidence || !data.pixelSilhouettes) throw new Error('Release Held Scenery needs Drawing Silhouettes')
    const released = await releaseHeldScenery(source, data.pixelEvidence, data.pixelSilhouettes, layerFrames(data.pixelEvidence, data.pixelSilhouettes), {
      gradient: Number(params.gradient), texture: Number(params.texture), minimumArea: Number(params.minimumArea), revealed: Number(params.revealed), window: Number(params.window), progress,
    })
    const { released: counts, ...silhouettes } = released
    output = { ...data, stage: 'pixel-refined', pixelSilhouettes: silhouettes, pixelReleased: counts }
  } else if (type === 'pixelFrames') {
    if (!data.pixelEvidence || !data.pixelSilhouettes) throw new Error('Layer Frames needs Drawing Silhouettes')
    const frames = layerFrames(data.pixelEvidence, data.pixelSilhouettes, { minimumChanges: Number(params.minimumChanges), minimumFraction: Number(params.minimumFraction) })
    const drawings: NonNullable<RegionalData['pixelDrawings']> = [], { width, height } = source
    for (const layer of frames.layers) for (const drawing of layer.drawings) {
      await progress()
      const pixels = await source.frame(drawing.first), labels = frameLayerLabels(data.pixelSilhouettes, frames, drawing.first)
      const offset = frameOffset(data.pixelEvidence.camera, data.pixelEvidence.atlas, drawing.first), [bx, by, bw, bh] = drawing.box
      const scale = Math.min(1, THUMBNAIL.width / bw, THUMBNAIL.height / bh), tw = Math.max(1, Math.floor(bw * scale)), th = Math.max(1, Math.floor(bh * scale)), rgba = new Uint8Array(tw * th * 4)
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const sx = bx - offset.x + Math.floor(x / scale), sy = by - offset.y + Math.floor(y / scale), o = (y * tw + x) * 4
        if (sx < 0 || sy < 0 || sx >= width || sy >= height || labels[sy * width + sx] !== layer.id + 1) continue
        const q = (sy * width + sx) * 3
        rgba[o] = pixels.data[q + 2]!; rgba[o + 1] = pixels.data[q + 1]!; rgba[o + 2] = pixels.data[q]!; rgba[o + 3] = 255
      }
      drawings.push({ layer: layer.id, drawing: drawing.id, width: tw, height: th, rgba })
    }
    output = { ...data, stage: 'pixel-frames', pixelFrames: frames, pixelDrawings: drawings }
  } else {
    const sourceFrame = Number(params.frame), index = sourceFrame - data.scene.first
    // The drawings shown here, each assembled over its whole hold, to rebuild this frame from the layers alone.
    let cels: HeldCel[] | undefined
    if (data.pixelFrames && data.pixelSilhouettes && data.pixelPlate && data.pixelEvidence && data.pixelCamera && data.pixelFrames.frames[index]) {
      const camera = data.pixelCamera, plate = data.pixelPlate, rigid = (data.pixelRigid ?? []).filter(layer => layer.plate)
      const behind = (frame: number) => rigid.length ? renderScene(plate, camera, rigid, frame) : renderPlate(plate, camera, frame)
      cels = []
      for (const [layer, drawing] of data.pixelFrames.frames[index]!) {
        await progress()
        const started = performance.now()
        // Matted over its hold, then its color solved against every frame of the hold, other layers kept out.
        const assembled = await assembleCel(source, camera, data.pixelEvidence.atlas, data.pixelSilhouettes, data.pixelFrames, layer, drawing, behind)
        const silhouettes = data.pixelSilhouettes, drawings = data.pixelFrames
        const others = (frame: number) => Uint8Array.from(frameLayerLabels(silhouettes, drawings, frame), l => Number(l !== 0 && l !== layer + 1))
        cels.push(await solveCel(source, camera, data.pixelEvidence.atlas, assembled, behind, { exclude: others }))
        console.info(`[pixel] assembled layer ${layer} drawing ${drawing} in ${Math.round(performance.now() - started)} ms`)
      }
    }
    const started = performance.now()
    const result = renderPixelPanels(data, sourceFrame, await decode(video, sourceFrame, cancelled), Number(params.displayMaxSide), cels)
    console.info(`[pixel] panels for frame ${sourceFrame} in ${Math.round(performance.now() - started)} ms`)
    const outputs: Record<string, Payload> = { 'out:string:summary': { kind: 'string', value: result.summary } }, allocated: Mat[] = []
    try {
      for (const [key, pixels] of Object.entries(result.panels)) {
        const size = key === 'drawings' ? result.sheet : result
        using rgba = matFromArray(size.height, size.width, CV_8UC4, pixels)
        if (key === 'drawings') for (const label of result.sheet.labels) putText(rgba, label.text, { x: label.x, y: label.y }, FONT_HERSHEY_SIMPLEX, .38, label.current ? [40, 225, 255, 255] : [215, 222, 230, 255], 1, LINE_AA)
        if (key === 'planes') for (const label of result.planeLabels) putText(rgba, label.text, { x: label.x, y: label.y }, FONT_HERSHEY_SIMPLEX, .45, [235, 240, 245, 255], 1, LINE_AA)
        const mat = new Mat(); allocated.push(mat)
        rgba.convertTo(mat, CV_32F, 1 / 255)
        outputs[`out:frame:${key}`] = { kind: 'frame', mat, range: 'unit' }
      }
      return payloadBundle(outputs)
    } catch (error) { allocated.forEach(mat => mat.delete()); throw error }
  }
  return payloadBundle({ 'out:regions:data': { kind: 'regions', data: output } })
}

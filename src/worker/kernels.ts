import { Mat, matFromArray, CV_8UC4, CV_32F, CV_64F, COLOR_GRAY2RGBA, COLOR_RGBA2GRAY, GaussianBlur, cvtColor, transform, subtract, absdiff, mean, phaseCorrelate, createHanningWindow, warpAffine, INTER_LINEAR, BORDER_CONSTANT, arrowedLine, LINE_AA, threshold, THRESH_BINARY, THRESH_BINARY_INV, CV_8U } from '@banou/opencv-wasm'
import type { Step } from '../engine/plan'
import type { Bundle } from '../engine/types'
import type { VideoSource } from '../video/source'

/** A native frame is owned by exactly one cache bundle. Pixel values are normalized float32. */
export type Frame = { kind: 'frame'; mat: Mat; range: 'unit' | 'signed' }
/** Runtime payloads remain inside the worker; only metadata crosses to the UI. */
export type Payload = Frame | { kind: 'scalar'; value: number } | { kind: 'motion'; dx: number; dy: number; response: number; preview: Frame }

const image = (value: Payload | undefined): Frame => {
  if (value?.kind !== 'frame') throw new Error('A frame input is required')
  return value
}

/** Execute the starter algorithms through the package's named TypeScript API. */
export const runKernel = async (step: Step, inputs: Record<string, Payload>, source: VideoSource, cancelled: () => boolean): Promise<Bundle<Payload>> => {
  if (step.node.type === 'time') return { outputs: { 'out:scalar:fraction': { kind: 'scalar', value: step.frame - Math.floor(step.frame) }, 'out:scalar:frame': { kind: 'scalar', value: step.frame }, 'out:scalar:seconds': { kind: 'scalar', value: step.frame / source.info.fps } }, bytes: 24, dispose: () => {} }
  if (step.node.type === 'constant' || step.node.type === 'multiply') {
    const a = inputs['in:scalar:a'], b = inputs['in:scalar:b']
    const value = step.node.type === 'constant' ? Number(step.node.params.value) : (a?.kind === 'scalar' ? a.value : NaN) * (b?.kind === 'scalar' ? b.value : Number(step.node.params.factor))
    if (!Number.isFinite(value)) throw new Error('The numeric operation produced a non-finite value')
    return { outputs: { 'out:scalar:value': { kind: 'scalar', value } }, bytes: 8, dispose: () => {} }
  }
  const out = new Mat(), outputs: Record<string, Payload> = {}
  let range: Frame['range'] = 'unit'
  try {
    if (step.node.type === 'source') {
      const frame = await source.frameAt(step.frame, cancelled)
      try {
        const options: VideoFrameCopyToOptions = { format: 'RGBA', colorSpace: 'srgb', rect: { x: frame.visibleRect?.x ?? 0, y: frame.visibleRect?.y ?? 0, width: frame.displayWidth, height: frame.displayHeight }, layout: [{ offset: 0, stride: frame.displayWidth * 4 }] }
        const pixels = new Uint8Array(frame.displayWidth * frame.displayHeight * 4)
        await frame.copyTo(pixels, options)
        using src = matFromArray(frame.displayHeight, frame.displayWidth, CV_8UC4, pixels)
        src.convertTo(out, CV_32F, 1 / 255)
      } finally { frame.close() }
    } else if (step.node.type === 'offset' || step.node.type === 'extractFrame') {
      const input = image(inputs['in:frame:image']); range = input.range; input.mat.copyTo(out)
    } else if (step.node.type === 'threshold') {
      using weights = matFromArray(1, 4, CV_32F, [0.2126, 0.7152, 0.0722, 0])
      using gray = new Mat(), mask = new Mat()
      transform(image(inputs['in:frame:image']).mat, gray, weights)
      threshold(gray, mask, Number(step.node.params.cutoff), 1, step.node.params.invert ? THRESH_BINARY_INV : THRESH_BINARY)
      cvtColor(mask, out, COLOR_GRAY2RGBA)
    } else if (step.node.type === 'composite') {
      const fg = image(inputs['in:frame:foreground']), bg = image(inputs['in:frame:background']), mask = image(inputs['in:frame:mask'])
      if ([bg, mask].some(f => f.mat.rows !== fg.mat.rows || f.mat.cols !== fg.mat.cols)) throw new Error('Foreground, background and mask dimensions must match')
      using gray = new Mat(), binary = new Mat(), bytes = new Mat()
      cvtColor(mask.mat, gray, COLOR_RGBA2GRAY); threshold(gray, binary, 0.5, 255, THRESH_BINARY); binary.convertTo(bytes, CV_8U)
      bg.mat.copyTo(out); fg.mat.copyTo(out, bytes); range = fg.range === 'signed' || bg.range === 'signed' ? 'signed' : 'unit'
    } else if (step.node.type === 'grayscale') {
      const input = image(inputs['in:frame:image']); range = input.range
      using weights = matFromArray(1, 4, CV_32F, step.node.params.weights === 'average' ? [1 / 3, 1 / 3, 1 / 3, 0] : [0.2126, 0.7152, 0.0722, 0])
      using gray = new Mat()
      transform(input.mat, gray, weights)
      cvtColor(gray, out, COLOR_GRAY2RGBA)
    } else if (step.node.type === 'blur') {
      const input = image(inputs['in:frame:image']); range = input.range
      const radius = Number(step.node.params.radius)
      if (!radius) input.mat.copyTo(out)
      else GaussianBlur(input.mat, out, { width: 2 * radius + 1, height: 2 * radius + 1 }, Number(step.node.params.sigma))
    } else if (step.node.type === 'motion') {
      const a = image(inputs['in:frame:a']), b = image(inputs['in:frame:b'])
      if (a.mat.rows !== b.mat.rows || a.mat.cols !== b.mat.cols) throw new Error('Motion inputs must have matching dimensions')
      using ga = new Mat(), gb = new Mat(), window = new Mat()
      cvtColor(a.mat, ga, COLOR_RGBA2GRAY); cvtColor(b.mat, gb, COLOR_RGBA2GRAY)
      createHanningWindow(window, { width: ga.cols, height: ga.rows }, CV_32F)
      const result = phaseCorrelate(ga, gb, window)
      if (!Number.isFinite(result.value.x) || !Number.isFinite(result.value.y)) throw new Error('No finite translation could be estimated')
      a.mat.copyTo(out)
      for (let y = 80; y < out.rows; y += 160) for (let x = 80; x < out.cols; x += 160) arrowedLine(out, { x, y }, { x: Math.round(x + result.value.x * 4), y: Math.round(y + result.value.y * 4) }, [0.6, 1, 0.75, 1], 2, LINE_AA, 0, 0.25)
      outputs['out:motion:shift'] = { kind: 'motion', dx: result.value.x, dy: result.value.y, response: result.response, preview: { kind: 'frame', mat: out, range: 'unit' } }
      outputs['out:scalar:response'] = { kind: 'scalar', value: result.response }
      outputs['out:scalar:dx'] = { kind: 'scalar', value: result.value.x }; outputs['out:scalar:dy'] = { kind: 'scalar', value: result.value.y }
      return { outputs, bytes: out.rows * out.cols * out.elemSize(), dispose: () => out.delete() }
    } else if (step.node.type === 'translateX' || step.node.type === 'translateY') {
      const input = image(inputs['in:frame:image']), amount = inputs['in:scalar:pixels']
      const displacement = amount?.kind === 'scalar' ? amount.value : Number(step.node.params.pixels)
      if (!Number.isFinite(displacement) || Math.abs(displacement) > 1000000) throw new Error('Translation must be finite and within one million pixels')
      using matrix = matFromArray(2, 3, CV_64F, [1, 0, step.node.type === 'translateX' ? displacement : 0, 0, 1, step.node.type === 'translateY' ? displacement : 0])
      warpAffine(input.mat, out, matrix, { width: input.mat.cols, height: input.mat.rows }, INTER_LINEAR, BORDER_CONSTANT, [0, 0, 0, 1])
      range = input.range
    } else if (step.node.type === 'delta') {
      const a = image(inputs['in:frame:a']), b = image(inputs['in:frame:b'])
      if (a.mat.rows !== b.mat.rows || a.mat.cols !== b.mat.cols) throw new Error('Frame Delta inputs must have the same dimensions')
      if (step.node.params.absolute) absdiff(a.mat, b.mat, out)
      else { subtract(a.mat, b.mat, out); range = 'signed' }
      using weights = matFromArray(1, 4, CV_32F, [0.2126, 0.7152, 0.0722, 0])
      using ga = new Mat(), gb = new Mat(), difference = new Mat()
      transform(a.mat, ga, weights); transform(b.mat, gb, weights); absdiff(ga, gb, difference)
      outputs['out:scalar:mean'] = { kind: 'scalar', value: mean(difference)[0] }
    } else throw new Error('Output nodes forward their upstream result')
    outputs[step.node.type === 'delta' ? 'out:frame:delta' : 'out:frame:image'] = { kind: 'frame', mat: out, range }
    return { outputs, bytes: out.rows * out.cols * out.elemSize(), dispose: () => out.delete() }
  } catch (error) { out.delete(); throw error }
}

/** Convert the selected result for display, without modifying its native floating-point pixels. */
export const displayPixels = (frame: Frame, gain: number): Uint8Array<ArrayBuffer> => {
  using mapped = new Mat()
  frame.mat.convertTo(mapped, CV_8UC4, gain * 255, frame.range === 'signed' ? 127.5 : 0)
  const pixels = mapped.data.slice()
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
  return pixels
}

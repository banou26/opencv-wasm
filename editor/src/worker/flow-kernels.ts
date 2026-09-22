import { Mat, CV_8U, CV_8UC4, CV_32F, CV_32FC2, COLOR_RGBA2GRAY, COLOR_GRAY2RGBA, cvtColor, calcOpticalFlowFarneback, cornerMinEigenVal, minMaxLoc, arrowedLine, circle, rectangle, line, putText, FONT_HERSHEY_SIMPLEX, LINE_AA } from '@banou/opencv-wasm'
import type { Scalar } from '@banou/opencv-wasm'
import type { Step } from '../engine/plan'
import { copyMat, image, payloadBundle } from './payload'
import type { Frame, Flow, Payload } from './payload'

const field = (value: Payload | undefined): Flow => {
  if (value?.kind !== 'flow') throw new Error('Connect a displacement field from Dense Optical Flow')
  return value
}
const sameSize = (a: Mat, b: Mat) => { if (a.cols !== b.cols || a.rows !== b.rows) throw new Error('Flow, frames and masks must have matching dimensions') }
const median = (values: number[]) => { values.sort((a, b) => a - b); const mid = Math.floor(values.length / 2); return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2 }
const gray8 = (src: Mat, dst: Mat) => { using gray = new Mat(); cvtColor(src, gray, COLOR_RGBA2GRAY); gray.convertTo(dst, CV_8U, 255) }
const frame = (mat: Mat): Frame => ({ kind: 'frame', mat, range: 'unit' })

/** Keep the background at native resolution, mapping analysis coordinates and vectors onto it. */
export const drawFlow = (flow: Flow, background: Frame, cell: number, gain: number, brightness: number, grid: boolean, labels: boolean, validity?: Frame): Frame => {
  if (validity) sameSize(flow.mat, validity.mat)
  using bytes = new Mat()
  background.mat.convertTo(bytes, CV_8UC4, 255 * brightness)
  const rgba = bytes.data, original = background.mat.data32F
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(Math.max(0, Math.min(1, original[i]!)) * 255)
  const width = flow.mat.cols, height = flow.mat.rows, values = Float32Array.from(flow.mat.data32F), mask = validity ? Float32Array.from(validity.mat.data32F) : undefined
  const sx = background.mat.cols / width, sy = background.mat.rows / height, scale = Math.min(sx, sy)
  const point = (x: number, y: number) => ({ x: Math.round((x + 0.5) * sx - 0.5), y: Math.round((y + 0.5) * sy - 0.5) })
  const thickness = Math.max(1, Math.round(scale)), radius = Math.max(2, Math.round(2 * scale))
  const mint: Scalar = [85, 216, 178, 255], orange: Scalar = [244, 154, 109, 255], gray: Scalar = [130, 130, 130, 255]
  for (let y = 0; y < height; y += cell) for (let x = 0; x < width; x += cell) {
    const w = Math.min(cell, width - x), h = Math.min(cell, height - y), center = { x: Math.round(x + (w - 1) / 2), y: Math.round(y + (h - 1) / 2) }
    const i = center.y * width + center.x, dx = values[i * 2]!, dy = values[i * 2 + 1]!, valid = (!mask || mask[i * 4]! > 0.5) && Number.isFinite(dx) && Number.isFinite(dy)
    const origin = point(center.x, center.y)
    if (grid) rectangle(bytes, { x: Math.round(x * sx), y: Math.round(y * sy) }, { x: Math.round((x + w) * sx) - 1, y: Math.round((y + h) * sy) - 1 }, [100, 100, 100, 255], thickness)
    if (valid) {
      circle(bytes, origin, radius, orange, -1)
      if (Math.hypot(dx * sx, dy * sy) * gain >= 0.5) arrowedLine(bytes, origin, point(center.x + dx * gain, center.y + dy * gain), mint, thickness, LINE_AA, 0, 0.3)
      else circle(bytes, origin, radius, mint, -1)
      if (labels && w >= 40 && h >= 24) putText(bytes, `${Math.round(dx * sx)},${Math.round(dy * sy)}`, point(x + 3, y + 12), FONT_HERSHEY_SIMPLEX, 0.3 * scale, mint, thickness, LINE_AA)
    } else {
      line(bytes, point(center.x - 2, center.y - 2), point(center.x + 2, center.y + 2), gray, thickness)
      line(bytes, point(center.x + 2, center.y - 2), point(center.x - 2, center.y + 2), gray, thickness)
    }
  }
  const out = new Mat()
  try { bytes.convertTo(out, CV_32F, 1 / 255); return frame(out) } catch (error) { out.delete(); throw error }
}

/** Independent optical-flow operations; native buffers belong to their returned cache bundle. */
export const flowKernel = (step: Step, inputs: Record<string, Payload>) => {
  const { type, params: p } = step.node
  if (!['farneback', 'offsetFlow', 'flowConsistency', 'cornerStrength', 'flowGrid', 'drawFlow'].includes(type)) return null
  const allocated: Mat[] = [], outputs: Record<string, Payload> = {}
  const keep = (mat: Mat) => { allocated.push(mat); return mat }
  const makeFlow = (mat: Mat, base: Frame): Flow => ({ kind: 'flow', mat, base: { ...base, mat: keep(copyMat(base.mat)) } })
  const scalar = (name: string, value: number) => { outputs[`out:scalar:${name}`] = { kind: 'scalar', value } }
  try {
    if (type === 'farneback') {
      const a = image(inputs['in:frame:a']), b = image(inputs['in:frame:b']); sameSize(a.mat, b.mat)
      if (a.mat.cols < 8 || a.mat.rows < 8) throw new Error('Dense flow requires frames at least 8 × 8 pixels')
      if (Number(p.window) % 2 !== 1) throw new Error('Flow window must be an odd number of pixels')
      using ga = new Mat(), gb = new Mat()
      gray8(a.mat, ga); gray8(b.mat, gb)
      const out = keep(new Mat())
      calcOpticalFlowFarneback(ga, gb, out, 0.5, Number(p.levels), Number(p.window), Number(p.iterations), 7, 1.5, 0)
      outputs['out:flow:field'] = makeFlow(out, a)
    } else if (type === 'offsetFlow') {
      const input = field(inputs['in:flow:field']), out = keep(copyMat(input.mat)), values = out.data32F
      for (let i = 0; i < values.length; i += 2) { values[i]! += Number(p.dx); values[i + 1]! += Number(p.dy) }
      outputs['out:flow:field'] = makeFlow(out, input.base)
    } else if (type === 'cornerStrength') {
      if (Number(p.block) % 2 !== 1) throw new Error('Corner neighborhood must be an odd number of pixels')
      using gray = new Mat(), response = new Mat()
      gray8(image(inputs['in:frame:image']).mat, gray); cornerMinEigenVal(gray, response, Number(p.block), 3)
      const peak = minMaxLoc(response).maxVal, out = keep(new Mat())
      response.convertTo(response, CV_32F, peak > 1e-9 ? 1 / peak : 0)
      cvtColor(response, out, COLOR_GRAY2RGBA); outputs['out:frame:image'] = frame(out)
    } else if (type === 'flowConsistency') {
      const forward = field(inputs['in:flow:forward']), backward = field(inputs['in:flow:backward']); sameSize(forward.mat, backward.mat)
      const width = forward.mat.cols, height = forward.mat.rows
      const valid = keep(Mat.zeros(height, width, CV_32F)), error = keep(Mat.ones(height, width, CV_32F))
      // Acquire WASM views after allocations; a later heap growth can detach old views.
      const a = forward.mat.data32F, b = backward.mat.data32F, mask = valid.data32F, errors = error.data32F
      errors.fill(Math.hypot(width, height))
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x, dx = a[i * 2]!, dy = a[i * 2 + 1]!, qx = x + dx, qy = y + dy
        if (!Number.isFinite(qx) || !Number.isFinite(qy) || qx < 0 || qy < 0 || qx > width - 1 || qy > height - 1) continue
        const x0 = Math.floor(qx), y0 = Math.floor(qy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = qx - x0, fy = qy - y0
        const sample = (c: number) => (b[(y0 * width + x0) * 2 + c]! * (1 - fx) + b[(y0 * width + x1) * 2 + c]! * fx) * (1 - fy) + (b[(y1 * width + x0) * 2 + c]! * (1 - fx) + b[(y1 * width + x1) * 2 + c]! * fx) * fy
        const distance = Math.hypot(dx + sample(0), dy + sample(1))
        if (Number.isFinite(distance)) { errors[i] = distance; mask[i] = distance <= Number(p.tolerance) ? 1 : 0 }
      }
      const maskRGBA = keep(new Mat()), errorRGBA = keep(new Mat())
      cvtColor(valid, maskRGBA, COLOR_GRAY2RGBA); cvtColor(error, errorRGBA, COLOR_GRAY2RGBA)
      outputs['out:frame:image'] = frame(maskRGBA); outputs['out:frame:error'] = frame(errorRGBA)
    } else if (type === 'flowGrid') {
      const input = field(inputs['in:flow:field']), mask = image(inputs['in:frame:mask']); sameSize(input.mat, mask.mat)
      const width = input.mat.cols, height = input.mat.rows, cell = Number(p.cell)
      const out = keep(Mat.zeros(height, width, CV_32FC2)), valid = keep(Mat.zeros(height, width, CV_32F)), acceptedX: number[] = [], acceptedY: number[] = []
      const vectors = input.mat.data32F, accepted = mask.mat.data32F, values = out.data32F, support = valid.data32F
      for (let i = 0; i < width * height; i++) if (accepted[i * 4]! > 0.5 && Number.isFinite(vectors[i * 2]) && Number.isFinite(vectors[i * 2 + 1])) { acceptedX.push(vectors[i * 2]!); acceptedY.push(vectors[i * 2 + 1]!) }
      const enough = acceptedX.length >= 16, dx = enough ? median(acceptedX) : 0, dy = enough ? median(acceptedY) : 0
      scalar('dx', dx); scalar('dy', dy); scalar('accepted', acceptedX.length / (width * height))
      for (let y = 0; y < height; y += cell) for (let x = 0; x < width; x += cell) {
        const w = Math.min(cell, width - x), h = Math.min(cell, height - y), xs: number[] = [], ys: number[] = []
        for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
          const i = py * width + px
          if (accepted[i * 4]! > 0.5 && Number.isFinite(vectors[i * 2]) && Number.isFinite(vectors[i * 2 + 1])) { xs.push(vectors[i * 2]!); ys.push(vectors[i * 2 + 1]!) }
        }
        if (xs.length < Math.max(8, Math.ceil(w * h * Number(p.support))) || p.mode === 'residual' && !enough) continue
        const vx = median(xs) - (p.mode === 'residual' ? dx : 0), vy = median(ys) - (p.mode === 'residual' ? dy : 0)
        for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) { const i = py * width + px; values[i * 2] = vx; values[i * 2 + 1] = vy; support[i] = 1 }
      }
      const maskRGBA = keep(new Mat()); cvtColor(valid, maskRGBA, COLOR_GRAY2RGBA)
      outputs['out:flow:field'] = makeFlow(out, input.base); outputs['out:frame:image'] = frame(maskRGBA)
    } else {
      const validity = inputs['in:frame:mask'], out = drawFlow(field(inputs['in:flow:field']), image(inputs['in:frame:image']), Number(p.cell), Number(p.gain), Number(p.background), Boolean(p.grid), Boolean(p.labels), validity ? image(validity) : undefined)
      keep(out.mat); outputs['out:frame:image'] = out
    }
    const result = payloadBundle(outputs)
    // Scratch matrices never enter the result; dispose them before transferring ownership.
    const retained = new Set<Mat>()
    for (const value of Object.values(outputs)) { if (value.kind === 'frame') retained.add(value.mat); if (value.kind === 'flow') { retained.add(value.mat); retained.add(value.base.mat) } }
    for (const mat of allocated) if (!retained.has(mat)) mat.delete()
    return result
  } catch (error) { allocated.forEach(mat => mat.delete()); throw error }
}

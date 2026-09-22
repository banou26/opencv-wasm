import { Mat, CV_32F, CV_8U, COLOR_RGBA2GRAY, COLOR_GRAY2RGBA, COLOR_RGBA2RGB, COLOR_RGB2RGBA, cvtColor, pyrDown, pyrUp, add, subtract, absdiff, multiply, addWeighted, resize, INTER_LINEAR, INTER_NEAREST, INTER_AREA, INTER_CUBIC, getRotationMatrix2D, warpAffine, BORDER_CONSTANT, flip, blur, medianBlur, bilateralFilter, Sobel, Scharr, Laplacian, Canny, normalize, NORM_MINMAX, adaptiveThreshold, ADAPTIVE_THRESH_GAUSSIAN_C, ADAPTIVE_THRESH_MEAN_C, THRESH_BINARY, THRESH_BINARY_INV, threshold, erode, dilate, morphologyEx, getStructuringElement, MORPH_ELLIPSE, MORPH_RECT, MORPH_CROSS, MORPH_OPEN, MORPH_CLOSE, MORPH_GRADIENT, MORPH_TOPHAT, MORPH_BLACKHAT, equalizeHist, createCLAHE, distanceTransform, DIST_L2, DIST_L1, DIST_C, extractChannel, insertChannel, magnitude } from '@banou/opencv-wasm'
import type { Step } from '../engine/plan'
import { image, payloadBundle } from './payload'
import type { Frame, Payload } from './payload'

const dimensions = (width: number, height: number) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_777_216) throw new Error('Image dimensions must be positive whole numbers, up to 16 million pixels')
  return { width, height }
}
const sameSize = (a: Mat, b: Mat) => { if (a.cols !== b.cols || a.rows !== b.rows) throw new Error('Frame dimensions must match; use Resize Frame or Crop Frame explicitly') }
const gray = (src: Mat, dst: Mat) => cvtColor(src, dst, COLOR_RGBA2GRAY)
const gray8 = (src: Mat, dst: Mat) => { using temp = new Mat(); gray(src, temp); temp.convertTo(dst, CV_8U, 255) }
const rgba = (src: Mat, dst: Mat, bytes = false) => { using temp = new Mat(); src.convertTo(temp, CV_32F, bytes ? 1 / 255 : 1); cvtColor(temp, dst, COLOR_GRAY2RGBA) }
const alpha = (src: Mat, dst: Mat) => { using channel = new Mat(); extractChannel(src, channel, 3); insertChannel(channel, dst, 3) }
const supported = new Set(['coverage', 'crop', 'paste', 'resize', 'rotate', 'flip', 'boxBlur', 'medianBlur', 'bilateral', 'sobel', 'scharr', 'laplacian', 'canny', 'normalize', 'invert', 'brightness', 'adaptiveThreshold', 'erode', 'dilate', 'morphology', 'equalize', 'clahe', 'distanceTransform', 'pyrDown', 'pyrUp', 'gaussianPyramid', 'laplacianPyramid', 'pyramidLevel', 'reconstructPyramid', 'addImages', 'subtractImages', 'multiplyImages', 'blendImages', 'channel', 'mergeChannels', 'magnitude'])

/** Each image operation produces independent native storage; inputs remain immutable. */
export const imageKernel = (step: Step, inputs: Record<string, Payload>) => {
  const { type, params: p } = step.node
  if (!supported.has(type)) return null
  const out = new Mat(), allocated: Mat[] = [out]
  const mat = () => { const value = new Mat(); allocated.push(value); return value }
  let range: Frame['range'] = 'unit'
  const input = inputs['in:frame:image']?.kind === 'frame' ? image(inputs['in:frame:image']) : undefined
  try {
    if (type === 'gaussianPyramid' || type === 'laplacianPyramid') {
      const src = image(inputs['in:frame:image']), gaussian: Frame[] = []
      const base = mat(); src.mat.copyTo(base); gaussian.push({ ...src, mat: base })
      for (let i = 0; i < Number(p.levels); i++) {
        const previous = gaussian.at(-1)!
        if (previous.mat.cols === 1 && previous.mat.rows === 1) throw new Error('Too many pyramid levels for this frame')
        const next = mat(); pyrDown(previous.mat, next); gaussian.push({ ...src, mat: next })
      }
      const frames: Frame[] = type === 'gaussianPyramid' ? gaussian : []
      if (type === 'laplacianPyramid') {
        for (let i = 0; i < gaussian.length - 1; i++) {
          using expanded = new Mat()
          const current = gaussian[i]!, next = gaussian[i + 1]!, band = mat()
          pyrUp(next.mat, expanded, { width: current.mat.cols, height: current.mat.rows }); subtract(current.mat, expanded, band)
          frames.push({ kind: 'frame', mat: band, range: 'signed' })
        }
        frames.push(gaussian.at(-1)!)
      }
      const kept = new Set(frames.map(f => f.mat)); for (const value of allocated) if (!kept.has(value)) value.delete()
      allocated.length = 0
      return payloadBundle({ 'out:frames:levels': { kind: 'frames', frames, pyramid: type === 'gaussianPyramid' ? 'gaussian' : 'laplacian' } })
    } else if (type === 'pyramidLevel' || type === 'reconstructPyramid') {
      const pyramid = inputs['in:frames:levels']
      if (pyramid?.kind !== 'frames') throw new Error('Connect a pyramid frame list')
      if (type === 'pyramidLevel') {
        const frame = pyramid.frames[Number(p.level)]
        if (!frame) throw new Error(`Pyramid has levels 0 through ${pyramid.frames.length - 1}`)
        frame.mat.copyTo(out); range = frame.range
      } else {
        if (pyramid.pyramid !== 'laplacian') throw new Error('Reconstruction requires Laplacian detail bands plus the coarse frame')
        pyramid.frames.at(-1)!.mat.copyTo(out)
        for (let i = pyramid.frames.length - 2; i >= 0; i--) {
          const band = pyramid.frames[i]!
          using expanded = new Mat()
          pyrUp(out, expanded, { width: band.mat.cols, height: band.mat.rows }); add(expanded, band.mat, out)
        }
      }
    } else if (type === 'crop') {
      const frame = image(inputs['in:frame:image']), rect = inputs['in:rect:region']
      if (rect?.kind !== 'rect') throw new Error('Connect a Rectangle to Region')
      dimensions(rect.width, rect.height)
      if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y) || rect.x < 0 || rect.y < 0 || rect.x + rect.width > frame.mat.cols || rect.y + rect.height > frame.mat.rows) throw new Error('The crop rectangle must be inside the input frame')
      using roi = frame.mat.roi(rect)
      roi.copyTo(out); range = frame.range
    } else if (type === 'paste') {
      const base = image(inputs['in:frame:base']), patch = image(inputs['in:frame:patch']), x = Number(p.x), y = Number(p.y)
      if (x + patch.mat.cols > base.mat.cols || y + patch.mat.rows > base.mat.rows) throw new Error('The patch must fit inside the base frame')
      base.mat.copyTo(out)
      using roi = out.roi({ x, y, width: patch.mat.cols, height: patch.mat.rows })
      patch.mat.copyTo(roi); range = base.range === 'signed' || patch.range === 'signed' ? 'signed' : 'unit'
    } else if (['addImages', 'subtractImages', 'multiplyImages', 'blendImages'].includes(type)) {
      const a = image(inputs['in:frame:a']), b = image(inputs['in:frame:b']); sameSize(a.mat, b.mat)
      if (type === 'addImages') add(a.mat, b.mat, out)
      else if (type === 'subtractImages') { if (p.absolute) absdiff(a.mat, b.mat, out); else subtract(a.mat, b.mat, out) }
      else if (type === 'multiplyImages') multiply(a.mat, b.mat, out)
      else addWeighted(a.mat, 1 - Number(p.factor), b.mat, Number(p.factor), 0, out)
      range = type === 'subtractImages' && !p.absolute || a.range === 'signed' || b.range === 'signed' ? 'signed' : 'unit'
    } else if (type === 'mergeChannels') {
      const red = image(inputs['in:frame:red']), green = image(inputs['in:frame:green']), blue = image(inputs['in:frame:blue'])
      sameSize(red.mat, green.mat); sameSize(red.mat, blue.mat); red.mat.copyTo(out)
      for (const [i, frame] of [red, green, blue].entries()) { using channel = new Mat(); gray(frame.mat, channel); insertChannel(channel, out, i) }
    } else if (type === 'magnitude') {
      const x = image(inputs['in:frame:x']), y = image(inputs['in:frame:y']); sameSize(x.mat, y.mat)
      using gx = new Mat(), gy = new Mat(), mag = new Mat()
      gray(x.mat, gx); gray(y.mat, gy); magnitude(gx, gy, mag); rgba(mag, out)
    } else {
      if (!input) throw new Error('Connect a frame input')
      const src = input.mat; range = input.range
      if (type === 'coverage') { src.convertTo(out, CV_32F, 0, 1); range = 'unit' }
      else if (type === 'resize') resize(src, out, dimensions(Number(p.width), Number(p.height)), 0, 0, { linear: INTER_LINEAR, nearest: INTER_NEAREST, area: INTER_AREA, cubic: INTER_CUBIC }[String(p.method)]!)
      else if (type === 'rotate') {
        using matrix = getRotationMatrix2D({ x: (src.cols - 1) / 2, y: (src.rows - 1) / 2 }, Number(p.angle), Number(p.scale))
        warpAffine(src, out, matrix, { width: src.cols, height: src.rows }, INTER_LINEAR, BORDER_CONSTANT, [0, 0, 0, 1])
      } else if (type === 'flip') flip(src, out, p.axis === 'horizontal' ? 1 : p.axis === 'vertical' ? 0 : -1)
      else if (type === 'pyrDown') pyrDown(src, out)
      else if (type === 'pyrUp') {
        const width = Number(p.width) || src.cols * 2, height = Number(p.height) || src.rows * 2
        if (Math.abs(width - src.cols * 2) > 1 || Math.abs(height - src.rows * 2) > 1) throw new Error('Pyramid Up dimensions must be twice the input, plus or minus one pixel')
        pyrUp(src, out, dimensions(width, height))
      } else if (type === 'boxBlur') blur(src, out, { width: 2 * Number(p.radius) + 1, height: 2 * Number(p.radius) + 1 })
      else if (type === 'medianBlur') {
        using bytes = new Mat(), filtered = new Mat()
        src.convertTo(bytes, CV_8U, 255); medianBlur(bytes, filtered, 2 * Number(p.radius) + 1); filtered.convertTo(out, CV_32F, 1 / 255)
      } else if (type === 'bilateral') {
        using rgb = new Mat(), filtered = new Mat()
        cvtColor(src, rgb, COLOR_RGBA2RGB); bilateralFilter(rgb, filtered, Number(p.diameter), Number(p.sigmaColor), Number(p.sigmaSpace)); cvtColor(filtered, out, COLOR_RGB2RGBA); alpha(src, out)
      } else if (type === 'sobel' || type === 'scharr' || type === 'laplacian') {
        using g = new Mat(), derivative = new Mat(); gray(src, g)
        if (type === 'sobel') Sobel(g, derivative, CV_32F, p.axis === 'x' ? 1 : 0, p.axis === 'y' ? 1 : 0, 2 * Number(p.radius) + 1, Number(p.scale))
        else if (type === 'scharr') Scharr(g, derivative, CV_32F, p.axis === 'x' ? 1 : 0, p.axis === 'y' ? 1 : 0, Number(p.scale))
        else Laplacian(g, derivative, CV_32F, 2 * Number(p.radius) + 1, Number(p.scale))
        rgba(derivative, out); range = 'signed'
      } else if (type === 'canny' || type === 'adaptiveThreshold' || type === 'equalize' || type === 'clahe' || type === 'distanceTransform') {
        using bytes = new Mat(), result = new Mat(); gray8(src, bytes)
        if (type === 'canny') { if (Number(p.low) > Number(p.high)) throw new Error('Low threshold must not exceed high threshold'); Canny(bytes, result, Number(p.low), Number(p.high), 3, Boolean(p.l2)) }
        else if (type === 'adaptiveThreshold') adaptiveThreshold(bytes, result, 255, p.method === 'gaussian' ? ADAPTIVE_THRESH_GAUSSIAN_C : ADAPTIVE_THRESH_MEAN_C, p.invert ? THRESH_BINARY_INV : THRESH_BINARY, 2 * Number(p.radius) + 1, Number(p.c))
        else if (type === 'equalize') equalizeHist(bytes, result)
        else if (type === 'clahe') { const clahe = createCLAHE(Number(p.clipLimit), { width: Number(p.tiles), height: Number(p.tiles) }); if (!clahe) throw new Error('Could not create CLAHE'); try { clahe.apply(bytes, result) } finally { clahe.delete() } }
        else { using mask = new Mat(); threshold(bytes, mask, 0, 255, THRESH_BINARY); distanceTransform(mask, result, p.metric === 'euclidean' ? DIST_L2 : p.metric === 'manhattan' ? DIST_L1 : DIST_C, 3) }
        rgba(result, out, type !== 'distanceTransform'); range = 'unit'
      } else if (type === 'erode' || type === 'dilate' || type === 'morphology') {
        const width = 2 * Number(p.radius) + 1
        using kernel = getStructuringElement(p.shape === 'ellipse' ? MORPH_ELLIPSE : p.shape === 'cross' ? MORPH_CROSS : MORPH_RECT, { width, height: width })
        if (type === 'erode') erode(src, out, kernel, { x: -1, y: -1 }, Number(p.iterations))
        else if (type === 'dilate') dilate(src, out, kernel, { x: -1, y: -1 }, Number(p.iterations))
        else morphologyEx(src, out, { open: MORPH_OPEN, close: MORPH_CLOSE, gradient: MORPH_GRADIENT, 'top hat': MORPH_TOPHAT, 'black hat': MORPH_BLACKHAT }[String(p.operation)]!, kernel, { x: -1, y: -1 }, Number(p.iterations))
        alpha(src, out)
      } else if (type === 'normalize') {
        using rgb = new Mat(), scaled = new Mat()
        cvtColor(src, rgb, COLOR_RGBA2RGB); normalize(rgb, scaled, Number(p.low), Number(p.high), NORM_MINMAX); cvtColor(scaled, out, COLOR_RGB2RGBA); range = Number(p.low) < 0 ? 'signed' : 'unit'
      } else if (type === 'invert' || type === 'brightness') {
        src.convertTo(out, CV_32F, type === 'invert' ? -1 : Number(p.gain), type === 'invert' ? 1 : Number(p.offset)); alpha(src, out)
      } else if (type === 'channel') { using channel = new Mat(); extractChannel(src, channel, ['red', 'green', 'blue', 'alpha'].indexOf(String(p.channel))); rgba(channel, out) }
      else throw new Error(`Missing native operation: ${type}`)
    }
    return payloadBundle({ 'out:frame:image': { kind: 'frame', mat: out, range } })
  } catch (error) { for (const value of allocated) value.delete(); throw error }
}

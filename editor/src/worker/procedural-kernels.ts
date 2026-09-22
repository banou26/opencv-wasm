import { Mat, CV_32FC4 } from '@banou/opencv-wasm'
import type { Step } from '../engine/plan'
import { image, payloadBundle } from './payload'
import type { Frame, Payload } from './payload'

/** Generate image fields and apply explicit per-pixel math without a decoded video source. */
export const proceduralKernel = (step: Step, inputs: Record<string, Payload>) => {
  const { type, params: p } = step.node
  if (!['coordinates', 'noise', 'pixelMath'].includes(type)) return null
  const allocated: Mat[] = [], outputs: Record<string, Payload> = {}
  const make = (width: number, height: number): Frame => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_194_304) throw new Error('Generated images support positive integer dimensions up to 4 million pixels')
    const mat = new Mat(height, width, CV_32FC4); allocated.push(mat); return { kind: 'frame', mat, range: 'unit' }
  }
  try {
    if (type === 'coordinates') {
      const width = Number(p.width), height = Number(p.height)
      for (const component of ['u', 'v', 'x', 'y']) {
        const out = make(width, height), values = out.mat.data32F
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4, value = component === 'u' ? x / width : component === 'v' ? y / height : component === 'x' ? x : y
          values[i] = values[i + 1] = values[i + 2] = value; values[i + 3] = 1
        }
        outputs[`out:frame:${component}`] = out
      }
    } else if (type === 'noise') {
      const width = Number(p.width), height = Number(p.height), out = make(width, height), values = out.mat.data32F, levels = Number(p.levels)
      let seed = Number(p.seed) >>> 0
      for (let i = 0; i < width * height; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const value = Math.floor(seed / 4294967296 * levels) / levels
        values[i * 4] = values[i * 4 + 1] = values[i * 4 + 2] = value; values[i * 4 + 3] = 1
      }
      outputs['out:frame:image'] = out
    } else {
      const a = image(inputs['in:frame:a']), b = inputs['in:frame:b'] ? image(inputs['in:frame:b']) : undefined
      if (b && (a.mat.cols !== b.mat.cols || a.mat.rows !== b.mat.rows)) throw new Error('Pixel Math images must have matching dimensions')
      const out = make(a.mat.cols, a.mat.rows), dst = out.mat.data32F, av = a.mat.data32F, bv = b?.mat.data32F, operation = String(p.operation)
      for (let i = 0; i < dst.length; i++) {
        if (i % 4 === 3) { dst[i] = av[i]!; continue }
        const x = av[i]!, y = bv ? bv[i]! : Number(p.b)
        let value: number
        switch (operation) {
          case 'add': value = x + y; break
          case 'subtract': value = x - y; break
          case 'multiply': value = x * y; break
          case 'divide': value = x / y; break
          case 'modulo': value = ((x % Math.abs(y)) + Math.abs(y)) % Math.abs(y); break
          case 'floor': value = Math.floor(x); break
          case 'ceil': value = Math.ceil(x); break
          case 'round': value = Math.round(x); break
          case 'fraction': value = x - Math.floor(x); break
          case 'absolute': value = Math.abs(x); break
          case 'sine': value = Math.sin(x); break
          case 'cosine': value = Math.cos(x); break
          case 'power': value = x ** y; break
          case 'min': value = Math.min(x, y); break
          case 'max': value = Math.max(x, y); break
          case 'step': value = x >= y ? 1 : 0; break
          case 'clamp': value = Math.max(0, Math.min(1, x)); break
          default: throw new Error('Unknown pixel operation')
        }
        if (!Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38) throw new Error('Pixel Math produced a non-finite value; check divisors and powers')
        dst[i] = value
      }
      outputs['out:frame:image'] = out
    }
    return payloadBundle(outputs)
  } catch (error) { allocated.forEach(mat => mat.delete()); throw error }
}

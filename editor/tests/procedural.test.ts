import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV, matFromArray, CV_32FC4 } from '@banou/opencv-wasm'
import { proceduralTextureGraph } from '../src/engine/procedural-prefab'
import { parseDocument } from '../src/engine/graph'
import { evaluateGraph } from '../src/engine/evaluate'
import { ResultCache } from '../src/engine/cache'
import { runKernel } from '../src/worker/kernels'
import { proceduralKernel } from '../src/worker/procedural-kernels'
import { image, parameterValue } from '../src/worker/payload'
import type { Payload } from '../src/worker/payload'
import { defaultParams } from '../src/engine/specs'
import type { NodeType, Params } from '../src/engine/types'

beforeAll(async () => { await initOpenCV() }, 60000)
const invoke = (type: NodeType, params: Params, inputs: Record<string, Payload> = {}) => proceduralKernel({ key: 'test', node: { id: 'n1', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 }, inputs)!

test('generated RGB arithmetic exactly recreates the uncompressed smoke texture and wraps its animation', async () => {
  const doc = parseDocument(proceduralTextureGraph()), cache = new ResultCache<Payload>(128 * 1024 ** 2), width = 192, height = 128
  expect(doc.nodes.some(n => n.type === 'clip' || n.type === 'source' || n.type === 'readFrame')).toBe(false)
  const expected = new Float32Array(width * height * 4)
  let seed = 412947
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const noise = seed >>> 26, i = (y * width + x) * 4
    expected.set([(35 + (x * 3 + y * 5 + noise) % 185) / 255, (25 + (x * 5 + y * 2 + noise) % 185) / 255, (45 + (x * 2 + y * 7 + noise) % 185) / 255, 1], i)
  }
  try {
    for (const frame of [0, 1, 7, 0]) {
      const result = await evaluateGraph(doc, 'n5', null, frame, [], { cache, assets: {}, parameter: parameterValue, cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {}, kernel: (step, inputs) => runKernel(step, inputs, undefined, () => false, doc) })
      try {
        const actual = image(result.value).mat.data32F
        let maxError = 0
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
          const source = (((y - frame + height) % height) * width + (x - frame * 2 + width) % width) * 4 + c
          maxError = Math.max(maxError, Math.abs(actual[(y * width + x) * 4 + c]! - expected[source]!))
        }
        expect(maxError).toBeLessThan(0.00001)
      } finally { result.release() }
    }
  } finally { cache.clear() }
})

test('coordinates and deterministic noise work without any frame input', () => {
  const coords = invoke('coordinates', { width: 4, height: 3 }), noise = invoke('noise', { width: 4, height: 3, seed: 42 }), repeat = invoke('noise', { width: 4, height: 3, seed: 42 }), other = invoke('noise', { width: 4, height: 3, seed: 43 })
  try {
    expect(image(coords.outputs['out:frame:x']).mat.data32F[20]).toBe(1)
    expect(image(coords.outputs['out:frame:y']).mat.data32F[20]).toBe(1)
    expect(image(coords.outputs['out:frame:u']).mat.data32F[20]).toBe(0.25)
    expect(image(coords.outputs['out:frame:v']).mat.data32F[20]).toBeCloseTo(1 / 3)
    expect([...image(noise.outputs['out:frame:image']).mat.data32F]).toEqual([...image(repeat.outputs['out:frame:image']).mat.data32F])
    expect([...image(noise.outputs['out:frame:image']).mat.data32F]).not.toEqual([...image(other.outputs['out:frame:image']).mat.data32F])
  } finally { coords.dispose(); noise.dispose(); repeat.dispose(); other.dispose() }
})

test('Pixel Math preserves alpha, accepts a per-pixel B, and rejects undefined arithmetic', () => {
  const a: Payload = { kind: 'frame', mat: matFromArray(1, 1, CV_32FC4, [-2.5, 0.5, 2.5, 0.3]), range: 'signed' }, b: Payload = { ...a, mat: matFromArray(1, 1, CV_32FC4, [2, 3, 4, 1]) }
  try {
    const modulo = invoke('pixelMath', { operation: 'modulo', b: 2 }, { 'in:frame:a': a }), sum = invoke('pixelMath', { operation: 'add' }, { 'in:frame:a': a, 'in:frame:b': b })
    try {
      expect([...image(modulo.outputs['out:frame:image']).mat.data32F].slice(0, 3)).toEqual([1.5, 0.5, 0.5])
      expect([...image(sum.outputs['out:frame:image']).mat.data32F].slice(0, 3)).toEqual([-0.5, 3.5, 6.5])
      expect(image(sum.outputs['out:frame:image']).mat.data32F[3]).toBeCloseTo(0.3)
      expect([...a.mat.data32F].slice(0, 3)).toEqual([-2.5, 0.5, 2.5])
    } finally { modulo.dispose(); sum.dispose() }
    expect(() => invoke('pixelMath', { operation: 'divide', b: 0 }, { 'in:frame:a': a })).toThrow('non-finite')
  } finally { a.mat.delete(); b.mat.delete() }
})

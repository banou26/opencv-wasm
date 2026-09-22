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

test('procedural stripes follow a periodic field across the translated seams and the full animation loop', async () => {
  const doc = parseDocument(proceduralTextureGraph()), cache = new ResultCache<Payload>(128 * 1024 ** 2), width = 192, height = 128
  expect(doc.nodes.some(n => n.type === 'clip' || n.type === 'source' || n.type === 'readFrame')).toBe(false)
  // Fractional controls are explicitly rounded inside the group, preserving
  // whole cycles at opposite boundaries even when a user wires a decimal value.
  doc.nodes.find(n => n.id === 'nr')!.params.sx = 3.4
  doc.nodes.find(n => n.id === 'nr')!.params.sy = 2.6
  const noise = new Float64Array(width * height)
  let seed = 412947
  for (let i = 0; i < noise.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; noise[i] = (seed >>> 26) / 185 }
  const wrap = (v: number, size: number) => ((v % size) + size) % size
  const evaluate = (frame: number) => evaluateGraph(doc, 'n5', null, frame, [], { cache, assets: {}, parameter: parameterValue, cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {}, kernel: (step, inputs) => runKernel(step, inputs, undefined, () => false, doc) })
  try {
    for (const time of [0, 120, 240, 480]) {
      const result = await evaluate(time)
      try {
        const actual = image(result.value).mat.data32F
        let maxError = 0
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          // Evaluate an infinite periodic field at coordinates OUTSIDE the
          // original tile. A mismatched finite tile cannot satisfy this check.
          const worldX = x - time * width / 240, worldY = y - time * height / 240
          const grain = noise[wrap(worldY, height) * width + wrap(worldX, width)]!
          for (const [c, cx, cy, bias] of [[0, 3, 3, 35], [1, 5, 1, 25], [2, 2, 5, 45]] as const) {
            const expected = (bias + 185 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (worldX / width * cx + worldY / height * cy + grain)))) / 255
            maxError = Math.max(maxError, Math.abs(actual[(y * width + x) * 4 + c]! - expected))
          }
        }
        expect(maxError).toBeLessThan(0.00002)
      } finally { result.release() }
    }
    const first = await evaluate(0.5), repeated = await evaluate(240.5)
    try {
      const a = image(first.value).mat.data32F, b = image(repeated.value).mat.data32F
      expect(b.every((value, index) => value === a[index])).toBe(true)
    } finally { first.release(); repeated.release() }
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

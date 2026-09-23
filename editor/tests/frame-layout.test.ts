import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV, matFromArray, CV_32FC4 } from '@banou/opencv-wasm'
import { defaultParams, validateParams } from '../src/engine/specs'
import { runKernel } from '../src/worker/kernels'
import { image, type Frame } from '../src/worker/payload'

beforeAll(async () => { await initOpenCV() }, 60000)
const fixture = (width: number, height: number, offset: number): Frame => ({ kind: 'frame', range: offset < 0 ? 'signed' : 'unit', mat: matFromArray(height, width, CV_32FC4, Float32Array.from({ length: width * height * 4 }, (_, i) => offset + i / 100)) })
const layout = (a: Frame, b: Frame, direction: string) => runKernel({ key: 'layout', node: { id: 'layout', type: 'frameLayout', params: { direction }, position: { x: 0, y: 0 } }, frame: 0, inputs: {} }, { 'in:frame:a': a, 'in:frame:b': b }, undefined, () => false)

test.each(['horizontal', 'vertical'])('frame layout %s copies unequal images exactly with transparent padding', async direction => {
  const a = fixture(3, 2, .1), b = fixture(2, 3, -.5)
  const originalA = a.mat.data32F.slice(), originalB = b.mat.data32F.slice()
  try {
    const bundle = await layout(a, b, direction)
    try {
      const output = image(bundle.outputs['out:frame:image']), horizontal = direction === 'horizontal'
      const width = horizontal ? 5 : 3, height = horizontal ? 3 : 5
      expect([output.mat.cols, output.mat.rows, output.range]).toEqual([width, height, 'signed'])
      const expected = new Float32Array(width * height * 4)
      for (const [frame, ox, oy] of [[a, 0, 0], [b, horizontal ? 3 : 0, horizontal ? 0 : 2]] as const) {
        for (let y = 0; y < frame.mat.rows; y++) expected.set(frame.mat.data32F.subarray(y * frame.mat.cols * 4, (y + 1) * frame.mat.cols * 4), ((y + oy) * width + ox) * 4)
      }
      expect(output.mat.data32F).toEqual(expected)
      output.mat.data32F[0] = 10
      expect(a.mat.data32F).toEqual(originalA)
      expect(b.mat.data32F).toEqual(originalB)
    } finally { bundle.dispose() }
    expect(a.mat.data32F).toEqual(originalA)
  } finally { a.mat.delete(); b.mat.delete() }
})

test('frame layout validates its direction and combined canvas before allocation', async () => {
  expect(defaultParams('frameLayout')).toEqual({ direction: 'horizontal' })
  expect(validateParams('frameLayout', { direction: 'diagonal' })).not.toBeNull()
  const a = fixture(8192, 1, .1), b = fixture(1, 8192, .2)
  try {
    await expect(layout(a, b, 'horizontal')).rejects.toThrow('16 million pixels')
    await expect(layout(a, b, 'diagonal')).rejects.toThrow('horizontal or vertical')
  } finally { a.mat.delete(); b.mat.delete() }
})

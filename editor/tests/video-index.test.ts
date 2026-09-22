import { expect, test } from 'vite-plus/test'
import { avcHasIdr, frameRate, presentationOrder, startSample } from '../src/engine/video-index'

test('presentation rank differs from decode order with B pictures', () => {
  const samples = [0, 3, 1, 2, 6, 4, 5].map((cts, number) => ({ number, cts, is_sync: number === 0 || number === 4, duration: 1 }))
  expect(presentationOrder(samples).map(s => s.number)).toEqual([0, 2, 3, 1, 5, 6, 4])
  const leading = samples[5], after = samples[4]
  if (!leading || !after) throw new Error('Missing fixture')
  expect(startSample(samples, leading)).toBe(0)
  expect(startSample(samples, after)).toBe(4)
})

test('a sync picture after the target composition time cannot start an open GOP seek', () => {
  const samples = [0, 1, 4, 2, 3].map((cts, number) => ({ number, cts, is_sync: number === 0 || number === 2, duration: 1 }))
  const target = samples[4]
  if (!target) throw new Error('Missing fixture')
  expect(startSample(samples, target)).toBe(0)
})

test('millisecond remux timestamps recover 23.976 instead of a rounded 24', () => {
  expect(frameRate([0, 672, 1328, 2000, 2672], 16000)).toBeCloseTo(24000 / 1001)
})

test('AVC key detection distinguishes open-GOP I pictures from true decoder refreshes', () => {
  expect(avcHasIdr(Uint8Array.from([0, 0, 0, 2, 0x61, 0x80]), 4)).toBe(false)
  expect(avcHasIdr(Uint8Array.from([0, 0, 0, 2, 0x06, 0x80, 0, 0, 0, 2, 0x65, 0x80]), 4)).toBe(true)
  expect(avcHasIdr(Uint8Array.from([2, 0x65, 0x80]), 1)).toBe(true)
  expect(avcHasIdr(Uint8Array.from([0, 2, 0x65, 0x80]), 2)).toBe(true)
  expect(() => avcHasIdr(Uint8Array.from([0, 0, 0, 8, 0x65]), 4)).toThrow('payload size')
  expect(() => avcHasIdr(Uint8Array.from([0, 0]), 4)).toThrow('Truncated')
})

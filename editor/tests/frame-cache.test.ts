import { expect, test } from 'vite-plus/test'
import { DecodedFrameCache } from '../src/video/frame-cache'

const frame = (bytes = 10) => ({ codedWidth: 2, codedHeight: 2, closed: false, allocationSize: () => bytes, close() { expect(this.closed).toBe(false); this.closed = true } })

test('reverse seeks reuse decoded dependencies and evict by recency within a byte budget', () => {
  const cache = new DecodedFrameCache<ReturnType<typeof frame>>(30), frames = Array.from({ length: 5 }, () => frame())
  for (let rank = 0; rank < 3; rank++) cache.set(rank, frames[rank]!, 2)
  expect(cache.get(1)).toBe(frames[1])
  expect(cache.get(0)).toBe(frames[0])
  cache.set(3, frames[3]!, 3)
  expect(frames[2]!.closed).toBe(true)
  expect(cache.bytes).toBe(30)
  expect(cache.get(0)).toBe(frames[0])
  cache.set(1, frames[4]!, 1)
  expect(frames[1]!.closed).toBe(true)
  expect(cache.bytes).toBe(30)
  cache.clear()
  expect(frames.every(value => value.closed)).toBe(true)
  expect(cache.bytes).toBe(0); expect(cache.size).toBe(0)
})

test('read-ahead cannot evict the frame that the decoder caller is waiting for', () => {
  const cache = new DecodedFrameCache<ReturnType<typeof frame>>(20)
  const target = frame(), a = frame(), b = frame()
  cache.set(10, target, 10); cache.set(11, a, 10); cache.set(12, b, 10)
  expect(cache.get(10)).toBe(target); expect(a.closed).toBe(true)
  expect(cache.size).toBe(2); cache.clear()
})

test('a large requested frame remains usable and opaque frames use a conservative size', () => {
  const cache = new DecodedFrameCache<ReturnType<typeof frame>>(8), target = frame(32), ahead = frame()
  cache.set(0, target, 0); cache.set(1, ahead, 0)
  expect(cache.get(0)).toBe(target); expect(ahead.closed).toBe(true)
  expect(cache.size).toBe(1); cache.clear()
  const opaque = frame(); opaque.allocationSize = () => { throw new Error('Opaque surface') }
  cache.set(2, opaque, 2)
  expect(cache.bytes).toBe(16); cache.clear()
})

test('tiny frames still obey the frame-count limit', () => {
  const cache = new DecodedFrameCache<ReturnType<typeof frame>>(1000, 2), frames = [frame(1), frame(1), frame(1)]
  frames.forEach((value, rank) => cache.set(rank, value, 2))
  expect(cache.size).toBe(2); expect(frames[0]!.closed).toBe(true)
  cache.clear()
})

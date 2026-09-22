import { expect, test } from 'vite-plus/test'
import { orderedParallel, renderWorkerCount } from '../src/engine/parallel-render'

test('parallel results preserve frame order with bounded buffers and exclusive worker slots', async () => {
  const active = new Set<number>(), consumed: number[] = [], completion: number[] = []
  let outstanding = 0, peak = 0, parallel = 0
  await orderedParallel(15, 3, async (index, slot) => {
    expect(active.has(slot)).toBe(false)
    active.add(slot); outstanding++; peak = Math.max(peak, outstanding); parallel = Math.max(parallel, active.size)
    await new Promise(resolve => setTimeout(resolve, index === 0 ? 25 : 1))
    active.delete(slot); completion.push(index); return index * 2
  }, async (value, index) => {
    expect(value).toBe(index * 2); consumed.push(index)
    await new Promise(resolve => setTimeout(resolve, 1)); outstanding--
  }, () => false)
  expect(completion[0]).not.toBe(0)
  expect(consumed).toEqual(Array.from({ length: 15 }, (_, i) => i))
  expect(parallel).toBe(3); expect(peak).toBeLessThanOrEqual(4); expect(outstanding).toBe(0)
})

test('cancellation keeps only a contiguous completed prefix and stops scheduling', async () => {
  const consumed: number[] = [], produced: number[] = []
  let cancelled = false
  await orderedParallel(100, 3, async index => { produced.push(index); return index }, async value => { consumed.push(value); cancelled = consumed.length === 2 }, () => cancelled)
  expect(consumed).toEqual([0, 1]); expect(produced.length).toBeLessThanOrEqual(5)
  await orderedParallel(10, 3, async () => { throw new Error('Already cancelled renders must not start') }, async () => {}, () => true)
})

test('a future worker failure is handled and never skips the failed frame', async () => {
  const consumed: number[] = []
  await expect(orderedParallel(10, 3, async index => {
    if (index === 2) throw new Error('Decoder failed')
    await new Promise(resolve => setTimeout(resolve, 1)); return index
  }, async value => { consumed.push(value) }, () => false)).rejects.toThrow('Decoder failed')
  expect(consumed).toEqual([0, 1])
})

test('automatic concurrency respects short renders, small machines and explicit comparisons', () => {
  expect(renderWorkerCount(0, 100, 32, 8)).toBe(2)
  expect(renderWorkerCount(0, 12, 32, 8)).toBe(1)
  expect(renderWorkerCount(0, 100, 2, 8)).toBe(1)
  expect(renderWorkerCount(0, 100, 8, 2)).toBe(1)
  for (const count of [1, 2, 4, 8, 16] as const) expect(renderWorkerCount(count, 100, 32, 8)).toBe(count)
  expect(renderWorkerCount(16, 100, 8, 8)).toBe(8)
  expect(renderWorkerCount(16, 3, 32, 8)).toBe(3)
  expect(renderWorkerCount(4, 2, 32, 8)).toBe(2)
  expect(renderWorkerCount(1, 100, 32, 8)).toBe(1)
})

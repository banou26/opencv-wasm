import { expect, test } from 'vite-plus/test'
import { ResultCache } from '../src/engine/cache'
import type { Bundle } from '../src/engine/types'
import { clonePayload, payloadBundle, type Payload } from '../src/worker/payload'
import { regionalBytes, regionalResources, type RegionalData } from '../src/worker/regional-data'

const fixture = () => {
  const disposed: string[] = []
  const bundle = (id: string, exclusive: number, shared?: ReadonlyMap<object, number>): Bundle<number> => ({
    outputs: { out: 1 }, bytes: exclusive + [...shared?.values() ?? []].reduce((sum, bytes) => sum + bytes, 0),
    ...(shared ? { shared } : {}), dispose: () => disposed.push(id),
  })
  return { bundle, disposed }
}

test('bundles count shared immutable storage once while retaining their standalone sizes', () => {
  const { bundle, disposed } = fixture(), shared = new Map([[{}, 80]]), cache = new ResultCache<number>(100)
  const first = bundle('a', 10, shared), second = bundle('b', 10, shared)
  const a = cache.put('a', first), b = cache.put('b', second)
  expect(first.bytes).toBe(90); expect(second.bytes).toBe(90)
  expect(cache.bytes).toBe(100); expect(cache.size).toBe(2)
  a.release(); cache.budget = 95; cache.trim()
  expect(disposed).toEqual(['a']); expect(cache.bytes).toBe(90)
  expect(cache.acquire('a')).toBeNull()
  b.release(); cache.clear()
  expect(disposed).toEqual(['a', 'b']); expect(cache.bytes).toBe(0)
})

test('incoming shared references remain charged while an unpinned predecessor is evicted', () => {
  const { bundle, disposed } = fixture(), shared = new Map([[{}, 80]]), cache = new ResultCache<number>(100)
  cache.put('old', bundle('old', 10, shared)).release()
  const next = cache.put('next', bundle('next', 20, shared))
  expect(cache.bytes).toBe(100); expect(cache.size).toBe(1); expect(disposed).toEqual(['old'])
  next.release(); cache.clear()
  expect(disposed).toEqual(['old', 'next']); expect(cache.bytes).toBe(0)
})

test('partially overlapping resource sets release only the allocations no longer retained', () => {
  const { bundle, disposed } = fixture(), x = {}, y = {}, z = {}, cache = new ResultCache<number>(100)
  const a = cache.put('a', bundle('a', 5, new Map([[x, 40], [y, 30]])))
  const b = cache.put('b', bundle('b', 5, new Map([[y, 30], [z, 20]])))
  expect(cache.bytes).toBe(100)
  a.release(); cache.budget = 60; cache.trim()
  expect(cache.bytes).toBe(55); expect(disposed).toEqual(['a'])
  b.release()
  const c = cache.put('c', bundle('c', 0, new Map([[x, 40], [z, 20]])))
  expect(cache.bytes).toBe(60); expect(disposed).toEqual(['a', 'b'])
  c.release(); cache.clear()
  expect(cache.bytes).toBe(0)
})

test('refusing a result rolls back incoming shared references without disposing caller-owned data', () => {
  const { bundle, disposed } = fixture(), shared = new Map([[{}, 80]]), cache = new ResultCache<number>(100)
  const pinned = cache.put('pinned', bundle('pinned', 20))
  cache.put('old', bundle('old', 0, shared)).release()
  const refused = bundle('refused', 10, shared)
  expect(() => cache.put('refused', refused)).toThrow('active graph exceeds')
  expect(cache.bytes).toBe(20); expect(cache.size).toBe(1); expect(disposed).toEqual(['old'])
  pinned.release()
  const retry = cache.put('retry', refused)
  expect(cache.bytes).toBe(90); expect(disposed).toEqual(['old', 'pinned'])
  retry.release(); cache.clear()
  expect(disposed).toEqual(['old', 'pinned', 'refused']); expect(cache.bytes).toBe(0)
})

test('an individually oversized shared bundle is refused without evicting or adopting anything', () => {
  const { bundle, disposed } = fixture(), cache = new ResultCache<number>(100)
  cache.put('old', bundle('old', 10)).release()
  const refused = bundle('refused', 30, new Map([[{}, 80]]))
  expect(() => cache.put('refused', refused)).toThrow('result exceeds')
  expect(cache.bytes).toBe(10); expect(cache.size).toBe(1); expect(disposed).toEqual([])
  refused.dispose(); cache.clear()
  expect(disposed).toEqual(['refused', 'old'])
})

test('budget changes respect shared pins and final release, and clear resets the shared registry', () => {
  const { bundle, disposed } = fixture(), shared = new Map([[{}, 80]]), cache = new ResultCache<number>(100)
  const a = cache.put('a', bundle('a', 10, shared)), b = cache.put('b', bundle('b', 10, shared))
  cache.budget = 0; cache.trim()
  expect(cache.bytes).toBe(100); expect(disposed).toEqual([])
  expect(() => cache.clear()).toThrow('borrowed')
  a.release(); a.release()
  expect(cache.bytes).toBe(90); expect(disposed).toEqual(['a'])
  b.release()
  expect(cache.bytes).toBe(0); expect(disposed).toEqual(['a', 'b'])
  cache.budget = 90; cache.put('c', bundle('c', 10, shared)).release(); cache.clear()
  cache.put('d', bundle('d', 10, shared)).release()
  expect(cache.bytes).toBe(90); cache.clear()
  expect(disposed).toEqual(['a', 'b', 'c', 'd']); expect(cache.bytes).toBe(0)
})

test('inconsistent shared sizes and invalid estimates refuse before cache mutation', () => {
  const { bundle, disposed } = fixture(), identity = {}, cache = new ResultCache<number>(100)
  cache.put('a', bundle('a', 10, new Map([[identity, 30]]))).release()
  expect(() => cache.put('b', bundle('b', 10, new Map([[identity, 40]])))).toThrow('changed size')
  expect(() => cache.put('c', bundle('c', 10, new Map([[{}, -1]])))).toThrow('Invalid shared')
  expect(() => cache.put('d', { ...bundle('d', 10, new Map([[{}, 20]])), bytes: 10 })).toThrow('Invalid cache')
  expect(() => cache.put('e', bundle('e', Number.NaN))).toThrow('Invalid cache')
  expect(cache.bytes).toBe(40); expect(cache.size).toBe(1); expect(disposed).toEqual([])
  cache.clear()
})

test('exclusive native-owned bundles keep their existing budget and disposal semantics', () => {
  const { bundle, disposed } = fixture(), cache = new ResultCache<number>(20)
  const pinned = cache.put('a', bundle('a', 10))
  cache.put('b', bundle('b', 10)).release()
  const next = cache.put('c', bundle('c', 10))
  expect(cache.bytes).toBe(20); expect(disposed).toEqual(['b'])
  expect(() => cache.put('d', bundle('d', 10))).toThrow('active graph exceeds')
  expect(cache.bytes).toBe(20); expect(disposed).toEqual(['b'])
  next.release(); pinned.release(); cache.clear()
  expect(disposed.sort()).toEqual(['a', 'b', 'c'])
})

const regionalFixture = (): RegionalData => {
  const buffer = new ArrayBuffer(32), frame = { width: 2, height: 2, data: new Uint8Array(buffer, 0, 12) }
  return {
    stage: 'scene', scene: { asset: 'clip', first: 0, last: 2, sourceWidth: 2, sourceHeight: 2,
      frames: [frame, frame, { ...frame, data: new Uint8Array(buffer, 12, 12) }] },
  }
}

test('regional traversal deduplicates objects and backing buffers, including overlapping views', () => {
  const data = regionalFixture(), resources = regionalResources(data), frame = data.scene.frames[0]!
  expect(resources.get(frame.data.buffer)).toBe(32)
  expect(resources.has(frame.data)).toBe(false)
  expect(resources.size).toBe(6)
  expect(regionalBytes(data)).toBe(5 * 64 + 32)
  const bundle = payloadBundle({
    direct: { kind: 'regions', data },
    record: { kind: 'custom', schema: 'test', fields: { alias: { kind: 'regions', data } } },
  })
  expect(bundle.shared).toEqual(resources)
  expect(bundle.bytes).toBe(128 + regionalBytes(data))
  bundle.dispose()
})

test('successive regional stages share storage while cloned payloads stay independently owned', () => {
  const data = regionalFixture(), next = { ...data, stage: 'motion' as const }
  const first = payloadBundle({ out: { kind: 'regions', data } }), second = payloadBundle({ out: { kind: 'regions', data: next } })
  const cache = new ResultCache<Payload>(first.bytes + 128 + 64)
  const a = cache.put('a', first), b = cache.put('b', second)
  expect(cache.bytes).toBe(first.bytes + 128 + 64)
  const copy = clonePayload({ kind: 'regions', data }), copiedBundle = payloadBundle({ out: copy })
  for (const identity of copiedBundle.shared!.keys()) expect(first.shared!.has(identity)).toBe(false)
  expect(() => cache.put('copy', copiedBundle)).toThrow('active graph exceeds')
  copiedBundle.dispose(); a.release(); b.release(); cache.clear()
})

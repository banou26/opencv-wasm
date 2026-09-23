import { createHash } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { loadWasmChunks, type WasmChunks } from '../../shared/wasm-chunks'

const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
const manifest: WasmChunks = {
  byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
  chunks: [{ url: '/runtime/first.bin', byteLength: 4 }, { url: '/runtime/second.bin', byteLength: 4 }],
}
const response = (url: string) => new Response(bytes.slice(url.includes('first') ? 0 : 4, url.includes('first') ? 4 : 8))
afterEach(() => vi.unstubAllGlobals())

test('complete chunks reconstruct and verify the engine independent of completion order', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('first')) await new Promise(resolve => setTimeout(resolve, 5))
    return response(url)
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await loadWasmChunks(manifest)).toEqual(bytes)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

for (const failure of ['short', 'html', 'http', 'network'] as const) {
  test(`one ${failure} chunk response retries with cache bypass and still verifies all bytes`, async () => {
    let attempts = 0
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('first') && attempts++ === 0) {
        if (failure === 'network') throw new TypeError('Network interrupted')
        if (failure === 'http') return new Response('Unavailable', { status: 503 })
        if (failure === 'html') return new Response('<html>Fallback</html>', { headers: { 'content-type': 'text/html' } })
        return new Response(new Uint8Array([0]))
      }
      return response(url)
    })
    vi.stubGlobal('fetch', fetcher)
    expect(await loadWasmChunks(manifest)).toEqual(bytes)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls.at(-1)).toEqual(['/runtime/first.bin', expect.objectContaining({ cache: 'reload' })])
  })
}

test('a persistently incomplete response identifies the asset and byte counts and aborts sibling fetches', async () => {
  let aborted = false
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (url.includes('first')) return new Response(new Uint8Array([0]))
    return new Promise<Response>((_, reject) => options.signal!.addEventListener('abort', () => {
      aborted = true; reject(new Error('Aborted'))
    }, { once: true }))
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(loadWasmChunks(manifest)).rejects.toThrow(/first\.bin: expected 4 bytes, received 1/)
  expect(aborted).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(3)
})

test('an HTML fallback explains a missing or incorrectly routed asset', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Fallback</html>', { headers: { 'content-type': 'text/html' } })))
  await expect(loadWasmChunks(manifest)).rejects.toThrow(/returned HTML.*server path/)
})

test('same-size corruption still fails the complete SHA-256 check', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([9, 9, 9, 9])))
  vi.stubGlobal('fetch', fetcher)
  await expect(loadWasmChunks(manifest)).rejects.toThrow(/checksum/)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('invalid manifests refuse before downloading or allocating the engine', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  for (const invalid of [
    { ...manifest, chunks: [] }, { ...manifest, byteLength: 9 }, { ...manifest, byteLength: Infinity },
    { ...manifest, sha256: 'invalid' }, { ...manifest, chunks: [{ url: 'bad', byteLength: -8 }] },
  ]) await expect(loadWasmChunks(invalid)).rejects.toThrow(/Invalid OpenCV download manifest/)
  expect(fetcher).not.toHaveBeenCalled()
})

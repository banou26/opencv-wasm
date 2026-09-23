/** Ordered download assets for one complete OpenCV WASM binary. */
export type WasmChunks = {
  byteLength: number
  sha256: string
  chunks: { url: string; byteLength: number }[]
}

/**
 * Download and verify the entire engine from smaller static assets. All chunks
 * are required; this changes file delivery, not the native API or module layout.
 */
export async function loadWasmChunks(manifest: WasmChunks): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController()
  let offset = 0
  const pieces = manifest.chunks.map(chunk => {
    if (!Number.isSafeInteger(chunk.byteLength) || chunk.byteLength <= 0 || !chunk.url) throw new Error('Invalid OpenCV download manifest.')
    const start = offset
    offset += chunk.byteLength
    return { ...chunk, start }
  })
  if (!pieces.length || !Number.isSafeInteger(manifest.byteLength) || manifest.byteLength <= 0
    || offset !== manifest.byteLength || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid OpenCV download manifest.')
  const binary = new Uint8Array(manifest.byteLength)
  try {
    await Promise.all(pieces.map(async ({ url, byteLength, start }) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted()
        try {
          const response = await fetch(url, { signal: controller.signal, ...(attempt ? { cache: 'reload' as const } : {}) })
          if (!response.ok) throw new Error(`Could not download OpenCV asset ${url}: HTTP ${response.status}. Reload the engine to retry.`)
          if (response.headers.get('content-type')?.includes('text/html')) {
            throw new Error(`OpenCV asset ${url} returned HTML instead of binary data. The runtime asset is missing or its server path is incorrect; regenerate the runtime assets and reload.`)
          }
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.byteLength !== byteLength) {
            throw new Error(`Incomplete OpenCV download for ${url}: expected ${byteLength} bytes, received ${bytes.byteLength}. Reload the engine to retry.`)
          }
          binary.set(bytes, start)
          return
        } catch (error) {
          if (attempt || controller.signal.aborted) throw error
          // A transient response or stale cached failure gets one cache-bypassing retry.
          await new Promise(resolve => setTimeout(resolve, 150))
        }
      }
    }))
    const digest = await crypto.subtle.digest('SHA-256', binary)
    const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
    if (actual !== manifest.sha256) throw new Error('OpenCV download checksum does not match. Reload the page and try again.')
    return binary
  } catch (error) {
    controller.abort()
    throw error
  }
}

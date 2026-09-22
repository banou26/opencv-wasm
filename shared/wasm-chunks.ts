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
  const binary = new Uint8Array(manifest.byteLength)
  const controller = new AbortController()
  let offset = 0
  const pieces = manifest.chunks.map(chunk => {
    const start = offset
    offset += chunk.byteLength
    return { ...chunk, start }
  })
  if (!pieces.length || offset !== binary.byteLength) throw new Error('Invalid OpenCV download manifest.')
  try {
    await Promise.all(pieces.map(async ({ url, byteLength, start }) => {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`Could not download OpenCV: HTTP ${response.status}. Try running again.`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength !== byteLength) throw new Error('Incomplete OpenCV download. Try running again.')
      binary.set(bytes, start)
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

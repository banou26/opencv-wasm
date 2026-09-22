import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** Copy the JS runtime and split its WASM into content-addressed 16 MiB assets. */
export async function writeRuntimeAssets(library, destination, { base = '/runtime/', copyJavaScript = true } = {}) {
  const binary = await fs.readFile(path.join(library, 'opencv_js.wasm'))
  const sha256 = createHash('sha256').update(binary).digest('hex')
  const chunkSize = 16 * 1024 * 1024
  await fs.rm(destination, { recursive: true, force: true })
  await fs.mkdir(destination, { recursive: true })
  for (const name of (copyJavaScript ? await fs.readdir(library) : []).filter(name => /\.(?:js|mjs)$/.test(name))) {
    await fs.copyFile(path.join(library, name), path.join(destination, name))
  }
  const chunks = []
  for (let offset = 0; offset < binary.byteLength; offset += chunkSize) {
    const bytes = binary.subarray(offset, offset + chunkSize)
    const name = `opencv-${sha256}-${chunks.length}.bin`
    await fs.writeFile(path.join(destination, name), bytes)
    chunks.push({ url: `${base}${name}`, byteLength: bytes.byteLength })
  }
  return { byteLength: binary.byteLength, sha256, chunks }
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

/** Keep live readers on complete files, and do not trigger watchers for unchanged bytes. */
export async function writeRuntimeFile(filename, data) {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data
  try {
    if ((await fs.readFile(filename)).equals(bytes)) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    await fs.rename(temporary, filename)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

/** Copy the JS runtime and split its WASM into content-addressed 16 MiB assets. */
export async function writeRuntimeAssets(library, destination, { base = '/runtime/', copyJavaScript = true } = {}) {
  const binary = await fs.readFile(path.join(library, 'opencv_js.wasm'))
  const sha256 = createHash('sha256').update(binary).digest('hex')
  const chunkSize = 16 * 1024 * 1024
  // Open pages may still use an older manifest; retain its content-addressed assets.
  await fs.mkdir(destination, { recursive: true })
  for (const name of (copyJavaScript ? await fs.readdir(library) : []).filter(name => /\.(?:js|mjs)$/.test(name))) {
    await writeRuntimeFile(path.join(destination, name), await fs.readFile(path.join(library, name)))
  }
  const chunks = []
  for (let offset = 0; offset < binary.byteLength; offset += chunkSize) {
    const bytes = binary.subarray(offset, offset + chunkSize)
    const name = `opencv-${sha256}-${chunks.length}.bin`
    await writeRuntimeFile(path.join(destination, name), bytes)
    chunks.push({ url: `${base}${name}`, byteLength: bytes.byteLength })
  }
  return { byteLength: binary.byteLength, sha256, chunks }
}

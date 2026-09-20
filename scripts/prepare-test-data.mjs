import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const sources = JSON.parse(await readFile('scripts/test-data.json', 'utf8'))
await mkdir('.cache', { recursive: true })
for (const [name, source] of Object.entries(sources)) {
  let bytes
  try { bytes = await readFile('.cache/' + name) }
  catch {
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`Could not download ${name}: ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    await writeFile('.cache/' + name, bytes)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Checksum mismatch: ${name}`)
}

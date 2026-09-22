import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const limit = 25 * 1024 * 1024
let count = 0, largest = { path: '', bytes: 0 }
const visit = async directory => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await visit(file)
    else {
      const { size } = await fs.stat(file)
      if (size > limit) throw new Error(`Cloudflare Pages asset exceeds 25 MiB: ${path.relative(root, file)} (${size} bytes)`)
      count++
      if (size > largest.bytes) largest = { path: path.relative(root, file), bytes: size }
    }
  }
}
await visit(root)
console.log(`Pages assets: ${count} files, largest ${(largest.bytes / 1024 / 1024).toFixed(2)} MiB (${largest.path})`)
